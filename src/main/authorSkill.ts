import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import iconv from "iconv-lite";
import path from "node:path";
import { app } from "electron";
import type {
  AuthorChatPayload,
  AuthorChatResult,
  AuthorChatMetrics,
  AuthorDistillationStats,
  AuthorPersonaAbstraction,
  AuthorPersonaCalibration,
  AuthorSourceSample,
  AuthorSkill,
  ChatMessage,
  CriticReviewPayload,
  CriticReviewResult,
  DebatePayload,
  DebateResult,
  PoemRecord,
} from "../shared/types";

const getProjectRoot = () => (app.isPackaged ? path.dirname(process.execPath) : process.cwd());
const getSkillRoot = () => path.join(getProjectRoot(), ".daily_runtime", "skills");
const getLlmConfigPath = () => path.join(getProjectRoot(), "llm.config.json");

interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

let llmConfigCache: Promise<LlmConfig | null> | null = null;
const skillCache = new Map<string, AuthorSkill>();
const DISTILLATION_VERSION = 2;
const ABSTRACTION_VERSION = 1;
const CALIBRATION_VERSION = 1;
const MAX_COLLECTION_POEMS = 5;
let terminalEncodingCache: "utf8" | "gbk" | null = null;

type AuthorPoemIndex = ReadonlyMap<string, PoemRecord[]>;
type PreparedSource = {
  representativePoems: PoemRecord[];
  sourceCollection: AuthorSourceSample[];
  sourceHash: string;
};
type AbstractionCache = {
  version: number;
  authorId: string;
  sourceHash: string;
  sourceCollection: AuthorSourceSample[];
  abstraction: AuthorPersonaAbstraction;
  tensions: string[];
  voiceTraits: string[];
  cachedAt: string;
};
type AbstractionResult = AuthorPersonaAbstraction & {
  tensions: string[];
  voiceTraits: string[];
};
type CalibrationResult = AuthorPersonaCalibration & {
  systemPrompt: string;
};
type DistillOutcome = {
  skill: AuthorSkill;
  distillMs?: number;
  distillPromptChars: number;
  sourceHash: string;
  collectionCount: number;
  abstractionMs?: number;
  calibrationMs?: number;
  abstractionPromptChars: number;
  calibrationPromptChars: number;
};
type DistillLockResult = DistillOutcome & { openingLine?: string };

export function invalidateLlmConfigCache(): void {
  llmConfigCache = null;
}

async function readLlmConfig(): Promise<LlmConfig | null> {
  if (!llmConfigCache) {
    llmConfigCache = (async () => {
      try {
        const raw = await readFile(getLlmConfigPath(), "utf8");
        const parsed = JSON.parse(raw) as Partial<LlmConfig>;
        if (parsed.baseUrl && parsed.apiKey && parsed.model) {
          return {
            baseUrl: parsed.baseUrl,
            apiKey: parsed.apiKey,
            model: parsed.model,
            temperature: parsed.temperature ?? 0.8,
            maxTokens: parsed.maxTokens ?? 512,
          };
        }
      } catch {
        // ignore
      }
      return null;
    })();
  }

  return llmConfigCache;
}

function cacheSkill(skill: AuthorSkill): AuthorSkill {
  skillCache.set(skill.authorId, skill);
  return skill;
}

function detectTerminalEncoding(): "utf8" | "gbk" {
  if (terminalEncodingCache) {
    return terminalEncodingCache;
  }

  if (process.platform !== "win32") {
    terminalEncodingCache = "utf8";
    return terminalEncodingCache;
  }

  try {
    const result = spawnSync("cmd.exe", ["/d", "/s", "/c", "chcp"], {
      encoding: "utf8",
      windowsHide: true,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    const codePage = output.match(/:\s*(\d+)/)?.[1] ?? output.match(/(\d+)/)?.[1];
    terminalEncodingCache = codePage === "936" ? "gbk" : "utf8";
    return terminalEncodingCache;
  } catch {
    terminalEncodingCache = "utf8";
    return terminalEncodingCache;
  }
}

function writeTerminalLog(level: "info" | "error", message: string): void {
  const line = `[author-llm] ${new Date().toISOString()} ${message}\n`;
  const stream = level === "error" ? process.stderr : process.stdout;

  if (detectTerminalEncoding() === "gbk") {
    stream.write(iconv.encode(line, "gbk"));
    return;
  }

  stream.write(line);
}

function logDistillEvent(level: "info" | "error", authorName: string, stage: string, message: string): void {
  writeTerminalLog(level, `${authorName} ${stage} ${message}`);
}

function isCurrentSkill(value: unknown): value is AuthorSkill {
  if (!value || typeof value !== "object") {
    return false;
  }

  const skill = value as Partial<AuthorSkill>;
  return (
    skill.version === DISTILLATION_VERSION &&
    typeof skill.authorId === "string" &&
    typeof skill.authorName === "string" &&
    typeof skill.authorMeta === "string" &&
    typeof skill.systemPrompt === "string" &&
    Array.isArray(skill.voiceTraits) &&
    Array.isArray(skill.signaturePhrases) &&
    Array.isArray(skill.sourceCollection) &&
    typeof skill.distillationStats?.sourceHash === "string" &&
    typeof skill.distillationStats?.collectionCount === "number" &&
    typeof skill.distillationStats?.abstractionVersion === "number" &&
    typeof skill.distillationStats?.calibrationVersion === "number" &&
    typeof skill.abstraction?.language === "string" &&
    typeof skill.abstraction?.thinking === "string" &&
    typeof skill.abstraction?.values === "string" &&
    Array.isArray(skill.calibration?.tensions) &&
    typeof skill.calibration?.resolution === "string" &&
    Array.isArray(skill.calibration?.guardrails) &&
    typeof skill.distilledAt === "string"
  );
}

async function readCachedSkill(authorId: string, skillPath: string): Promise<AuthorSkill | null> {
  const cached = skillCache.get(authorId);
  if (cached && isCurrentSkill(cached)) {
    return cached;
  }

  if (cached && !isCurrentSkill(cached)) {
    skillCache.delete(authorId);
  }

  try {
    const raw = await readFile(skillPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isCurrentSkill(parsed)) {
      return null;
    }
    return cacheSkill(parsed);
  } catch {
    return null;
  }
}

function buildOpeningLine(payload: AuthorChatPayload): string {
  const isZh = /[\u4e00-\u9fa5]/.test(payload.authorName);
  return buildTemplateOpeningLine(payload.authorName, payload.authorMeta, payload.poemContext.title, isZh);
}

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

function resolvePoemsByAuthor(authorName: string, allLibrary: PoemRecord[], authorIndex?: AuthorPoemIndex): PoemRecord[] {
  if (authorIndex?.has(authorName)) {
    return authorIndex.get(authorName) ?? [];
  }
  return allLibrary.filter((poem) => poem.author === authorName);
}

function buildReplyMetrics(
  source: AuthorChatMetrics["source"],
  skillLookupMs: number,
  totalStartedAt: number,
  extras: Partial<AuthorChatMetrics> = {},
): AuthorChatMetrics {
  return {
    source,
    skillLookupMs,
    totalMs: elapsedMs(totalStartedAt),
    ...extras,
  };
}

function getOrStartDistill(
  authorId: string,
  skillPath: string,
  payload: AuthorChatPayload,
  preparedSource: PreparedSource,
  config: LlmConfig,
): Promise<DistillLockResult> {
  const existingLock = distillingLocks.get(authorId);
  if (existingLock) {
    return existingLock;
  }

  const lockPromise = (async () => {
    try {
      const existingSkill = await readCachedSkill(authorId, skillPath);
      if (existingSkill && skillMatchesSource(existingSkill, preparedSource.sourceHash)) {
        if (needsCalibrationRefresh(existingSkill)) {
          return recalibrateSkill(existingSkill, payload.authorName, payload.authorMeta, config);
        }
        return {
          skill: existingSkill,
          distillPromptChars: 0,
          sourceHash: existingSkill.distillationStats.sourceHash,
          collectionCount: existingSkill.sourceCollection.length,
          abstractionMs: existingSkill.distillationStats.abstractionMs,
          calibrationMs: existingSkill.distillationStats.calibrationMs,
          abstractionPromptChars: 0,
          calibrationPromptChars: 0,
        };
      }

      const result = await performDistillAndChat(authorId, payload, preparedSource, config);
      cacheSkill(result.skill);
      return result;
    } finally {
      distillingLocks.delete(authorId);
    }
  })();

  distillingLocks.set(authorId, lockPromise);
  return lockPromise;
}

const ANONYMOUS_NAMES = new Set(["无名氏", "佚名", "nobody", "anonymous", "unknown", "不详"]);

function isAnonymousAuthor(name: string): boolean {
  return ANONYMOUS_NAMES.has(name.trim().toLowerCase()) || /^\s*$/.test(name);
}

function slugifyAuthor(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getSkillPath(authorId: string) {
  return path.join(getSkillRoot(), `${authorId}.skill.json`);
}

function getAbstractionCachePath(authorId: string) {
  return path.join(getSkillRoot(), `${authorId}.abstraction.json`);
}

async function ensureSkillRoot(): Promise<void> {
  await mkdir(getSkillRoot(), { recursive: true });
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function compactText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function extractThematicFeatures(poem: PoemRecord): string[] {
  const corpus = `${poem.title} ${poem.originalText.slice(0, 6).join(" ")} ${poem.translatedTitle} ${poem.translatedText.slice(0, 3).join(" ")}`;
  const features: string[] = [];

  const featureMatchers: Array<[string, RegExp]> = [
    ["night-sky", /月|夜|星|云|天|moon|night|star|sky/i],
    ["weather-water", /风|雨|雪|霜|江|河|海|湖|潮|water|river|sea|rain|wind|snow/i],
    ["flora-seasons", /花|春|秋|柳|叶|梅|兰|菊|flower|spring|autumn|leaf|willow|plum/i],
    ["journey-frontier", /行|路|舟|马|关|塞|远|归|journey|road|sail|horse|frontier|return/i],
    ["history-cosmos", /古|今|世|天下|山川|history|age|empire|world|mountain/i],
    ["solitude-home", /愁|思|梦|家|乡|客|独|寂|home|alone|solitude|memory|dream/i],
    ["wine-freedom", /酒|醉|狂|放|wine|drunk|free|wild/i],
    ["ethics-reflection", /心|志|道|义|truth|virtue|soul|mind|thought/i],
  ];

  for (const [feature, matcher] of featureMatchers) {
    if (matcher.test(corpus)) {
      features.push(feature);
    }
  }

  if (features.length === 0) {
    features.push("general-lyric");
  }

  return features;
}

function selectCollectionPoems(poems: PoemRecord[]): PoemRecord[] {
  if (poems.length <= MAX_COLLECTION_POEMS) {
    return poems;
  }

  const candidates = poems.map((poem, index) => ({
    poem,
    index,
    features: extractThematicFeatures(poem),
    density: poem.originalText.slice(0, 6).join("").length,
  }));

  const selected: typeof candidates = [];
  const coveredFeatures = new Set<string>();

  while (selected.length < MAX_COLLECTION_POEMS && selected.length < candidates.length) {
    const remaining = candidates.filter((candidate) => !selected.includes(candidate));
    remaining.sort((left, right) => {
      const leftNovelty = left.features.filter((feature) => !coveredFeatures.has(feature)).length;
      const rightNovelty = right.features.filter((feature) => !coveredFeatures.has(feature)).length;
      if (rightNovelty !== leftNovelty) {
        return rightNovelty - leftNovelty;
      }
      if (right.density !== left.density) {
        return right.density - left.density;
      }
      return left.index - right.index;
    });

    const next = remaining[0];
    if (!next) {
      break;
    }
    selected.push(next);
    for (const feature of next.features) {
      coveredFeatures.add(feature);
    }
  }

  return selected
    .sort((left, right) => left.index - right.index)
    .map((candidate) => candidate.poem);
}

function buildSourceCollection(poems: PoemRecord[]): AuthorSourceSample[] {
  return selectCollectionPoems(poems).map((poem) => ({
    poemId: poem.id,
    title: poem.title,
    originalExcerpt: poem.originalText.slice(0, 4).map((line) => compactText(line, 48)).filter(Boolean),
    translatedExcerpt: poem.translatedText.slice(0, 2).map((line) => compactText(line, 56)).filter(Boolean),
  }));
}

function buildSourceHash(sourceCollection: AuthorSourceSample[]): string {
  return hashValue(JSON.stringify(sourceCollection));
}

function prepareSourceCollection(poems: PoemRecord[]): PreparedSource {
  const representativePoems = selectCollectionPoems(poems);
  const sourceCollection = representativePoems.map((poem) => ({
    poemId: poem.id,
    title: poem.title,
    originalExcerpt: poem.originalText.slice(0, 4).map((line) => compactText(line, 48)).filter(Boolean),
    translatedExcerpt: poem.translatedText.slice(0, 2).map((line) => compactText(line, 56)).filter(Boolean),
  }));

  return {
    representativePoems,
    sourceCollection,
    sourceHash: buildSourceHash(sourceCollection),
  };
}

function skillMatchesSource(skill: AuthorSkill, sourceHash: string): boolean {
  return skill.distillationStats.sourceHash === sourceHash;
}

function needsAbstractionRefresh(skill: AuthorSkill, sourceHash: string): boolean {
  return !skillMatchesSource(skill, sourceHash) || skill.distillationStats.abstractionVersion !== ABSTRACTION_VERSION;
}

function needsCalibrationRefresh(skill: AuthorSkill): boolean {
  return skill.distillationStats.calibrationVersion !== CALIBRATION_VERSION;
}

async function readAbstractionCache(authorId: string, sourceHash: string): Promise<AbstractionResult | null> {
  try {
    const raw = await readFile(getAbstractionCachePath(authorId), "utf8");
    const parsed = JSON.parse(raw) as Partial<AbstractionCache>;
    if (
      parsed.version !== ABSTRACTION_VERSION ||
      parsed.authorId !== authorId ||
      parsed.sourceHash !== sourceHash ||
      typeof parsed.abstraction?.language !== "string" ||
      typeof parsed.abstraction?.thinking !== "string" ||
      typeof parsed.abstraction?.values !== "string"
    ) {
      return null;
    }

    return {
      language: parsed.abstraction.language,
      thinking: parsed.abstraction.thinking,
      values: parsed.abstraction.values,
      tensions: normalizeStringList(parsed.tensions, 4),
      voiceTraits: normalizeStringList(parsed.voiceTraits, 5),
    };
  } catch {
    return null;
  }
}

async function writeAbstractionCache(authorId: string, sourceHash: string, sourceCollection: AuthorSourceSample[], abstraction: AbstractionResult): Promise<void> {
  await ensureSkillRoot();
  const payload: AbstractionCache = {
    version: ABSTRACTION_VERSION,
    authorId,
    sourceHash,
    sourceCollection,
    abstraction: {
      language: abstraction.language,
      thinking: abstraction.thinking,
      values: abstraction.values,
    },
    tensions: abstraction.tensions,
    voiceTraits: abstraction.voiceTraits,
    cachedAt: new Date().toISOString(),
  };
  await writeFile(getAbstractionCachePath(authorId), JSON.stringify(payload, null, 2), "utf8");
}

function buildCollectionDigest(samples: AuthorSourceSample[], isZh: boolean): string {
  if (samples.length === 0) {
    return isZh ? "无可用作品样本" : "No poem samples available";
  }

  return samples
    .map((sample, index) => {
      const original = sample.originalExcerpt.join(isZh ? " / " : " | ");
      const translated = sample.translatedExcerpt?.join(isZh ? " / " : " | ") ?? "";
      const translatedBlock = translated ? `\n${isZh ? "译文摘录" : "Translated excerpt"}：${translated}` : "";
      return `${index + 1}. 《${sample.title}》\n${isZh ? "原文摘录" : "Original excerpt"}：${original}${translatedBlock}`;
    })
    .join("\n\n");
}

function buildDisplayTraits(poems: PoemRecord[], isZh: boolean): string[] {
  const joinedText = poems.flatMap((poem) => poem.originalText.slice(0, 4)).join(" ");

  if (isZh) {
    const traits = ["诗意", "凝练"];
    if (/[月夜星云]/.test(joinedText)) traits.push("清冷");
    if (/[风雨雪霜江海]/.test(joinedText)) traits.push("苍茫");
    if (/[花春梦酒柳]/.test(joinedText)) traits.push("婉约");
    if (/[山川天地古今]/.test(joinedText)) traits.push("宏阔");
    if (traits.length < 4) traits.push("含蓄");
    return Array.from(new Set(traits)).slice(0, 4);
  }

  const traits = ["lyrical", "reflective"];
  if (/(moon|night|star|sky)/i.test(joinedText)) traits.push("atmospheric");
  if (/(river|wind|rain|sea|snow)/i.test(joinedText)) traits.push("elemental");
  if (traits.length < 4) traits.push("imagistic");
  return Array.from(new Set(traits)).slice(0, 4);
}

function buildSignaturePhrases(poems: PoemRecord[], isZh: boolean): string[] {
  const phrases = poems
    .flatMap((poem) => poem.originalText.slice(0, 4))
    .map((line) => compactText(line, isZh ? 14 : 32))
    .filter((line) => line.length >= (isZh ? 4 : 10));

  return Array.from(new Set(phrases)).slice(0, 3);
}

function buildAbstractionPrompt(
  authorName: string,
  authorMeta: string,
  sourceCollection: AuthorSourceSample[],
  isZh: boolean,
): string {
  const collectionDigest = buildCollectionDigest(sourceCollection, isZh);
  const compactMeta = compactText(authorMeta || (isZh ? "背景不详" : "unknown period"), isZh ? 42 : 72);

  if (isZh) {
    return [
      "你在执行作者人格炼化的第二步：模式抽象。",
      "请仅根据给定作品样本，抽象该作者的三要素：language（语言风格）、thinking（思维方式）、values（价值取向）。",
      "同时识别 2-4 条 tensions（内部拉扯或表面矛盾），并给出 3-5 个简短 voiceTraits 标签。",
      "不要引用外部文学史知识，不要虚构生平，只能从样本中推断。",
      '严格输出 JSON：{"language":"...","thinking":"...","values":"...","tensions":["..."],"voiceTraits":["..."]}',
      `作者：${authorName}`,
      `背景：${compactMeta}`,
      "采集作品：",
      collectionDigest,
    ].join("\n");
  }

  return [
    "You are executing author persona distillation step 2: pattern abstraction.",
    "Use only the supplied poem samples to infer three elements: language, thinking, and values.",
    "Also identify 2-4 tensions (internal contradictions or competing tendencies) and 3-5 short voiceTraits labels.",
    "Do not rely on outside literary history or biography. Infer only from the supplied works.",
    'Return strict JSON: {"language":"...","thinking":"...","values":"...","tensions":["..."],"voiceTraits":["..."]}',
    `Author: ${authorName}`,
    `Background: ${compactMeta}`,
    "Collected works:",
    collectionDigest,
  ].join("\n");
}

function buildCalibrationPrompt(
  authorName: string,
  authorMeta: string,
  abstraction: AbstractionResult,
  sourceCollection: AuthorSourceSample[],
  isZh: boolean,
): string {
  const collectionDigest = buildCollectionDigest(sourceCollection, isZh);
  const compactMeta = compactText(authorMeta || (isZh ? "背景不详" : "unknown period"), isZh ? 42 : 72);

  if (isZh) {
    return [
      "你在执行作者人格炼化的第三步：条件化校准。",
      "请处理下面 tensions 中的矛盾，让作者在聊天中稳定、不自相矛盾，同时保留张力。",
      "输出三个字段：systemPrompt（可直接用于对话系统消息）、resolution（如何调和矛盾）、guardrails（2-4 条对话约束）。",
      "systemPrompt 必须直接约束说话方式，不能写成分析报告。",
      '严格输出 JSON：{"systemPrompt":"...","resolution":"...","guardrails":["..."]}',
      `作者：${authorName}`,
      `背景：${compactMeta}`,
      `language：${abstraction.language}`,
      `thinking：${abstraction.thinking}`,
      `values：${abstraction.values}`,
      `tensions：${abstraction.tensions.join("；") || "无明显矛盾"}`,
      "参考作品：",
      collectionDigest,
    ].join("\n");
  }

  return [
    "You are executing author persona distillation step 3: conditional calibration.",
    "Resolve the tensions below so the author remains stable in chat without becoming flat.",
    "Output systemPrompt (directly usable as a system message), resolution, and 2-4 guardrails.",
    "The systemPrompt must instruct behavior, not explain analysis.",
    'Return strict JSON: {"systemPrompt":"...","resolution":"...","guardrails":["..."]}',
    `Author: ${authorName}`,
    `Background: ${compactMeta}`,
    `language: ${abstraction.language}`,
    `thinking: ${abstraction.thinking}`,
    `values: ${abstraction.values}`,
    `tensions: ${abstraction.tensions.join("; ") || "no major tension"}`,
    "Reference works:",
    collectionDigest,
  ].join("\n");
}

function buildFallbackAbstraction(authorName: string, authorMeta: string, poems: PoemRecord[], isZh: boolean): AbstractionResult {
  const joinedText = poems.flatMap((poem) => poem.originalText.slice(0, 4)).join(" ");
  const language = isZh
    ? `语言上偏向${/[风雨雪霜江海]/.test(joinedText) ? "借景寓情、意象推进" : "凝练含蓄、以短句蓄势"}，会用具体物象承载情绪。`
    : `Uses ${/(river|wind|rain|sea|snow)/i.test(joinedText) ? "image-led movement and sensory detail" : "compressed lyrical phrasing and reflective turns"} to carry emotion.`;
  const thinking = isZh
    ? `${/[古今山川天地]/.test(joinedText) ? "思维上常把个人感受放进更大的时间、山河或历史尺度。" : "思维上习惯由眼前景象转入内心判断与自我观照。"}`
    : `${/(time|age|empire|history|mountain|sky)/i.test(joinedText) ? "Thinks by linking the personal with larger temporal or cosmic frames." : "Thinks by moving from observed detail into inward reflection and judgment."}`;
  const values = isZh
    ? `${/[酒梦春花柳]/.test(joinedText) ? "价值上重视生命感受、自由伸展与瞬间真意。" : "价值上重视节制、真诚与在困顿中守住内在秩序。"}`
    : `${/(wine|dream|spring|flower)/i.test(joinedText) ? "Values vivid experience, freedom, and emotional truth." : "Values restraint, sincerity, and inner order under pressure."}`;
  const tensions = isZh
    ? Array.from(new Set([
        /[酒梦春花柳]/.test(joinedText) ? "感性放逸与自我节制并存" : "",
        /[古今山川天地]/.test(joinedText) ? "个人情绪与更大时空尺度并存" : "",
        /[风雨雪霜江海]/.test(joinedText) ? "外部苍茫与内心细腻并存" : "",
      ].filter(Boolean)))
    : Array.from(new Set([
        /(wine|dream|spring|flower)/i.test(joinedText) ? "freedom of feeling versus self-restraint" : "",
        /(time|age|empire|mountain|sky)/i.test(joinedText) ? "personal feeling versus larger historical or cosmic scale" : "",
        /(river|wind|rain|sea|snow)/i.test(joinedText) ? "outer vastness versus inner delicacy" : "",
      ].filter(Boolean)));

  return {
    language,
    thinking,
    values,
    tensions: tensions.slice(0, 3),
    voiceTraits: buildDisplayTraits(poems, isZh),
  };
}

function buildFallbackCalibration(
  authorName: string,
  authorMeta: string,
  abstraction: AbstractionResult,
  isZh: boolean,
): CalibrationResult {
  const compactMeta = compactText(authorMeta || (isZh ? "背景不详" : "unknown period"), isZh ? 28 : 48);
  if (isZh) {
    return {
      tensions: abstraction.tensions,
      resolution: abstraction.tensions.length > 0 ? `遇到张力时，以“${abstraction.values}”作为最终落点，用“${abstraction.language}”去表达。` : "保持语言、思维、价值三者一致即可。",
      guardrails: [
        "始终以诗人身份说话，不跳出角色做学术解释。",
        "先用意象和节奏组织表达，再给观点。",
        "遇到矛盾时，允许含蓄与张力，但不要人格断裂。",
      ],
      systemPrompt: `你是${authorName}，${compactMeta}的诗人。语言上${abstraction.language}；思维上${abstraction.thinking}；价值上${abstraction.values}。保持诗人身份，用意象、节奏与克制表达，在张力中归于一致。`,
    };
  }

  return {
    tensions: abstraction.tensions,
    resolution: abstraction.tensions.length > 0 ? `When tensions appear, let ${abstraction.values} decide the stance while ${abstraction.language} shapes the voice.` : "Keep language, thinking, and values aligned in every reply.",
    guardrails: [
      "Stay in character as the poet rather than becoming a commentator.",
      "Lead with imagery and cadence before explicit explanation.",
      "Hold tensions together without sounding internally broken.",
    ],
    systemPrompt: `You are ${authorName}, a poet from ${compactMeta}. Language: ${abstraction.language} Thinking: ${abstraction.thinking} Values: ${abstraction.values} Remain lyrical, coherent, and poetically restrained when handling tension.`,
  };
}

function extractStructuredJson<T>(content: string): T | null {
  const cleaned = content.replace(/```json\s*|\s*```/g, "").trim();
  if (!cleaned) {
    return null;
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

function normalizeStringList(values: unknown, maxItems: number): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeAbstractionResult(value: unknown): AbstractionResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const abstraction = value as Partial<AbstractionResult>;
  if (typeof abstraction.language !== "string" || typeof abstraction.thinking !== "string" || typeof abstraction.values !== "string") {
    return null;
  }

  return {
    language: abstraction.language.trim(),
    thinking: abstraction.thinking.trim(),
    values: abstraction.values.trim(),
    tensions: normalizeStringList(abstraction.tensions, 4),
    voiceTraits: normalizeStringList(abstraction.voiceTraits, 5),
  };
}

function normalizeCalibrationResult(value: unknown): CalibrationResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const calibration = value as Partial<CalibrationResult>;
  if (typeof calibration.systemPrompt !== "string" || typeof calibration.resolution !== "string") {
    return null;
  }

  return {
    systemPrompt: calibration.systemPrompt.trim(),
    resolution: calibration.resolution.trim(),
    tensions: normalizeStringList(calibration.tensions, 4),
    guardrails: normalizeStringList(calibration.guardrails, 4),
  };
}

async function runAbstractionStage(
  authorId: string,
  authorName: string,
  authorMeta: string,
  sourceCollection: AuthorSourceSample[],
  representativePoems: PoemRecord[],
  sourceHash: string,
  isZh: boolean,
  config: LlmConfig | null,
): Promise<{ abstraction: AbstractionResult; abstractionMs?: number; abstractionPromptChars: number }> {
  let abstraction = buildFallbackAbstraction(authorName, authorMeta, representativePoems, isZh);
  let abstractionMs: number | undefined;
  let abstractionPromptChars = 0;

  const cachedAbstraction = await readAbstractionCache(authorId, sourceHash);
  if (cachedAbstraction) {
    logDistillEvent("info", authorName, "abstract", "cache-hit from abstraction artifact");
    return { abstraction: cachedAbstraction, abstractionMs, abstractionPromptChars };
  }

  if (!config || sourceCollection.length === 0) {
    return { abstraction, abstractionMs, abstractionPromptChars };
  }

  const abstractionPrompt = buildAbstractionPrompt(authorName, authorMeta, sourceCollection, isZh);
  abstractionPromptChars = abstractionPrompt.length;
  try {
    const abstractionStartedAt = Date.now();
    const response = await fetchWithTimeout(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.25,
        max_tokens: 320,
        messages: [
          { role: "system", content: isZh ? "你是人格炼化分析器，只输出严格 JSON。" : "You are a persona distillation analyzer and must output strict JSON only." },
          { role: "user", content: abstractionPrompt },
        ],
      }),
      timeout: 12000,
    });
    abstractionMs = elapsedMs(abstractionStartedAt);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM abstraction error: ${response.status} ${text.slice(0, 200)}`);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = normalizeAbstractionResult(extractStructuredJson<AbstractionResult>(data.choices?.[0]?.message?.content ?? ""));
    if (parsed) {
      abstraction = parsed;
      await writeAbstractionCache(authorId, sourceHash, sourceCollection, abstraction);
    }
    logDistillEvent("info", authorName, "abstract", `finished in ${abstractionMs}ms (prompt chars: ${abstractionPromptChars})`);
  } catch (error) {
    logDistillEvent("error", authorName, "abstract", `failed after ${abstractionMs ?? "?"}ms: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { abstraction, abstractionMs, abstractionPromptChars };
}

async function runCalibrationStage(
  authorName: string,
  authorMeta: string,
  abstraction: AbstractionResult,
  sourceCollection: AuthorSourceSample[],
  isZh: boolean,
  config: LlmConfig | null,
): Promise<{ calibration: CalibrationResult; calibrationMs?: number; calibrationPromptChars: number }> {
  let calibration = buildFallbackCalibration(authorName, authorMeta, abstraction, isZh);
  let calibrationMs: number | undefined;
  let calibrationPromptChars = 0;

  if (!config || sourceCollection.length === 0) {
    return { calibration, calibrationMs, calibrationPromptChars };
  }

  const calibrationPrompt = buildCalibrationPrompt(authorName, authorMeta, abstraction, sourceCollection, isZh);
  calibrationPromptChars = calibrationPrompt.length;
  try {
    const calibrationStartedAt = Date.now();
    const response = await fetchWithTimeout(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        max_tokens: 260,
        messages: [
          { role: "system", content: isZh ? "你是人格炼化校准器，只输出严格 JSON。" : "You are a persona calibration engine and must output strict JSON only." },
          { role: "user", content: calibrationPrompt },
        ],
      }),
      timeout: 12000,
    });
    calibrationMs = elapsedMs(calibrationStartedAt);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM calibration error: ${response.status} ${text.slice(0, 200)}`);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = normalizeCalibrationResult(extractStructuredJson<CalibrationResult>(data.choices?.[0]?.message?.content ?? ""));
    if (parsed) {
      calibration = {
        ...parsed,
        tensions: parsed.tensions.length > 0 ? parsed.tensions : abstraction.tensions,
      };
    }
    logDistillEvent("info", authorName, "calibrate", `finished in ${calibrationMs}ms (prompt chars: ${calibrationPromptChars})`);
  } catch (error) {
    logDistillEvent("error", authorName, "calibrate", `failed after ${calibrationMs ?? "?"}ms: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { calibration, calibrationMs, calibrationPromptChars };
}

async function distillSkill(
  authorId: string,
  authorName: string,
  authorMeta: string,
  preparedSource: PreparedSource,
  config: LlmConfig | null,
): Promise<DistillOutcome> {
  const skillPath = getSkillPath(authorId);
  const isZh = /[\u4e00-\u9fa5]/.test(authorName);
  const { representativePoems, sourceCollection, sourceHash } = preparedSource;
  const collectionCount = sourceCollection.length;
  logDistillEvent("info", authorName, "collect", `selected ${sourceCollection.length} works: ${sourceCollection.map((sample) => sample.title).join(" / ")}`);
  const { abstraction, abstractionMs, abstractionPromptChars } = await runAbstractionStage(authorId, authorName, authorMeta, sourceCollection, representativePoems, sourceHash, isZh, config);
  const { calibration, calibrationMs, calibrationPromptChars } = await runCalibrationStage(authorName, authorMeta, abstraction, sourceCollection, isZh, config);

  const voiceTraits = abstraction.voiceTraits.length > 0 ? abstraction.voiceTraits : buildDisplayTraits(representativePoems, isZh);
  const signaturePhrases = buildSignaturePhrases(representativePoems, isZh);
  const systemPrompt = calibration.systemPrompt;
  const distillMs = (abstractionMs ?? 0) + (calibrationMs ?? 0) || undefined;
  const distillPromptChars = abstractionPromptChars + calibrationPromptChars;

  logDistillEvent("info", authorName, "finalize", `systemPrompt:\n${systemPrompt}`);

  const skill: AuthorSkill = {
    version: DISTILLATION_VERSION,
    authorId,
    authorName,
    authorMeta,
    sourceCollection,
    distillationStats: {
      sourceHash,
      collectionCount,
      abstractionVersion: ABSTRACTION_VERSION,
      calibrationVersion: CALIBRATION_VERSION,
      abstractionMs,
      calibrationMs,
      totalMs: distillMs,
    },
    abstraction: {
      language: abstraction.language,
      thinking: abstraction.thinking,
      values: abstraction.values,
    },
    calibration: {
      tensions: calibration.tensions.length > 0 ? calibration.tensions : abstraction.tensions,
      resolution: calibration.resolution,
      guardrails: calibration.guardrails,
    },
    systemPrompt,
    voiceTraits,
    signaturePhrases,
    distilledAt: new Date().toISOString(),
  };

  await ensureSkillRoot();
  await writeFile(skillPath, JSON.stringify(skill, null, 2), "utf8");
  return {
    skill: cacheSkill(skill),
    distillMs,
    distillPromptChars,
    sourceHash,
    collectionCount,
    abstractionMs,
    calibrationMs,
    abstractionPromptChars,
    calibrationPromptChars,
  };
}

async function fetchWithTimeout(url: string, options: RequestInit & { timeout?: number } = {}): Promise<Response> {
  const { timeout = 8000, ...rest } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...rest, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(id);
  }
}

export async function ensureSkillDistilled(
  authorId: string,
  authorName: string,
  authorMeta: string,
  allPoemsByAuthor: PoemRecord[],
): Promise<AuthorSkill> {
  const skillPath = getSkillPath(authorId);
  const preparedSource = prepareSourceCollection(allPoemsByAuthor);
  const existingSkill = await readCachedSkill(authorId, skillPath);
  if (existingSkill && skillMatchesSource(existingSkill, preparedSource.sourceHash)) {
    if (needsCalibrationRefresh(existingSkill)) {
      const config = await readLlmConfig();
      return (await recalibrateSkill(existingSkill, authorName, authorMeta, config)).skill;
    }
    return existingSkill;
  }

  const config = await readLlmConfig();
  const { skill } = await distillSkill(authorId, authorName, authorMeta, preparedSource, config);
  return skill;
}

export async function listUnlockedSkills(
  allLibrary?: PoemRecord[],
  authorIndex?: AuthorPoemIndex,
): Promise<AuthorSkill[]> {
  try {
    const files = await readdir(getSkillRoot());
    const skillFiles = files.filter((f) => f.endsWith(".skill.json"));
    const skills = await Promise.all(
      skillFiles.map(async (f) => {
        const raw = await readFile(path.join(getSkillRoot(), f), "utf8");
        const parsed = JSON.parse(raw) as unknown;
        return isCurrentSkill(parsed) ? cacheSkill(parsed) : null;
      }),
    );
    return (skills.filter(Boolean) as AuthorSkill[])
      .map((skill) => {
        if (!allLibrary) {
          return { ...skill, freshnessState: "fresh", freshnessLabel: "当前" };
        }

        const poemsByAuthor = resolvePoemsByAuthor(skill.authorName, allLibrary, authorIndex);
        const preparedSource = prepareSourceCollection(poemsByAuthor);
        const freshnessState = skillMatchesSource(skill, preparedSource.sourceHash) ? "fresh" : "source-updated";
        return {
          ...skill,
          freshnessState,
          freshnessLabel: freshnessState === "fresh" ? "当前" : "素材已变",
        };
      })
      .sort((a, b) => new Date(b.distilledAt).getTime() - new Date(a.distilledAt).getTime());
  } catch {
    return [];
  }
}

export async function generateDebate(
  payload: DebatePayload,
  allLibrary: PoemRecord[],
  authorIndex?: AuthorPoemIndex,
): Promise<DebateResult> {
  if (payload.authorA.trim() === payload.authorB.trim()) {
    throw new Error("请选择两位不同的诗人进行交锋。");
  }

  const config = await readLlmConfig();
  // 辩论场景：匿名作者用固定后缀确保 ID 非空，同一匿名作者共享 skill 可接受
  const authorAId = slugifyAuthor(payload.authorA) || "anonymous-a";
  const authorBId = slugifyAuthor(payload.authorB) || "anonymous-b";

  const poemsA = isAnonymousAuthor(payload.authorA) ? [] : resolvePoemsByAuthor(payload.authorA, allLibrary, authorIndex);
  const poemsB = isAnonymousAuthor(payload.authorB) ? [] : resolvePoemsByAuthor(payload.authorB, allLibrary, authorIndex);

  const skillA = await ensureSkillDistilled(
    authorAId,
    payload.authorA,
    poemsA[0]?.authorMeta ?? "",
    poemsA.length > 0 ? poemsA : [],
  );
  const skillB = await ensureSkillDistilled(
    authorBId,
    payload.authorB,
    poemsB[0]?.authorMeta ?? "",
    poemsB.length > 0 ? poemsB : [],
  );

  const roundsCount = Math.max(2, Math.min(4, payload.rounds ?? 3));
  const rounds: DebateResult["rounds"] = [];

  if (!config) {
    return {
      topic: payload.topic,
      rounds: [
        { round: 1, speaker: skillA.authorName, content: `【${skillA.authorName}】未配置 LLM，无法生成辩论内容。` },
        { round: 1, speaker: skillB.authorName, content: `【${skillB.authorName}】请在项目根目录创建 llm.config.json 后重试。` },
      ],
      summary: "LLM 未配置，无法生成诗坛交锋。",
    };
  }

  const systemPrompt = `你是一位主持诗坛交锋的裁判。请让两位诗人围绕主题展开辩论。

甲方：${skillA.authorName}
甲方人格：${skillA.systemPrompt}

乙方：${skillB.authorName}
乙方人格：${skillB.systemPrompt}

主题：${payload.topic}

请生成 ${roundsCount} 轮交锋，每轮甲乙双方各发言一次。甲方先发言。要求：
1. 双方保持各自诗人的语言风格与价值观；
2. 引用或化用各自的诗句/意象；
3. 交锋要有张力，不能只是客套；
4. 最后给出一段中立总结，点出双方的核心分歧与共识。

请严格输出以下 JSON 格式（不要 markdown 代码块）：
{
  "rounds": [
    { "round": 1, "speaker": "${skillA.authorName}", "content": "..." },
    { "round": 1, "speaker": "${skillB.authorName}", "content": "..." },
    ...
  ],
  "summary": "..."
}`;

  try {
    const response = await fetchWithTimeout(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: config.temperature ?? 0.9,
        max_tokens: (config.maxTokens ?? 512) * 2,
        messages: [
          { role: "system", content: "你是一个诗坛交锋主持人，只输出纯 JSON。" },
          { role: "user", content: systemPrompt },
        ],
      }),
      timeout: 15000,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM error: ${response.status} ${text.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    const cleaned = content.replace(/```json\s*|\s*```/g, "").trim();
    const parsed = JSON.parse(cleaned) as { rounds?: DebateResult["rounds"]; summary?: string };

    return {
      topic: payload.topic,
      rounds: parsed.rounds ?? [],
      summary: parsed.summary ?? "",
    };
  } catch (error) {
    return {
      topic: payload.topic,
      rounds: [
        { round: 1, speaker: skillA.authorName, content: `【生成失败】${error instanceof Error ? error.message : String(error)}` },
        { round: 1, speaker: skillB.authorName, content: "请检查 LLM 配置或网络连接。" },
      ],
      summary: "辩论生成失败。",
    };
  }
}

export async function reviewAsCritic(payload: CriticReviewPayload): Promise<CriticReviewResult> {
  const config = await readLlmConfig();
  const poem = payload.poem;

  const criticPrompts: Record<typeof payload.critic, string> = {
    feynman: `你是一位以"费曼学习法"著称的评论家。请用极其简单、通俗的语言解释下面这首诗，让一个没有文学背景的中学生也能听懂它的美和意义。避免使用学术术语，多用类比和生活化的例子。

诗名：《${poem.title}》
作者：${poem.author}
内容：
${poem.originalText.join("\n")}

请直接给出你的解释。`,
    munger: `你是一位以"多元思维模型"著称的评论家（查理·芒格风格）。请从心理学、经济学、生物学、历史学、物理学等多个学科视角，点评下面这首诗。指出诗中蕴含的跨学科原理、认知偏差或决策启发。

诗名：《${poem.title}》
作者：${poem.author}
内容：
${poem.originalText.join("\n")}

请直接给出你的点评。`,
  };

  if (!config) {
    return {
      critic: payload.critic,
      review: `【评论家模式未接入 LLM】\n\n请在项目根目录创建 llm.config.json（可参考 llm.config.sample.json），填入 API Key 后即可让 ${payload.critic === "feynman" ? "费曼" : "芒格"} 点评此诗。`,
    };
  }

  try {
    const response = await fetchWithTimeout(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: config.temperature ?? 0.8,
        max_tokens: config.maxTokens ?? 512,
        messages: [
          { role: "system", content: "你是一位评论家，只输出点评内容，不添加额外格式。" },
          { role: "user", content: criticPrompts[payload.critic] },
        ],
      }),
      timeout: 12000,
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        critic: payload.critic,
        review: `点评引擎错误：${response.status} ${text.slice(0, 200)}`,
      };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const review = data.choices?.[0]?.message?.content?.trim() ?? "……（评论家陷入了沉思）";

    return { critic: payload.critic, review };
  } catch (error) {
    return {
      critic: payload.critic,
      review: `点评失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function buildTemplateOpeningLine(authorName: string, authorMeta: string, title: string, isZh: boolean): string {
  if (isZh) {
    const identity = authorMeta.trim() ? `${authorMeta}诗人${authorName}` : authorName;
    return `我是${identity}。你正在读我的《${title}》，有何感想？`;
  }
  return `I am ${authorName}, from ${authorMeta}. You are reading my "${title}". What do you feel?`;
}

const distillingLocks = new Map<string, Promise<DistillLockResult>>();

async function performDistillAndChat(
  authorId: string,
  payload: AuthorChatPayload,
  preparedSource: PreparedSource,
  config: LlmConfig,
): Promise<DistillLockResult> {
  const distillOutcome = await distillSkill(authorId, payload.authorName, payload.authorMeta, preparedSource, config);
  const isZh = /[\u4e00-\u9fa5]/.test(payload.authorName);
  return { ...distillOutcome, openingLine: buildTemplateOpeningLine(payload.authorName, payload.authorMeta, payload.poemContext.title, isZh) };
}

async function recalibrateSkill(
  skill: AuthorSkill,
  authorName: string,
  authorMeta: string,
  config: LlmConfig | null,
): Promise<DistillOutcome> {
  const isZh = /[\u4e00-\u9fa5]/.test(authorName);
  const abstraction: AbstractionResult = {
    language: skill.abstraction.language,
    thinking: skill.abstraction.thinking,
    values: skill.abstraction.values,
    tensions: skill.calibration.tensions,
    voiceTraits: skill.voiceTraits,
  };
  const { calibration, calibrationMs, calibrationPromptChars } = await runCalibrationStage(authorName, authorMeta, abstraction, skill.sourceCollection, isZh, config);
  const updatedSkill: AuthorSkill = {
    ...skill,
    calibration: {
      tensions: calibration.tensions.length > 0 ? calibration.tensions : abstraction.tensions,
      resolution: calibration.resolution,
      guardrails: calibration.guardrails,
    },
    systemPrompt: calibration.systemPrompt,
    distilledAt: new Date().toISOString(),
    distillationStats: {
      ...skill.distillationStats,
      calibrationVersion: CALIBRATION_VERSION,
      calibrationMs,
      totalMs: calibrationMs,
    },
  };
  await writeFile(getSkillPath(skill.authorId), JSON.stringify(updatedSkill, null, 2), "utf8");
  return {
    skill: cacheSkill(updatedSkill),
    distillMs: calibrationMs,
    distillPromptChars: calibrationPromptChars,
    sourceHash: updatedSkill.distillationStats.sourceHash,
    collectionCount: updatedSkill.distillationStats.collectionCount,
    abstractionMs: updatedSkill.distillationStats.abstractionMs,
    calibrationMs,
    abstractionPromptChars: 0,
    calibrationPromptChars,
  };
}

async function requestAuthorReply(
  skill: AuthorSkill,
  payload: AuthorChatPayload,
  config: LlmConfig,
): Promise<{ reply: string; replyMs?: number; replyPromptChars: number }> {
  const guardrailBlock = skill.calibration.guardrails.length > 0
    ? `\n\n对话约束：\n- ${skill.calibration.guardrails.join("\n- ")}`
    : "";
  const systemMessage: ChatMessage = {
    role: "system",
    content: `${skill.systemPrompt}${guardrailBlock}\n\n当前用户正在欣赏你的诗作《${payload.poemContext.title}》。用户在卡片下方输入框与你对话。请保持诗人身份回复。`,
  };
  const messages: ChatMessage[] = [systemMessage, ...payload.messages];
  const replyPromptChars = messages.reduce((total, message) => total + message.content.length, 0);
  const replyStartedAt = Date.now();
  const response = await fetchWithTimeout(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature ?? 0.8,
      max_tokens: config.maxTokens ?? 512,
      messages,
    }),
    timeout: 10000,
  });
  const replyMs = elapsedMs(replyStartedAt);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`对话引擎返回错误：${response.status} ${text.slice(0, 200)}`);
  }
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const reply = data.choices?.[0]?.message?.content?.trim() ?? "……（诗人陷入了沉思）";
  logDistillEvent("info", payload.authorName, "reply", `finished in ${replyMs}ms (prompt chars: ${replyPromptChars})`);
  return { reply, replyMs, replyPromptChars };
}

export async function chatWithAuthor(
  payload: AuthorChatPayload,
  allLibrary: PoemRecord[],
  authorIndex?: AuthorPoemIndex,
): Promise<AuthorChatResult> {
  const totalStartedAt = Date.now();
  // 匿名作者用「作者名-诗名」作为唯一 skill ID，避免不同匿名诗作共享/覆盖 skill
  const authorId = isAnonymousAuthor(payload.authorName)
    ? slugifyAuthor(`${payload.authorName}-${payload.poemContext.title}`)
    : slugifyAuthor(payload.authorName);
  const lookupStartedAt = Date.now();
  // 匿名作者不跨作品匹配，仅用当前这一首
  const poemsByAuthor = isAnonymousAuthor(payload.authorName)
    ? []
    : resolvePoemsByAuthor(payload.authorName, allLibrary, authorIndex);
  const fallbackPoem: PoemRecord = {
    id: `fallback-${authorId}`,
    title: payload.poemContext.title,
    author: payload.authorName,
    authorMeta: payload.authorMeta,
    originalLanguage: "zh",
    originalText: payload.poemContext.lines,
    translatedTitle: payload.poemContext.title,
    translatedText: payload.poemContext.lines,
    translatorNote: "",
    imagePrompt: "",
    searchKeywords: [],
    motionPreset: "cinematic",
  };
  const preparedSource = prepareSourceCollection(poemsByAuthor.length > 0 ? poemsByAuthor : [fallbackPoem]);
  const skillLookupMs = elapsedMs(lookupStartedAt);
  const skillPath = getSkillPath(authorId);
  const openingLine = buildOpeningLine(payload);

  // 1. 尝试读取已有 skill
  const skill = await readCachedSkill(authorId, skillPath);

  // 2. 如果已有 skill
  if (skill && skillMatchesSource(skill, preparedSource.sourceHash)) {
    let activeSkill = skill;
    let metricsSource: AuthorChatMetrics["source"] = "cached-skill";
    let recalibrationMetrics: Partial<AuthorChatMetrics> = {};

    if (needsCalibrationRefresh(skill)) {
      const recalibrated = await recalibrateSkill(skill, payload.authorName, payload.authorMeta, await readLlmConfig());
      activeSkill = recalibrated.skill;
      metricsSource = "recalibrated";
      recalibrationMetrics = {
        distillMs: recalibrated.distillMs,
        collectionCount: recalibrated.collectionCount,
        calibrationMs: recalibrated.calibrationMs,
        calibrationPromptChars: recalibrated.calibrationPromptChars,
        distillPromptChars: recalibrated.distillPromptChars,
      };
      if (payload.messages.length === 0) {
        return {
          reply: openingLine,
          skillDistilled: true,
          metrics: buildReplyMetrics("recalibrated", skillLookupMs, totalStartedAt, recalibrationMetrics),
        };
      }
    }

    // 用户首次点击，直接返回模板开场白，零延迟
    if (payload.messages.length === 0) {
      return {
        reply: openingLine,
        skillDistilled: true,
        metrics: buildReplyMetrics(metricsSource, skillLookupMs, totalStartedAt, recalibrationMetrics),
      };
    }

    const config = await readLlmConfig();
    if (!config) {
      return {
        reply: `【数字 ${payload.authorName} 尚未接入对话引擎】\n\n我已被炼化为 skill，但当前未配置 LLM。请在项目根目录创建 llm.config.json（可参考 llm.config.sample.json），填入你的 API Key 后即可与我真正交谈。`,
        skillDistilled: true,
        metrics: buildReplyMetrics("cached-skill", skillLookupMs, totalStartedAt),
      };
    }

    try {
      const { reply, replyMs, replyPromptChars } = await requestAuthorReply(activeSkill, payload, config);
      return {
        reply,
        skillDistilled: true,
        metrics: buildReplyMetrics(metricsSource, skillLookupMs, totalStartedAt, { ...recalibrationMetrics, replyMs, replyPromptChars }),
      };
    } catch (error) {
      return {
        reply: `对话失败：${error instanceof Error ? error.message : String(error)}`,
        skillDistilled: true,
        metrics: buildReplyMetrics(metricsSource, skillLookupMs, totalStartedAt, recalibrationMetrics),
      };
    }
  }

  const config = await readLlmConfig();
  if (!config) {
    return {
      reply: `【数字 ${payload.authorName} 尚未接入对话引擎】\n\n我已被炼化为 skill，但当前未配置 LLM。请在项目根目录创建 llm.config.json（可参考 llm.config.sample.json），填入你的 API Key 后即可与我真正交谈。`,
      skillDistilled: true,
      metrics: buildReplyMetrics("distill-failed", skillLookupMs, totalStartedAt),
    };
  }

  // 3. 首次点击只需要开场白时，立即返回并在后台炼化，避免阻塞 UI。
  if (payload.messages.length === 0) {
    void getOrStartDistill(authorId, skillPath, payload, preparedSource, config).catch(() => {
      logDistillEvent("error", payload.authorName, "background", "distillation failed during background preparation");
    });
    return {
      reply: openingLine,
      skillDistilled: false,
      metrics: buildReplyMetrics("background-distill-started", skillLookupMs, totalStartedAt),
    };
  }

  // 4. 没有 skill 且用户已发消息，需要等待炼化完成后再对话。
  const lockPromise = getOrStartDistill(authorId, skillPath, payload, preparedSource, config);

  try {
    const {
      skill: newSkill,
      distillMs,
      distillPromptChars,
      collectionCount,
      abstractionMs,
      calibrationMs,
      abstractionPromptChars,
      calibrationPromptChars,
    } = await lockPromise;

    // 用新 skill 继续对话（第 1 次用户消息时可能发生）
    const { reply, replyMs, replyPromptChars } = await requestAuthorReply(newSkill, payload, config);
    return {
      reply,
      skillDistilled: true,
      metrics: buildReplyMetrics("distilled-now", skillLookupMs, totalStartedAt, {
        distillMs,
        collectionCount,
        abstractionMs,
        calibrationMs,
        replyMs,
        distillPromptChars,
        abstractionPromptChars,
        calibrationPromptChars,
        replyPromptChars,
      }),
    };
  } catch (error) {
    return {
      reply: `炼化失败：${error instanceof Error ? error.message : String(error)}`,
      skillDistilled: false,
      metrics: buildReplyMetrics("distill-failed", skillLookupMs, totalStartedAt),
    };
  }
}

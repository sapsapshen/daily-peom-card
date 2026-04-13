import { app, BrowserWindow, clipboard, ipcMain, nativeImage, screen, shell } from "electron";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants, existsSync } from "node:fs";
import { access, copyFile, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { poems } from "../shared/poems";
import { getLanguageLabel, resolvePoemVersion } from "../shared/poemLanguage";
import { getBrandIconDataUrl } from "../shared/brandIcon";
import { addRecommendedIds, readFetchedPoems, readRecommendedArchive, saveFetchedPoems } from "./poemArchive";
import { fetchPoetryDBPoems, fetchPoetryFoundationPoems, fetchSouYunPoems } from "./poemFetchers";
import { chatWithAuthor, generateDebate, invalidateLlmConfigCache, listUnlockedSkills, reviewAsCritic } from "./authorSkill";
import type { LlmConfig } from "../shared/types";
import type {
  AuthorAgentPayload,
  AppState,
  CardBackAsset,
  LicenseActivationResult,
  MotionRuntimeStatus,
  MotionAsset,
  PaymentConfigStatus,
  PoemLibraryResponse,
  PoemRecord,
  PreviewImageAsset,
  SaveRichCardPayload,
  SaveTextPayload,
  SavedCardBundle,
  SharePayload,
  SharePlatform,
} from "../shared/types";

interface PoemLibraryContext {
  response: PoemLibraryResponse;
  authorIndex: Map<string, PoemRecord[]>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface PaymentConfigFile {
  providerLabel: string;
  purchaseUrl?: string;
  licenseHash?: string;
  supportMessage: string;
}

const defaultState: AppState = {
  seenPoemIds: [],
  premiumUnlocked: false,
  premiumSource: "free",
  dailyDecks: {},
  savedTextCount: 0,
  savedCardCount: 0,
};

const poemLookup = new Map(poems.map((poem) => [poem.id, poem]));
let poemLibraryCache: Promise<PoemLibraryContext> | null = null;
let motionSkillPreparePromise: Promise<string> | null = null;

const getProjectRoot = () => (app.isPackaged ? path.dirname(process.execPath) : process.cwd());
const getRuntimeRoot = () => (app.isPackaged ? path.join(app.getPath("userData"), ".daily_runtime") : path.join(getProjectRoot(), ".daily_runtime"));
const getShareDraftRoot = () => path.join(getRuntimeRoot(), "share_drafts");
const getImageRoot = () => path.join(getRuntimeRoot(), "images");
const getMotionRoot = () => path.join(getRuntimeRoot(), "motion");
const getDailySaveRoot = () => path.join(getProjectRoot(), "daily_save");
const getMarkdownPath = () => path.join(getProjectRoot(), "daily_poem_archive.md");
const getStatePath = () => path.join(app.getPath("userData"), "daily-poem-state.json");
const getBundledMotionSkillArchivePath = () => path.join(process.resourcesPath, "motion-skill-template.zip");
const getPreparedMotionSkillRoot = () => path.join(app.getPath("userData"), "motion-skill");
const getMotionSkillRoot = () => {
  if (process.env.AGENT_IMAGE_MOTION_ROOT) {
    return process.env.AGENT_IMAGE_MOTION_ROOT;
  }

  if (app.isPackaged) {
    return getPreparedMotionSkillRoot();
  }

  return "D:\\YunXue\\agent-image-motion-skill";
};
const getPoemLibraryPath = () => path.join(getProjectRoot(), "poems.library.json");
const getPaymentConfigPath = () => path.join(getProjectRoot(), "premium.config.json");
const getLlmConfigPath = () => path.join(getProjectRoot(), "llm.config.json");

const getMotionNodeExecutable = (skillRoot: string) => {
  const bundledNodePath = path.join(skillRoot, "node_modules", ".bin", process.platform === "win32" ? "node.exe" : "node");
  if (existsSync(bundledNodePath)) {
    return bundledNodePath;
  }

  return process.execPath;
};

const getMotionRuntimeSource = (): MotionRuntimeStatus["source"] => {
  if (process.env.AGENT_IMAGE_MOTION_ROOT) {
    return "external-env";
  }

  return app.isPackaged ? "bundled" : "external-default";
};

const isPreparedMotionSkillUsable = (skillRoot: string) => {
  const requiredPaths = [
    path.join(skillRoot, "bin", "agent-image-motion.mjs"),
    path.join(skillRoot, "lib", "run-agent-image-motion.mjs"),
    path.join(skillRoot, "node_modules", "image-size"),
    path.join(skillRoot, "node_modules", "jimp"),
    path.join(skillRoot, "node_modules", ".bin", process.platform === "win32" ? "remotion.cmd" : "remotion"),
  ];

  return requiredPaths.every((targetPath) => existsSync(targetPath));
};

const extractMotionRuntimeArchive = async (archivePath: string, destinationRoot: string) => {
  const result = spawnSync(
    "tar.exe",
    ["-xf", archivePath, "-C", destinationRoot],
    {
      windowsHide: true,
      stdio: "ignore",
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`tar.exe extraction exited with code ${result.status}`);
  }
};

const materializeVendorNodeModules = async (preparedRoot: string) => {
  const vendorNodeModulesPath = path.join(preparedRoot, "vendor_node_modules");
  const nodeModulesPath = path.join(preparedRoot, "node_modules");

  if (!existsSync(vendorNodeModulesPath)) {
    return;
  }

  await rm(nodeModulesPath, { recursive: true, force: true });

  try {
    await rename(vendorNodeModulesPath, nodeModulesPath);
  } catch {
    await cp(vendorNodeModulesPath, nodeModulesPath, { recursive: true, force: true });
    await rm(vendorNodeModulesPath, { recursive: true, force: true });
  }

  if (existsSync(vendorNodeModulesPath)) {
    await cp(vendorNodeModulesPath, nodeModulesPath, { recursive: true, force: true });
    await rm(vendorNodeModulesPath, { recursive: true, force: true });
  }
};

const ensureBundledMotionSkillReady = async () => {
  if (!app.isPackaged || process.env.AGENT_IMAGE_MOTION_ROOT) {
    return getMotionSkillRoot();
  }

  if (motionSkillPreparePromise) {
    return motionSkillPreparePromise;
  }

  motionSkillPreparePromise = (async () => {
    const preparedRoot = getPreparedMotionSkillRoot();
    if (isPreparedMotionSkillUsable(preparedRoot)) {
      return preparedRoot;
    }

    const templateArchivePath = getBundledMotionSkillArchivePath();
    const extractParentRoot = path.join(app.getPath("userData"), "motion-skill-extract");
    const extractedTemplateRoot = path.join(extractParentRoot, "motion-skill-template");
    if (!existsSync(templateArchivePath)) {
      throw new Error(`Bundled motion skill archive not found at ${templateArchivePath}`);
    }

    await rm(preparedRoot, { recursive: true, force: true });
    await rm(extractParentRoot, { recursive: true, force: true });
    await mkdir(extractParentRoot, { recursive: true });
    await extractMotionRuntimeArchive(templateArchivePath, extractParentRoot);
    await cp(extractedTemplateRoot, preparedRoot, { recursive: true, force: true });
    await rm(extractParentRoot, { recursive: true, force: true });
    await materializeVendorNodeModules(preparedRoot);

    if (!isPreparedMotionSkillUsable(preparedRoot)) {
      throw new Error(`Bundled motion skill is incomplete after preparation at ${preparedRoot}`);
    }

    return preparedRoot;
  })();

  try {
    return await motionSkillPreparePromise;
  } finally {
    motionSkillPreparePromise = null;
  }
};

const getMotionRuntimeStatus = async (): Promise<MotionRuntimeStatus> => {
  let skillRoot = getMotionSkillRoot();
  try {
    skillRoot = await ensureBundledMotionSkillReady();
  } catch {
    // Continue and report the concrete missing paths below.
  }
  const nodeExecutable = getMotionNodeExecutable(skillRoot);
  const binPath = path.join(skillRoot, "bin", "agent-image-motion.mjs");
  const runnerPath = path.join(skillRoot, "lib", "run-agent-image-motion.mjs");
  const remotionLauncher = path.join(skillRoot, "node_modules", ".bin", process.platform === "win32" ? "remotion.cmd" : "remotion");
  const issues: string[] = [];

  if (!existsSync(skillRoot)) {
    issues.push(`Motion skill root not found: ${skillRoot}`);
  }
  if (!existsSync(binPath)) {
    issues.push(`Motion CLI not found: ${binPath}`);
  }
  if (!existsSync(runnerPath)) {
    issues.push(`Motion runtime library not found: ${runnerPath}`);
  }
  if (!existsSync(nodeExecutable)) {
    issues.push(`Motion runtime Node executable not found: ${nodeExecutable}`);
  }
  if (!existsSync(remotionLauncher)) {
    issues.push(`Remotion launcher not found: ${remotionLauncher}`);
  }

  let version: string | undefined;
  if (issues.length === 0) {
    const result = spawnSync(nodeExecutable, [binPath, "--version"], {
      cwd: getProjectRoot(),
      windowsHide: true,
      encoding: "utf8",
      timeout: 15000,
      env: nodeExecutable === process.execPath ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" } : process.env,
    });

    if (result.error) {
      issues.push(result.error.message);
    } else if (result.status !== 0) {
      issues.push((result.stderr || result.stdout || `Motion runtime exited with code ${result.status}`).trim());
    } else {
      version = (result.stdout || "").trim() || undefined;
    }
  }

  return {
    ready: issues.length === 0,
    source: getMotionRuntimeSource(),
    skillRoot,
    nodeExecutable,
    remotionLauncher,
    version,
    issues,
  };
};

const motionRenderProfile = {
  preview: {
    version: "fast-preview-v2",
    width: 720,
    height: 1088,
    fps: 15,
    durationInFrames: 54,
    codec: "h264",
    atmosphere: false,
    particles: false,
    floatingCards: false,
    sweepLight: false,
    texture: false,
    intensity: 0.36,
  },
  export: {
    version: "balanced-export-v1",
    width: 900,
    height: 1360,
    fps: 18,
    durationInFrames: 60,
    codec: "h264",
    atmosphere: true,
    particles: false,
    floatingCards: false,
    sweepLight: false,
    texture: false,
    intensity: 0.42,
  },
} as const;

type MotionRenderProfile = (typeof motionRenderProfile)[keyof typeof motionRenderProfile];

const toRuntimeAssetUrl = (absolutePath: string) => {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (!rendererUrl) {
    return pathToFileURL(absolutePath).toString();
  }

  const relativeRuntimePath = path.relative(getRuntimeRoot(), absolutePath).replace(/\\/g, "/");
  return new URL(`/__daily_runtime/${relativeRuntimePath}`, rendererUrl).toString();
};

const hashString = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
};

const deckBackThemes = [
  {
    prompt:
      "luxury vertical card back illustration, centered emblem, bronze frame, obsidian panels, crimson core, fantasy game card back, symmetrical composition, no text, premium polished painting",
    searchKeywords: [
      "luxury vertical card back bronze emblem no text",
      "premium fantasy card back illustration symmetrical",
      "ornate trading card back bronze red emblem",
    ],
  },
  {
    prompt:
      "luxury vertical card back illustration, centered moon crest, midnight enamel, antique gold frame, deep navy panels, symmetrical premium composition, no text, elegant game art",
    searchKeywords: [
      "luxury vertical card back gold navy emblem no text",
      "premium tarot style card back illustration symmetrical",
      "ornate mystical card back blue gold vertical",
    ],
  },
  {
    prompt:
      "luxury vertical card back illustration, centered sun crest, black lacquer, copper frame, amber highlights, symmetrical premium composition, no text, art deco game card back",
    searchKeywords: [
      "luxury vertical card back black copper emblem no text",
      "premium art deco card back illustration symmetrical",
      "ornate black gold card back vertical premium",
    ],
  },
  {
    prompt:
      "luxury vertical card back illustration, centered floral sigil, dark emerald enamel, aged gold frame, moonlit botanical ornament, symmetrical premium composition, no text",
    searchKeywords: [
      "luxury vertical card back emerald gold emblem no text",
      "premium botanical card back illustration symmetrical",
      "ornate fantasy card back green gold vertical",
    ],
  },
];

const slugify = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "poem";

  const buildPoemAssetSlug = (poem: PoemRecord, dateLabel: string) => `${resolveDateSlug(dateLabel)}_${slugify(poem.id)}`;

const ensureDir = async (dirPath: string) => {
  await mkdir(dirPath, { recursive: true });
};

const exists = async (targetPath: string) => {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const resolveDateSlug = (dateLabel: string) => dateLabel.replace(/[^0-9-]/g, "") || new Date().toISOString().slice(0, 10);
const sha256 = (value: string) => createHash("sha256").update(value.trim()).digest("hex");

const readState = async (): Promise<AppState> => {
  try {
    const raw = await readFile(getStatePath(), "utf8");
    return { ...defaultState, ...JSON.parse(raw) } as AppState;
  } catch {
    return structuredClone(defaultState);
  }
};

const writeState = async (state: AppState) => {
  await ensureDir(path.dirname(getStatePath()));
  await writeFile(getStatePath(), JSON.stringify(state, null, 2), "utf8");
  return state;
};

const isValidPoemRecord = (value: unknown): value is PoemRecord => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const poem = value as Record<string, unknown>;
  return (
    typeof poem.id === "string" &&
    typeof poem.title === "string" &&
    typeof poem.author === "string" &&
    typeof poem.authorMeta === "string" &&
    (poem.originalLanguage === "zh" || poem.originalLanguage === "en") &&
    Array.isArray(poem.originalText) &&
    poem.originalText.every((line) => typeof line === "string") &&
    typeof poem.translatedTitle === "string" &&
    Array.isArray(poem.translatedText) &&
    poem.translatedText.every((line) => typeof line === "string") &&
    typeof poem.translatorNote === "string" &&
    typeof poem.imagePrompt === "string" &&
    Array.isArray(poem.searchKeywords) &&
    poem.searchKeywords.every((line) => typeof line === "string") &&
    (poem.motionPreset === "editorial" || poem.motionPreset === "cinematic" || poem.motionPreset === "gallery")
  );
};

const buildAuthorIndex = (library: PoemRecord[]) => {
  const authorIndex = new Map<string, PoemRecord[]>();
  for (const poem of library) {
    const bucket = authorIndex.get(poem.author);
    if (bucket) {
      bucket.push(poem);
    } else {
      authorIndex.set(poem.author, [poem]);
    }
  }
  return authorIndex;
};

const invalidatePoemLibraryCache = () => {
  poemLibraryCache = null;
};

const readPoemLibrary = async (): Promise<PoemLibraryResponse> => {
  const externalPath = getPoemLibraryPath();
  let baseLibrary: PoemRecord[] = poems;
  let source: PoemLibraryResponse["source"] = "built-in";
  let externalFilePath: string | undefined;

  try {
    const raw = await readFile(externalPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const validRecords = parsed.filter(isValidPoemRecord);
      if (validRecords.length > 0) {
        baseLibrary = validRecords;
        source = "external";
        externalFilePath = externalPath;
      }
    }
  } catch {
    // Fall through to built-in poems.
  }

  const fetchedPoems = await readFetchedPoems();
  const combinedLibrary = [...baseLibrary, ...fetchedPoems];

  if (fetchedPoems.length > 0) {
    source = source === "external" ? "external+fetched" : "built-in+fetched";
  }

  return {
    library: combinedLibrary,
    source,
    path: externalFilePath,
    count: combinedLibrary.length,
  };
};

const getPoemLibraryContext = async (): Promise<PoemLibraryContext> => {
  if (!poemLibraryCache) {
    poemLibraryCache = (async () => {
      const response = await readPoemLibrary();
      return {
        response,
        authorIndex: buildAuthorIndex(response.library),
      };
    })();
  }

  return poemLibraryCache;
};

const getPoemLibrary = async (): Promise<PoemLibraryResponse> => (await getPoemLibraryContext()).response;

const readPaymentConfig = async (): Promise<PaymentConfigFile> => {
  const fallback: PaymentConfigFile = {
    providerLabel: "未配置购买页",
    supportMessage: "复制 premium.config.sample.json 为 premium.config.json 后，可接入真实购买链接和许可证哈希。",
  };

  try {
    const raw = await readFile(getPaymentConfigPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<PaymentConfigFile>;
    return {
      providerLabel: typeof parsed.providerLabel === "string" ? parsed.providerLabel : fallback.providerLabel,
      purchaseUrl: typeof parsed.purchaseUrl === "string" ? parsed.purchaseUrl : undefined,
      licenseHash: typeof parsed.licenseHash === "string" ? parsed.licenseHash.toLowerCase() : undefined,
      supportMessage: typeof parsed.supportMessage === "string" ? parsed.supportMessage : fallback.supportMessage,
    };
  } catch {
    return fallback;
  }
};

const getPaymentStatus = async (): Promise<PaymentConfigStatus> => {
  const config = await readPaymentConfig();
  const state = await readState();
  return {
    configured: Boolean(config.purchaseUrl || config.licenseHash),
    providerLabel: config.providerLabel,
    purchaseUrlConfigured: Boolean(config.purchaseUrl),
    supportMessage: config.supportMessage,
    activatedWith: state.premiumSource,
  };
};

const openPurchaseLink = async () => {
  const config = await readPaymentConfig();
  if (!config.purchaseUrl) {
    return {
      opened: false,
      message: "尚未配置真实购买链接，请先创建 premium.config.json。",
    };
  }

  await shell.openExternal(config.purchaseUrl);
  return {
    opened: true,
    message: "已打开购买页面。支付完成后，请回到应用输入许可证完成激活。",
  };
};

const activateLicense = async (licenseKey: string): Promise<LicenseActivationResult> => {
  const config = await readPaymentConfig();
  const currentState = await readState();
  const normalized = licenseKey.trim();

  if (!config.licenseHash) {
    return {
      success: false,
      state: currentState,
      message: "当前未配置 licenseHash，无法验证许可证。",
    };
  }

  if (!normalized) {
    return {
      success: false,
      state: currentState,
      message: "请输入许可证后再激活。",
    };
  }

  if (sha256(normalized) !== config.licenseHash) {
    return {
      success: false,
      state: currentState,
      message: "许可证不匹配，请检查输入或重新发放许可证。",
    };
  }

  const nextState: AppState = {
    ...currentState,
    premiumUnlocked: true,
    premiumSource: "license",
    premiumActivatedAt: new Date().toISOString(),
  };

  await writeState(nextState);
  return {
    success: true,
    state: nextState,
    message: "许可证已验证，高级版已解锁。",
  };
};

const buildMarkdownBlock = ({ poem, dateLabel, profileName, language }: SaveTextPayload) => {
  const resolvedLanguage = payloadLanguage({ poem, language });
  const version = resolvePoemVersion(poem, resolvedLanguage);

  return [
    `## ${dateLabel} · ${version.title} · ${poem.author}`,
    "",
    `- 作者信息：${poem.authorMeta}`,
    `- 当前语言：${getLanguageLabel(resolvedLanguage)}`,
    `- 展示风格：${profileName}`,
    `- 配图提示：${poem.imagePrompt}`,
    "",
    `### ${version.heading}`,
    "",
    ...version.lines,
    "",
    `> ${poem.translatorNote}`,
    "",
    "---",
    "",
  ].join("\n");
};

const payloadLanguage = (payload: { poem: PoemRecord; language?: "zh" | "en" }) => payload.language ?? payload.poem.originalLanguage;

const appendMarkdownSave = async (payload: SaveTextPayload) => {
  await ensureDir(getProjectRoot());
  const block = buildMarkdownBlock(payload);
  await writeFile(getMarkdownPath(), block, { encoding: "utf8", flag: "a" });
  return { markdownPath: getMarkdownPath() };
};

const downloadToFile = async (url: string, outputPath: string) => {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "daily-poem-card/0.1",
    },
  });

  if (!response.ok) {
    throw new Error(`Image request failed: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await writeFile(outputPath, Buffer.from(arrayBuffer));
};

const searchBraveImage = async (query: string) => {
  const token = process.env.BRAVE_API_KEY;
  if (!token) {
    return null;
  }

  const endpoint = `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=1`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": token,
    },
  });

  if (!response.ok) {
    throw new Error(`Brave image search failed: ${response.status}`);
  }

  const json = (await response.json()) as {
    results?: Array<{ properties?: { url?: string } }>;
  };

  return json.results?.[0]?.properties?.url ?? null;
};

const buildBraveQuery = (poem: PoemRecord) =>
  [
    ...poem.searchKeywords,
    "cinematic",
    "atmospheric",
    "moody lighting",
    "no people",
    "high contrast",
    "editorial",
  ].join(" ");

const buildPollinationsUrl = (prompt: string) => {
  const encodedPrompt = encodeURIComponent(
    `${prompt}, cinematic atmosphere, rich contrast, layered depth, moody shadows, luminous highlights, elegant composition, no people, no text, high detail`,
  );
  return `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1600&height=2000&nologo=true`;
};

const resolveSourceImage = async (poem: PoemRecord, dateLabel: string) => {
  await ensureDir(getImageRoot());
  const datedSlug = buildPoemAssetSlug(poem, dateLabel);
  const outputPath = path.join(getImageRoot(), `${datedSlug}.jpg`);

  if (await exists(outputPath)) {
    return {
      sourceImagePath: outputPath,
      provider: process.env.BRAVE_API_KEY ? "brave" : "pollinations",
      prompt: poem.imagePrompt,
    } as const;
  }

  try {
    const braveQuery = buildBraveQuery(poem);
    const braveResult = await searchBraveImage(braveQuery);
    if (braveResult) {
      await downloadToFile(braveResult, outputPath);
      return {
        sourceImagePath: outputPath,
        provider: "brave" as const,
        prompt: braveQuery,
      };
    }
  } catch {
    // Fall through to generated image.
  }

  await downloadToFile(buildPollinationsUrl(poem.imagePrompt), outputPath);
  return {
    sourceImagePath: outputPath,
    provider: "pollinations" as const,
    prompt: poem.imagePrompt,
  };
};

const getAppWindowIcon = () => {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(getProjectRoot(), "build", "icon.png");

  const icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty()) {
    return icon.resize({ width: 32, height: 32 });
  }

  const svgFallback = nativeImage.createFromDataURL(getBrandIconDataUrl());
  return svgFallback.isEmpty() ? undefined : svgFallback.resize({ width: 32, height: 32 });
};

const runMotionCli = async (poem: PoemRecord, dateLabel: string, sourceImagePath: string, profile: MotionRenderProfile) => {
  await ensureDir(getMotionRoot());

  const datedSlug = buildPoemAssetSlug(poem, dateLabel);
  const outputPath = path.join(getMotionRoot(), `${datedSlug}_${profile.version}.mp4`);
  if (await exists(outputPath)) {
    return outputPath;
  }

  const skillRoot = await ensureBundledMotionSkillReady();
  const binPath = path.join(skillRoot, "bin", "agent-image-motion.mjs");
  if (!(await exists(binPath))) {
    throw new Error(`Motion skill not found at ${binPath}`);
  }
  const nodeExecutable = getMotionNodeExecutable(skillRoot);

  const projectRoot = getProjectRoot();
  const relativeImage = path.relative(projectRoot, sourceImagePath);
  const relativeOutput = path.relative(projectRoot, outputPath);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const child = spawn(
      nodeExecutable,
      [
        binPath,
        "--mode=render",
        `--images=${relativeImage}`,
        `--title=${poem.title}`,
        `--subtitle=${poem.author}`,
        `--preset=${poem.motionPreset}`,
        `--width=${profile.width}`,
        `--height=${profile.height}`,
        `--fps=${profile.fps}`,
        `--durationInFrames=${profile.durationInFrames}`,
        `--codec=${profile.codec}`,
        `--atmosphere=${profile.atmosphere}`,
        `--particles=${profile.particles}`,
        `--floatingCards=${profile.floatingCards}`,
        `--sweepLight=${profile.sweepLight}`,
        `--texture=${profile.texture}`,
        `--intensity=${profile.intensity}`,
        `--output=${relativeOutput}`,
      ],
      {
        cwd: projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env:
          nodeExecutable === process.execPath
            ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
            : process.env,
      },
    );

    let stdout = "";
    let stderr = "";
    const finalize = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(renderTimeout);
      callback();
    };

    const renderTimeout = setTimeout(() => {
      child.kill();
      finalize(() => reject(new Error(`Motion render timed out after 180000ms. ${stderr || stdout}`.trim())));
    }, 180000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 12000) {
        stdout = stdout.slice(-12000);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 12000) {
        stderr = stderr.slice(-12000);
      }
    });

    child.on("error", (error) => finalize(() => reject(error)));
    child.on("close", (code) => {
      if (code === 0) {
        finalize(resolve);
        return;
      }
      finalize(() => reject(new Error(stderr || stdout || `Motion render exited with code ${code}`)));
    });
  });

  return outputPath;
};

const prepareMotionAsset = async (poem: PoemRecord, dateLabel: string): Promise<MotionAsset> => {
  const { sourceImagePath, provider, prompt } = await resolveSourceImage(poem, dateLabel);
  const motionPath = await runMotionCli(poem, dateLabel, sourceImagePath, motionRenderProfile.preview);
  return {
    motionPath,
    motionUrl: toRuntimeAssetUrl(motionPath),
    sourceImagePath,
    sourceImageUrl: toRuntimeAssetUrl(sourceImagePath),
    provider,
    prompt,
  };
};

const preparePreviewImageAsset = async (poem: PoemRecord, dateLabel: string): Promise<PreviewImageAsset> => {
  try {
    const { sourceImagePath, provider, prompt } = await resolveSourceImage(poem, dateLabel);
    return {
      imagePath: sourceImagePath,
      imageUrl: toRuntimeAssetUrl(sourceImagePath),
      provider,
      prompt,
    };
  } catch {
    const fallbackUrl = buildPollinationsUrl(poem.imagePrompt);
    return {
      imagePath: fallbackUrl,
      imageUrl: fallbackUrl,
      provider: "pollinations",
      prompt: poem.imagePrompt,
    };
  }
};

const prepareDeckBackAsset = async (dateLabel: string): Promise<CardBackAsset> => {
  await ensureDir(getImageRoot());

  const theme = deckBackThemes[hashString(dateLabel) % deckBackThemes.length];
  const outputPath = path.join(getImageRoot(), `${resolveDateSlug(dateLabel)}_deck_back.jpg`);

  if (!(await exists(outputPath))) {
    try {
      const braveResult = await searchBraveImage(theme.searchKeywords.join(" "));
      if (braveResult) {
        await downloadToFile(braveResult, outputPath);
        return {
          imagePath: outputPath,
          imageUrl: toRuntimeAssetUrl(outputPath),
          provider: "brave",
          prompt: theme.searchKeywords.join(" "),
        };
      }
    } catch {
      // Fall through to generated image.
    }

    await downloadToFile(buildPollinationsUrl(theme.prompt), outputPath);
  }

  return {
    imagePath: outputPath,
    imageUrl: toRuntimeAssetUrl(outputPath),
    provider: process.env.BRAVE_API_KEY ? "brave" : "pollinations",
    prompt: theme.prompt,
  };
};

const savePosterImage = async (posterDataUrl: string | undefined, outputPath: string) => {
  if (!posterDataUrl) {
    return undefined;
  }

  const image = nativeImage.createFromDataURL(posterDataUrl);
  if (image.isEmpty()) {
    return undefined;
  }

  await writeFile(outputPath, image.toPNG());
  return outputPath;
};

const saveRichCard = async (payload: SaveRichCardPayload): Promise<SavedCardBundle> => {
  await appendMarkdownSave({
    poem: payload.poem,
    dateLabel: payload.dateLabel,
    profileName: payload.profileName,
  });

  await ensureDir(getDailySaveRoot());
  const timeSlug = new Date().toISOString().slice(11, 19).replace(/:/g, "-");
  const folderName = `${resolveDateSlug(payload.dateLabel)}_${timeSlug}_${slugify(payload.poem.author)}_${slugify(payload.poem.title)}`;
  const bundleRoot = path.join(getDailySaveRoot(), folderName);
  await ensureDir(bundleRoot);

  const motionOutputPath = path.join(bundleRoot, "background.mp4");
  const htmlOutputPath = path.join(bundleRoot, "card.html");
  const posterOutputPath = path.join(bundleRoot, "poster.png");
  const metadataOutputPath = path.join(bundleRoot, "metadata.json");

  const { sourceImagePath } = await resolveSourceImage(payload.poem, payload.dateLabel);
  const exportMotionPath = await runMotionCli(payload.poem, payload.dateLabel, sourceImagePath, motionRenderProfile.export);

  await copyFile(exportMotionPath, motionOutputPath);
  await writeFile(htmlOutputPath, payload.htmlMarkup, "utf8");
  const savedPosterPath = await savePosterImage(payload.posterDataUrl, posterOutputPath);
  await writeFile(
    metadataOutputPath,
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        dateLabel: payload.dateLabel,
        poemId: payload.poem.id,
        title: payload.poem.title,
        author: payload.poem.author,
        authorMeta: payload.poem.authorMeta,
        profileName: payload.profileName,
        motionFile: "background.mp4",
        htmlFile: "card.html",
        posterFile: savedPosterPath ? "poster.png" : null,
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    folderPath: bundleRoot,
    cardPath: htmlOutputPath,
    posterPath: savedPosterPath,
    motionPath: motionOutputPath,
    markdownPath: getMarkdownPath(),
  };
};

const normalizeLine = (line: string) => line.replace(/\s+/g, " ").trim();

const areSameLineGroups = (left: string[], right: string[]) => {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((line, index) => normalizeLine(line) === normalizeLine(right[index] ?? ""));
};

const shouldIncludeTranslatedText = (poem: PoemRecord) => {
  if (poem.translatedText.length === 0) {
    return false;
  }

  if (poem.originalLanguage === "zh" && areSameLineGroups(poem.originalText, poem.translatedText)) {
    return false;
  }

  return true;
};

const composeShareTextForLanguage = (poem: PoemRecord, dateLabel: string, language: "zh" | "en", bundle?: Partial<SavedCardBundle>) => {
  const version = resolvePoemVersion(poem, language);
  const excerpt = version.lines.join(" ").slice(0, 90);
  const lines = [
    `今日诗卡｜${dateLabel}`,
    `${version.title} · ${poem.author}`,
    excerpt,
    bundle?.folderPath ? `已导出卡片：${bundle.folderPath}` : "",
  ];

  return lines.filter(Boolean).join("\n");
};

const composeCopyText = (poem: PoemRecord, dateLabel: string, language: "zh" | "en", bundle?: Partial<SavedCardBundle>) => {
  const version = resolvePoemVersion(poem, language);
  const lines = [
    `今日诗卡｜${dateLabel}`,
    `${version.title} · ${poem.author}`,
    version.lines.join(" "),
  ];

  if (bundle?.folderPath) {
    lines.push(`已导出卡片：${bundle.folderPath}`);
  }

  return lines.filter(Boolean).join("\n");
};

const platformLabels: Record<SharePlatform, string> = {
  wechat: "微信",
  xiaohongshu: "小红书",
  weibo: "微博",
  douyin: "抖音",
  copy: "复制",
};

const platformLabelsEn: Record<SharePlatform, string> = {
  wechat: "WeChat",
  xiaohongshu: "RedNote",
  weibo: "Weibo",
  douyin: "Douyin",
  copy: "Copy",
};

const platformShareTargets: Partial<Record<Exclude<SharePlatform, "copy">, string>> = {
  weibo: "https://service.weibo.com/share/share.php",
  xiaohongshu: "https://creator.xiaohongshu.com/publish/publish?source=official&type=note&noteType=normal",
  douyin: "https://creator.douyin.com/creator-micro/content/upload?enter_from=publish_page&type=image_text",
};

const resolveShareImage = async (payload: SharePayload) => {
  if (payload.bundle?.posterPath && (await exists(payload.bundle.posterPath))) {
    const image = nativeImage.createFromPath(payload.bundle.posterPath);
    if (!image.isEmpty()) {
      return image;
    }
  }

  if (payload.posterDataUrl) {
    const image = nativeImage.createFromDataURL(payload.posterDataUrl);
    if (!image.isEmpty()) {
      return image;
    }
  }

  return null;
};

const prepareShareDraft = async (payload: SharePayload, image: Electron.NativeImage | null, captionText: string) => {
  const timeSlug = new Date().toISOString().slice(11, 19).replace(/:/g, "-");
  const folderName = `${resolveDateSlug(payload.dateLabel)}_${timeSlug}_${slugify(payload.poem.author)}_${slugify(payload.poem.title)}`;
  const draftRoot = path.join(getShareDraftRoot(), folderName);
  await ensureDir(draftRoot);

  const captionPath = path.join(draftRoot, "caption.txt");
  await writeFile(captionPath, captionText, "utf8");

  let posterPath: string | undefined;
  if (image && !image.isEmpty()) {
    posterPath = path.join(draftRoot, "poster.png");
    await writeFile(posterPath, image.toPNG());
  }

  return { draftRoot, captionPath, posterPath };
};

const openPlatform = async (platform: SharePlatform, text: string, language: "zh" | "en") => {
  const en = language === "en";
  switch (platform) {
    case "weibo":
      await shell.openExternal(`${platformShareTargets.weibo}?title=${encodeURIComponent(text)}`);
      return en ? "Opened the Weibo share page" : "已打开微博分享页";
    case "wechat":
      try {
        await shell.openExternal("weixin://");
        return en ? "Opened WeChat. Paste directly into Moments" : "已唤起微信客户端，请直接粘贴到朋友圈";
      } catch {
        await shell.openExternal("https://weixin.qq.com/");
        return en ? "Could not open WeChat directly, opened the WeChat website instead" : "未能直接唤起微信客户端，已打开微信官网";
      }
    case "xiaohongshu":
      await shell.openExternal(platformShareTargets.xiaohongshu!);
      return en ? "Opened the RedNote image-post entry" : "已尝试打开小红书图文发布页";
    case "douyin":
      await shell.openExternal(platformShareTargets.douyin!);
      return en ? "Opened the Douyin image-post entry" : "已尝试打开抖音图文发布页";
    default:
      return en ? "Copied to clipboard" : "已复制到剪贴板";
  }
};

const sharePoem = async (payload: SharePayload) => {
  const language = payloadLanguage(payload);
  const isEnglishUi = language === "en";
  const text = payload.platform === "copy"
    ? composeCopyText(payload.poem, payload.dateLabel, language, payload.bundle)
    : composeShareTextForLanguage(payload.poem, payload.dateLabel, language, payload.bundle);
  const fullCaptionText = composeCopyText(payload.poem, payload.dateLabel, language, payload.bundle);
  clipboard.writeText(text);

  const image = await resolveShareImage(payload);
  if (image) {
    clipboard.writeImage(image);
  }

  const shareDraft = payload.platform === "wechat"
    ? await prepareShareDraft(payload, image, fullCaptionText)
    : null;

  const platformActionMessage = await openPlatform(payload.platform, text, language);

  if (shareDraft?.draftRoot) {
    await shell.openPath(shareDraft.draftRoot);
  }

  const copiedMaterialLabel = image ? "文案与卡片图" : "文案";
  const copiedMaterialLabelEn = image ? "caption and poster" : "caption";

  return {
    message: payload.platform === "copy"
      ? (isEnglishUi ? `${copiedMaterialLabelEn} copied to clipboard.` : `${copiedMaterialLabel}已复制到剪贴板。`)
      : payload.platform === "wechat"
        ? (isEnglishUi
          ? `${copiedMaterialLabelEn} copied to clipboard. ${platformActionMessage}. A Moments draft folder is also open with poster.png and caption.txt.`
          : `${copiedMaterialLabel}已复制到剪贴板，${platformActionMessage}。已同时打开朋友圈草稿目录，可直接选用 poster.png 和 caption.txt。`)
      : (isEnglishUi
        ? `${copiedMaterialLabelEn} copied to clipboard. ${platformActionMessage}.`
        : `${copiedMaterialLabel}已复制到剪贴板，${platformActionMessage}。`),
  };
};

const createWindow = async () => {
  const { width: workAreaWidth, height: workAreaHeight } = screen.getPrimaryDisplay().workAreaSize;
  const targetWidth = Math.min(workAreaWidth, 1580);
  const targetHeight = Math.min(workAreaHeight, 1320);

  const appIcon = getAppWindowIcon();

  const window = new BrowserWindow({
    width: targetWidth,
    height: targetHeight,
    minWidth: 1200,
    minHeight: Math.min(workAreaHeight, 1040),
    backgroundColor: "#0b0b10",
    title: "Daily Poem Card",
    icon: appIcon.isEmpty() ? undefined : appIcon,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  window.center();
};

const prepareDailyDeck = async (dateLabel: string): Promise<AppState> => {
  const state = await readState();

  // If today's deck already exists, return as-is
  if (state.dailyDecks[dateLabel]?.length > 0) {
    return state;
  }

  try {
    const archive = await readRecommendedArchive();
    const builtInAndExternal = await getPoemLibrary();
    const allLibrary = builtInAndExternal.library;

    // Randomly choose language: true = Chinese (Sou-yun), false = English (Poetry Foundation / PoetryDB)
    const useChinese = Math.random() < 0.5;

    let newPoems: PoemRecord[] = [];

    if (useChinese) {
      newPoems = await fetchSouYunPoems(4, archive.recommendedIds);
    } else {
      // Try Poetry Foundation first
      newPoems = await fetchPoetryFoundationPoems(4, archive.recommendedIds);
      // If not enough, try PoetryDB
      if (newPoems.length < 4) {
        const poetryDbPoems = await fetchPoetryDBPoems(
          4 - newPoems.length,
          [...archive.recommendedIds, ...newPoems.map((p) => p.id)],
        );
        newPoems = [...newPoems, ...poetryDbPoems];
      }
    }

    // If we couldn't fetch enough external poems, fall back to built-in library
    if (newPoems.length < 4) {
      const needed = 4 - newPoems.length;
      const unseenBuiltIn = allLibrary.filter((p) => !archive.recommendedIds.includes(p.id));
      const fallbackPoems = unseenBuiltIn.slice(0, needed);
      newPoems = [...newPoems, ...fallbackPoems];
    }

    // Save fetched poems to library
    const fetchedNew = newPoems.filter(
      (p) => p.id.startsWith("souyun-") || p.id.startsWith("pf-") || p.id.startsWith("poetrydb-"),
    );
    if (fetchedNew.length > 0) {
      await saveFetchedPoems(fetchedNew);
      invalidatePoemLibraryCache();
    }

    // Update archive with new poem IDs
    const newIds = newPoems.map((p) => p.id);
    await addRecommendedIds(newIds);

    // Update state with today's deck
    const nextState: AppState = {
      ...state,
      dailyDecks: {
        ...state.dailyDecks,
        [dateLabel]: newIds,
      },
      seenPoemIds: newIds[0] ? Array.from(new Set([...state.seenPoemIds, newIds[0]])) : state.seenPoemIds,
    };

    await writeState(nextState);
    return nextState;
  } catch (error) {
    console.error("prepareDailyDeck failed:", error);
    // Fallback to built-in poems on any error
    const builtInAndExternal = await getPoemLibrary();
    const allLibrary = builtInAndExternal.library;
    const archive = await readRecommendedArchive();
    const unseenBuiltIn = allLibrary.filter((p) => !archive.recommendedIds.includes(p.id));
    const fallbackPoems = unseenBuiltIn.slice(0, 4);
    const fallbackIds = fallbackPoems.map((p) => p.id);
    await addRecommendedIds(fallbackIds);
    const fallbackState: AppState = {
      ...state,
      dailyDecks: {
        ...state.dailyDecks,
        [dateLabel]: fallbackIds,
      },
      seenPoemIds: fallbackIds[0] ? Array.from(new Set([...state.seenPoemIds, fallbackIds[0]])) : state.seenPoemIds,
    };
    await writeState(fallbackState);
    return fallbackState;
  }
};

const registerIpc = () => {
  ipcMain.handle("app:get-state", async () => readState());
  ipcMain.handle("app:update-state", async (_event, nextState: AppState) => writeState({ ...defaultState, ...nextState }));
  ipcMain.handle("app:get-poem-library", async () => getPoemLibrary());
  ipcMain.handle("app:prepare-daily-deck", async (_event, dateLabel: string) => {
    const state = await prepareDailyDeck(dateLabel);
    return state;
  });
  ipcMain.handle("app:get-motion-runtime-status", async () => getMotionRuntimeStatus());
  ipcMain.handle("app:get-payment-status", async () => getPaymentStatus());
  ipcMain.handle("app:open-purchase-link", async () => openPurchaseLink());
  ipcMain.handle("app:activate-license", async (_event, licenseKey: string) => activateLicense(licenseKey));
  ipcMain.handle("poem:prepare-motion", async (_event, poem: PoemRecord, dateLabel: string) => {
    const resolvedPoem = poemLookup.get(poem.id) ?? poem;
    return prepareMotionAsset(resolvedPoem, dateLabel);
  });
  ipcMain.handle("poem:prepare-preview-image", async (_event, poem: PoemRecord, dateLabel: string) => {
    const resolvedPoem = poemLookup.get(poem.id) ?? poem;
    return preparePreviewImageAsset(resolvedPoem, dateLabel);
  });
  ipcMain.handle("poem:prepare-deck-back", async (_event, dateLabel: string) => prepareDeckBackAsset(dateLabel));
  ipcMain.handle("poem:append-text-save", async (_event, payload: SaveTextPayload) => appendMarkdownSave(payload));
  ipcMain.handle("poem:save-rich-card", async (_event, payload: SaveRichCardPayload) => saveRichCard(payload));
  ipcMain.handle("poem:share", async (_event, payload: SharePayload) => sharePoem(payload));
  ipcMain.handle("app:open-daily-save", async () => {
    await ensureDir(getDailySaveRoot());
    await shell.openPath(getDailySaveRoot());
  });
  ipcMain.handle("author:list-skills", async () => {
    const context = await getPoemLibraryContext();
    return listUnlockedSkills(context.response.library, context.authorIndex);
  });
  ipcMain.handle("author:agent-run", async (_event, payload: AuthorAgentPayload) => {
    if (payload.mode === "chat") {
      if (!payload.chat) {
        throw new Error("author:agent-run 缺少 chat payload。");
      }
      const library = await getPoemLibrary();
      const context = await getPoemLibraryContext();
      const chat = await chatWithAuthor(payload.chat, context.response.library, context.authorIndex);
      return { mode: "chat", chat };
    }

    if (payload.mode === "debate") {
      if (!payload.debate) {
        throw new Error("author:agent-run 缺少 debate payload。");
      }
      const context = await getPoemLibraryContext();
      const debate = await generateDebate(payload.debate, context.response.library, context.authorIndex);
      return { mode: "debate", debate };
    }

    if (!payload.critic) {
      throw new Error("author:agent-run 缺少 critic payload。");
    }
    const critic = await reviewAsCritic(payload.critic);
    return { mode: "critic", critic };
  });
  ipcMain.handle("llm:check-config", async () => {
    try {
      await access(getLlmConfigPath(), fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle("llm:save-config", async (_event, config: LlmConfig) => {
    try {
      await writeFile(getLlmConfigPath(), JSON.stringify(config, null, 2), "utf8");
      invalidateLlmConfigCache();
      return { success: true, message: "LLM 配置已保存。" };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
};

app.whenReady().then(async () => {
  app.setAppUserModelId("com.yunxue.dailypoemcard");
  app.setName("Daily Poem Card");
  await Promise.all([ensureDir(getRuntimeRoot()), ensureDir(getDailySaveRoot())]);
  registerIpc();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
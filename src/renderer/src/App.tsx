import { useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import PoemCard, { type VisualProfile } from "./components/PoemCard";
import CardBack from "./components/CardBack";
import { SendGlyph } from "./components/PoemIcons";
import { getUiCopy } from "./uiCopy";
import { getLanguageLabel, resolvePoemVersion } from "@shared/poemLanguage";
import { poems } from "@shared/poems";
import type { AppState, AuthorChatMetrics, AuthorChatResult, AuthorSkill, CardBackAsset, CriticReviewResult, DailyPoemApi, DebateResult, LlmConfig, MotionAsset, MotionRuntimeStatus, OriginalLanguage, PoemLibraryResponse, PoemRecord, PreviewImageAsset, SavedCardBundle, SharePlatform } from "@shared/types";

const previewState: AppState = {
  seenPoemIds: [],
  premiumUnlocked: false,
  premiumSource: "free",
  dailyDecks: {},
  savedTextCount: 0,
  savedCardCount: 0,
};

const llmSetupBilingual = {
  title: "欢迎使用 Daily Poem Card / Welcome to Daily Poem Card",
  bodyZh: "首次使用需要先配置你的大语言模型（LLM）。所有 AI 功能，包括诗人对话、评论家点评与诗坛交锋，都将经由该模型运行。",
  bodyEn: "Before the first launch, configure your preferred LLM. Poet dialogue, critic review, and poetic debate all run through that model.",
  baseUrlLabel: "API Base URL / API 基础地址",
  apiKeyLabel: "API Key / API 密钥",
  modelLabel: "Model / 模型名称",
  save: "保存并进入应用 / Save and Enter",
  hintZh: "支持任何 OpenAI-compatible API（Kimi、OpenAI、DeepSeek 等）。运行时配置会写在应用目录旁边的 llm.config.json。",
  hintEn: "Any OpenAI-compatible API is supported, including Kimi, OpenAI, and DeepSeek. The runtime config will be written next to the app as llm.config.json.",
  fill: "请填写完整的 LLM 配置信息 / Please complete the LLM configuration first.",
  saved: "LLM 配置已保存，正在加载今日卡组… / LLM config saved. Loading today's deck…",
};

const visualProfiles: VisualProfile[] = [
  {
    id: "apple-nocturne",
    name: "Gallery Nocturne",
    family: "Apple / Gallery",
    layout: "overlay",
    surface: "#050608",
    surfaceAlt: "rgba(4, 8, 15, 0.74)",
    textPrimary: "#f5f8ff",
    textSecondary: "rgba(245, 248, 255, 0.76)",
    accent: "#8cc5ff",
    border: "rgba(255, 255, 255, 0.08)",
    titleFont: '"Cormorant Garamond", "STSong", serif',
    bodyFont: '"Manrope", "PingFang SC", sans-serif',
    mood: "moonlit",
  },
  {
    id: "notion-paper",
    name: "Warm Margin Notes",
    family: "Notion / Editorial",
    layout: "margin",
    surface: "#f6f1e9",
    surfaceAlt: "rgba(255, 251, 244, 0.86)",
    textPrimary: "#2f2923",
    textSecondary: "rgba(47, 41, 35, 0.72)",
    accent: "#b86b35",
    border: "rgba(47, 41, 35, 0.12)",
    titleFont: '"Fraunces", "Noto Serif SC", serif',
    bodyFont: '"Newsreader", "Source Han Serif SC", serif',
    mood: "annotated",
  },
  {
    id: "raycast-control",
    name: "Command Surface",
    family: "Raycast / Dark",
    layout: "split",
    surface: "#07080a",
    surfaceAlt: "rgba(16, 17, 17, 0.88)",
    textPrimary: "#f8f9fb",
    textSecondary: "rgba(248, 249, 251, 0.72)",
    accent: "#ff6860",
    border: "rgba(255, 255, 255, 0.08)",
    titleFont: '"Space Grotesk", "PingFang SC", sans-serif',
    bodyFont: '"IBM Plex Sans", "Microsoft YaHei", sans-serif',
    mood: "instrumental",
  },
  {
    id: "apple-museum",
    name: "Museum Frame",
    family: "Apple / Museum",
    layout: "frame",
    surface: "#f4f6f8",
    surfaceAlt: "rgba(255, 255, 255, 0.82)",
    textPrimary: "#17202d",
    textSecondary: "rgba(23, 32, 45, 0.72)",
    accent: "#1f67ff",
    border: "rgba(23, 32, 45, 0.1)",
    titleFont: '"Cormorant Garamond", "Source Han Serif SC", serif',
    bodyFont: '"Alegreya Sans", "Microsoft YaHei", sans-serif',
    mood: "sculptural",
  },
  {
    id: "notion-ledger",
    name: "Quiet Ledger",
    family: "Notion / Archive",
    layout: "split",
    surface: "#efe5d8",
    surfaceAlt: "rgba(255, 248, 239, 0.78)",
    textPrimary: "#372d24",
    textSecondary: "rgba(55, 45, 36, 0.7)",
    accent: "#4562ff",
    border: "rgba(55, 45, 36, 0.12)",
    titleFont: '"Fraunces", "Songti SC", serif',
    bodyFont: '"Manrope", "PingFang SC", sans-serif',
    mood: "paperwarm",
  },
  {
    id: "raycast-capsule",
    name: "Night Capsule",
    family: "Raycast / Capsule",
    layout: "overlay",
    surface: "#0b0d11",
    surfaceAlt: "rgba(17, 18, 22, 0.82)",
    textPrimary: "#ffffff",
    textSecondary: "rgba(255, 255, 255, 0.74)",
    accent: "#4ea8ff",
    border: "rgba(255, 255, 255, 0.09)",
    titleFont: '"Space Grotesk", "PingFang SC", sans-serif',
    bodyFont: '"IBM Plex Sans", "Microsoft YaHei", sans-serif',
    mood: "console-glow",
  },
];

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const hashString = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
};

const formatChatMetrics = (language: OriginalLanguage, metrics?: AuthorChatMetrics) => {
  if (!metrics) {
    return "";
  }

  const copy = getUiCopy(language);
  const parts = [copy.metricsTotal(metrics.totalMs)];
  if (metrics.distillMs !== undefined) {
    parts.push(copy.metricsDistill(metrics.distillMs));
  }
  if (metrics.replyMs !== undefined) {
    parts.push(copy.metricsReply(metrics.replyMs));
  }
  return copy.metricsWrap(parts);
};

const formatChatSource = (language: OriginalLanguage, metrics?: AuthorChatMetrics) => {
  if (!metrics) {
    return "";
  }

  const copy = getUiCopy(language);
  switch (metrics.source) {
    case "cached-skill":
      return copy.sourceCached;
    case "recalibrated":
      return copy.sourceRecalibrated;
    case "distilled-now":
      return copy.sourceDistilled;
    case "background-distill-started":
      return copy.sourceBackground;
    default:
      return copy.sourceFailed;
  }
};

const buildPromptResonance = (poem: PoemRecord | undefined, prompt: string, language: OriginalLanguage) => {
  const copy = getUiCopy(language);
  if (!poem) {
    return copy.resonanceSaved(prompt);
  }

  const anchorLine = poem.originalText[0]?.trim() || poem.title;
  return copy.resonanceEcho(poem.title, prompt, anchorLine);
};

const getBridgeReloadMessage = (featureLabel: string, language: OriginalLanguage) => getUiCopy(language).bridgeReload(featureLabel);

const hasAuthorChatBridge = () => typeof (window.dailyPoem as Partial<DailyPoemApi> | undefined)?.chatWithAuthor === "function";

const hasCriticBridge = () => typeof (window.dailyPoem as Partial<DailyPoemApi> | undefined)?.reviewAsCritic === "function";

const unique = <T,>(values: T[]) => Array.from(new Set(values));
const anonymousAuthorNames = new Set(["无名氏", "佚名", "nobody", "anonymous", "unknown", "不详"]);

const isAnonymousLikeAuthor = (authorName: string) => anonymousAuthorNames.has(authorName.trim().toLowerCase()) || /^\s*$/.test(authorName);

const getDateLabel = () => dateFormatter.format(new Date()).replace(/\//g, "-");

const getOffsetDateLabel = (offsetDays: number) => {
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + offsetDays);
  return dateFormatter.format(nextDate).replace(/\//g, "-");
};

const slugify = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "poem";

const resolveDateSlug = (dateLabel: string) => dateLabel.replace(/[^0-9-]/g, "") || new Date().toISOString().slice(0, 10);
const buildPoemAssetSlug = (poem: PoemRecord, dateLabel: string) => `${resolveDateSlug(dateLabel)}_${slugify(poem.id)}`;
const motionRenderVersion = "fast-v1";

const runtimeAssetUrl = (relativePath: string) => {
  if (typeof window === "undefined") {
    return relativePath;
  }
  return new URL(`/__daily_runtime/${relativePath.replace(/^\/+/, "")}`, window.location.origin).toString();
};

const buildPollinationsPreviewUrl = (prompt: string) => {
  const encodedPrompt = encodeURIComponent(
    `${prompt}, cinematic atmosphere, rich contrast, layered depth, moody shadows, luminous highlights, elegant composition, no people, no text, high detail`,
  );
  return `https://image.pollinations.ai/prompt/${encodedPrompt}?width=900&height=1200&nologo=true`;
};

const resolveDisplayLanguage = (uiLanguage: OriginalLanguage) => uiLanguage;

const canLoadRuntimeAsset = async (assetUrl: string) => {
  try {
    const response = await fetch(assetUrl, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
};

const resolvePreviewMotionAsset = async (poem: PoemRecord, dateLabel: string): Promise<MotionAsset | null> => {
  const datedSlug = buildPoemAssetSlug(poem, dateLabel);
  const motionUrl = runtimeAssetUrl(`motion/${datedSlug}_${motionRenderVersion}.mp4`);
  const sourceImageUrl = runtimeAssetUrl(`images/${datedSlug}.jpg`);

  const [hasMotion, hasImage] = await Promise.all([canLoadRuntimeAsset(motionUrl), canLoadRuntimeAsset(sourceImageUrl)]);
  if (!hasMotion || !hasImage) {
    return null;
  }

  return {
    motionPath: motionUrl,
    motionUrl,
    sourceImagePath: sourceImageUrl,
    sourceImageUrl,
    provider: "pollinations",
    prompt: poem.imagePrompt,
  };
};

const resolvePreviewDeckBackAsset = async (dateLabel: string): Promise<CardBackAsset | null> => {
  const imageUrl = runtimeAssetUrl(`images/${resolveDateSlug(dateLabel)}_deck_back.jpg`);
  if (!(await canLoadRuntimeAsset(imageUrl))) {
    return null;
  }

  return {
    imagePath: imageUrl,
    imageUrl,
    provider: "pollinations",
    prompt: "browser-preview-deck-back",
  };
};

const resolvePreviewImageAsset = async (poem: PoemRecord, dateLabel: string): Promise<PreviewImageAsset | null> => {
  const datedSlug = buildPoemAssetSlug(poem, dateLabel);
  const imageUrl = runtimeAssetUrl(`images/${datedSlug}.jpg`);
  if (await canLoadRuntimeAsset(imageUrl)) {
    return {
      imagePath: imageUrl,
      imageUrl,
      provider: "pollinations",
      prompt: poem.imagePrompt,
    };
  }

  return {
    imagePath: buildPollinationsPreviewUrl(poem.imagePrompt),
    imageUrl: buildPollinationsPreviewUrl(poem.imagePrompt),
    provider: "pollinations",
    prompt: poem.imagePrompt,
  };
};

const resolveProfile = (poem: PoemRecord, dateLabel: string, deckIndex: number) => {
  const profileIndex = (hashString(`${poem.id}:${dateLabel}`) + deckIndex) % visualProfiles.length;
  return visualProfiles[profileIndex];
};

const buildDailyDeck = (state: AppState, dateLabel: string, library: PoemRecord[]) => {
  const lookup = new Map(library.map((poem) => [poem.id, poem]));
  const currentDeckIds = state.dailyDecks[dateLabel];
  if (currentDeckIds?.length) {
    const resolvedDeck = currentDeckIds.map((id) => lookup.get(id)).filter(Boolean) as PoemRecord[];
    if (resolvedDeck.length > 0) {
      return {
        deck: resolvedDeck,
        nextState: state,
      };
    }
  }

  const unseen = library.filter((poem) => !state.seenPoemIds.includes(poem.id));
  if (unseen.length === 0) {
    return { deck: [], nextState: state };
  }

  const deckSize = state.premiumUnlocked ? 10 : 4;
  const start = hashString(dateLabel) % unseen.length;
  const rotated = [...unseen.slice(start), ...unseen.slice(0, start)];
  const deck = rotated.slice(0, Math.min(deckSize, rotated.length));
  const featured = deck[0];
  const nextState: AppState = {
    ...state,
    dailyDecks: {
      ...state.dailyDecks,
      [dateLabel]: deck.map((poem) => poem.id),
    },
    seenPoemIds: featured ? unique([...state.seenPoemIds, featured.id]) : state.seenPoemIds,
  };

  return { deck, nextState };
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildBundleMarkup = (poem: PoemRecord, profile: VisualProfile, dateLabel: string, displayLanguage: OriginalLanguage) => {
  const copy = getUiCopy(displayLanguage);
  const version = resolvePoemVersion(poem, displayLanguage);
  const bodyFont = profile.bodyFont;
  const titleFont = profile.titleFont;

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(version.title)} · ${escapeHtml(poem.author)}</title>
    <style>
      :root {
        --surface: ${profile.surface};
        --surface-alt: ${profile.surfaceAlt};
        --text-primary: ${profile.textPrimary};
        --text-secondary: ${profile.textSecondary};
        --accent: ${profile.accent};
        --border: ${profile.border};
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: linear-gradient(180deg, #0a0d13, #0b1019 48%, #090b11);
        color: var(--text-primary);
        font-family: ${bodyFont};
      }
      .card {
        position: relative;
        width: min(760px, 92vw);
        aspect-ratio: 0.66;
        min-height: 1120px;
        border-radius: 42px;
        overflow: hidden;
        border: 1px solid var(--border);
        background: var(--surface);
        box-shadow: 0 42px 120px rgba(0,0,0,0.38);
      }
      video {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .veil {
        position: absolute;
        inset: 0;
        background:
          linear-gradient(180deg, rgba(3, 6, 10, 0.18) 0%, rgba(3, 6, 10, 0.44) 36%, rgba(3, 6, 10, 0.84) 100%),
          radial-gradient(circle at top, transparent 0%, rgba(3, 6, 10, 0.22) 64%, rgba(3, 6, 10, 0.6) 100%);
      }
      .content {
        position: relative;
        z-index: 2;
        display: grid;
        grid-template-rows: auto auto 1fr;
        gap: 18px;
        min-height: 100%;
        padding: 24px;
      }
      .chips {
        display: flex;
        justify-content: space-between;
        gap: 10px;
      }
      .chip {
        border-radius: 999px;
        border: 1px solid var(--border);
        padding: 8px 14px;
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        background: rgba(255,255,255,0.08);
      }
      .chip.ghost {
        background: transparent;
        color: var(--text-secondary);
      }
      .hero {
        display: grid;
        gap: 16px;
        padding-top: 20px;
      }
      .style {
        color: var(--accent);
        font-size: 13px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0;
        font-family: ${titleFont};
        font-size: clamp(54px, 9vw, 88px);
        line-height: 0.9;
        max-width: 7ch;
      }
      .author {
        display: flex;
        gap: 10px;
        margin-top: 12px;
        color: var(--text-secondary);
        font-size: 18px;
      }
      .note {
        margin: 0;
        max-width: 30ch;
        color: var(--text-secondary);
        line-height: 1.7;
      }
      .stack {
        display: grid;
        align-content: end;
        gap: 14px;
      }
      .panel {
        background: var(--surface-alt);
        backdrop-filter: blur(16px);
        border: 1px solid var(--border);
        border-radius: 28px;
        padding: 18px 18px 20px;
      }
      h2 {
        margin: 0 0 8px;
        font-size: 12px;
        color: var(--accent);
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      h3 {
        margin: 0 0 12px;
        font-family: ${titleFont};
        font-size: 22px;
      }
      .lines { display: grid; gap: 8px; }
      .lines p { margin: 0; font-size: 18px; line-height: 1.66; }
    </style>
  </head>
  <body>
    <main class="card">
      <video src="./background.mp4" autoplay loop muted playsinline></video>
      <div class="veil"></div>
      <section class="content">
        <div class="chips">
          <span class="chip">${escapeHtml(copy.featuredChip)}</span>
          <span class="chip ghost">${escapeHtml(dateLabel)}</span>
        </div>
        <div class="hero">
          <div class="style">${escapeHtml(profile.name)}</div>
          <div>
            <h1>${escapeHtml(version.title)}</h1>
            <div class="author"><span>${escapeHtml(poem.author)}</span><span>${escapeHtml(poem.authorMeta)}</span></div>
          </div>
        </div>
        <div class="stack">
          <div class="panel">
            <h2>${escapeHtml(version.heading)}</h2>
            <h3>${escapeHtml(version.title)}</h3>
            <div class="lines">${version.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</div>
          </div>
        </div>
      </section>
    </main>
  </body>
</html>`;
};

function App() {
  const [appState, setAppState] = useState<AppState | null>(null);
  const [libraryInfo, setLibraryInfo] = useState<PoemLibraryResponse | null>(null);
  const [deck, setDeck] = useState<PoemRecord[]>([]);
  const [uiLanguage, setUiLanguage] = useState<OriginalLanguage>("zh");
  const [promptValue, setPromptValue] = useState("");
  const [chatMode, setChatMode] = useState<"prompt" | "chat" | "feynman" | "munger">("prompt");
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [isChatting, setIsChatting] = useState(false);
  const [isDistilling, setIsDistilling] = useState(false);
  const [showSkillPanel, setShowSkillPanel] = useState(false);
  const [unlockedSkills, setUnlockedSkills] = useState<AuthorSkill[]>([]);
  const [debateResult, setDebateResult] = useState<DebateResult | null>(null);
  const [debateLoading, setDebateLoading] = useState(false);
  const [debateAuthorA, setDebateAuthorA] = useState("");
  const [debateAuthorB, setDebateAuthorB] = useState("");
  const [debateTopic, setDebateTopic] = useState("");
  const [displayedIndex, setDisplayedIndex] = useState(0);
  const [isCardFaceUp, setIsCardFaceUp] = useState(true);
  const [isCardFlipping, setIsCardFlipping] = useState(false);
  const [flipPhase, setFlipPhase] = useState<"idle" | "turning-back" | "turning-front">("idle");
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const [assets, setAssets] = useState<Record<string, MotionAsset>>({});
  const [previewImages, setPreviewImages] = useState<Record<string, PreviewImageAsset>>({});
  const [deckBackAsset, setDeckBackAsset] = useState<CardBackAsset | null>(null);
  const [motionRuntimeStatus, setMotionRuntimeStatus] = useState<MotionRuntimeStatus | null>(null);
  const [status, setStatus] = useState(getUiCopy("zh").appLoading);
  const [busy, setBusy] = useState(false);
  const [lastBundle, setLastBundle] = useState<Partial<SavedCardBundle> | undefined>();
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null);
  const [llmForm, setLlmForm] = useState<LlmConfig>({
    baseUrl: "https://api.moonshot.cn/v1",
    apiKey: "",
    model: "kimi-latest",
    temperature: 0.8,
    maxTokens: 512,
  });
  const cardRef = useRef<HTMLDivElement>(null);
  const flipTimeoutsRef = useRef<number[]>([]);

  const dateLabel = useMemo(() => getDateLabel(), []);
  const hasDesktopApi = typeof window !== "undefined" && typeof window.dailyPoem !== "undefined";
  const copy = getUiCopy(uiLanguage);

  const persistState = async (nextState: AppState) => {
    if (!hasDesktopApi) {
      setAppState(nextState);
      return nextState;
    }
    const persisted = await window.dailyPoem.updateState(nextState);
    setAppState(persisted);
    return persisted;
  };

  const syncDeck = async (baseState: AppState, library: PoemRecord[]) => {
    try {
      const { deck: nextDeck, nextState } = buildDailyDeck(baseState, dateLabel, library);
      const visibleDeck = nextDeck.slice(0, 4);
      if (JSON.stringify(baseState) !== JSON.stringify(nextState)) {
        await persistState(nextState);
      } else {
        setAppState(baseState);
      }
      setDeck(visibleDeck);
      setDisplayedIndex(0);
      setIsCardFaceUp(true);
      setIsCardFlipping(false);
      setFlipPhase("idle");
      setPendingIndex(null);
      setStatus(visibleDeck.length ? copy.cardsReady : copy.libraryFinished);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setStatus(copy.syncDeckFailed(msg));
      setAppState(baseState);
      setDeck([]);
    }
  };

  useEffect(() => {
    return () => {
      flipTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      flipTimeoutsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!hasDesktopApi) {
      setLibraryInfo({ library: poems, source: "built-in", count: poems.length });
      void syncDeck(previewState, poems);
      setStatus(copy.previewStatus);
      setLlmConfigured(true);
      return;
    }

    window.dailyPoem.checkLlmConfig().then((configured) => {
      setLlmConfigured(configured);
      if (configured) {
        const prepareWithTimeout = Promise.race([
          window.dailyPoem.prepareDailyDeck(dateLabel),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("prepareDailyDeck 超时")), 15000)),
        ]);
        prepareWithTimeout
          .then(() => {
            return Promise.all([window.dailyPoem.getState(), window.dailyPoem.getPoemLibrary()]);
          })
          .then(([state, library]) => {
            setLibraryInfo(library);
            void syncDeck(state, library.library);
          })
          .catch((error: unknown) => {
            const msg = error instanceof Error ? error.message : String(error);
            setStatus(copy.loadingFailed(msg));
            setLibraryInfo({ library: poems, source: "built-in", count: poems.length });
            void syncDeck(previewState, poems);
          });
      } else {
        // LLM 未配置：释放二级加载锁，使用内置诗库
        setLibraryInfo({ library: poems, source: "built-in", count: poems.length });
        void syncDeck(previewState, poems);
      }
    }).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      setStatus(copy.loadingFailed(msg));
      setLlmConfigured(true);
      setLibraryInfo({ library: poems, source: "built-in", count: poems.length });
      void syncDeck(previewState, poems);
    });
  }, [hasDesktopApi]);

  const selectedPoem = deck[displayedIndex];
  const selectedDisplayLanguage = resolveDisplayLanguage(uiLanguage);
  const selectedProfile = selectedPoem ? resolveProfile(selectedPoem, dateLabel, displayedIndex) : visualProfiles[0];
  const authorChatDisabled = !selectedPoem || isAnonymousLikeAuthor(selectedPoem.author);
  const authorChatDisabledReason = selectedPoem && isAnonymousLikeAuthor(selectedPoem.author)
    ? copy.authorDisabledReason
    : "";

  useEffect(() => {
    // Reset chat when author changes
    if (selectedPoem) {
      setChatMessages([]);
      setChatMode("prompt");
    }
  }, [selectedPoem?.author]);

  useEffect(() => {
    const zh = getUiCopy("zh");
    const en = getUiCopy("en");
    const remap = new Map<string, string>([
      [zh.appLoading, copy.appLoading],
      [en.appLoading, copy.appLoading],
      [zh.cardsReady, copy.cardsReady],
      [en.cardsReady, copy.cardsReady],
      [zh.libraryFinished, copy.libraryFinished],
      [en.libraryFinished, copy.libraryFinished],
      [zh.previewStatus, copy.previewStatus],
      [en.previewStatus, copy.previewStatus],
      [zh.configSaved, copy.configSaved],
      [en.configSaved, copy.configSaved],
      [zh.resonanceReady, copy.resonanceReady],
      [en.resonanceReady, copy.resonanceReady],
    ]);

    const nextStatus = remap.get(status);
    if (nextStatus && nextStatus !== status) {
      setStatus(nextStatus);
    }
  }, [uiLanguage, copy, status]);

  useEffect(() => {
    if (!hasDesktopApi) return;
    window.dailyPoem.getMotionRuntimeStatus().then((runtimeStatus) => {
      setMotionRuntimeStatus(runtimeStatus);
      if (!runtimeStatus.ready) {
        setStatus(copy.motionRuntimeUnavailable);
      }
    }).catch(() => {
      setMotionRuntimeStatus(null);
    });
  }, [hasDesktopApi, uiLanguage]);

  useEffect(() => {
    if (!hasDesktopApi) return;
    window.dailyPoem.listUnlockedSkills().then((skills) => {
      setUnlockedSkills(skills);
    }).catch(() => {
      setUnlockedSkills([]);
    });
  }, [hasDesktopApi, selectedPoem?.author]);

  useEffect(() => {
    if (!hasDesktopApi || !selectedPoem || assets[selectedPoem.id]) {
      return;
    }

    if (motionRuntimeStatus && !motionRuntimeStatus.ready) {
      let cancelled = false;
      window.dailyPoem.preparePreviewImageAsset(selectedPoem, dateLabel)
        .then((asset) => {
          if (!cancelled) {
            setAssets((current) => ({
              ...current,
              [selectedPoem.id]: {
                motionPath: "",
                motionUrl: "",
                sourceImagePath: asset.imagePath,
                sourceImageUrl: asset.imageUrl,
                provider: asset.provider,
                prompt: asset.prompt,
              },
            }));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setStatus(copy.motionRuntimeUnavailable);
          }
        });

      return () => {
        cancelled = true;
      };
    }

    let cancelled = false;
    setBusy(true);
    window.dailyPoem
      .prepareMotionAsset(selectedPoem, dateLabel)
      .then((asset) => {
        if (!cancelled) {
          setAssets((current) => ({ ...current, [selectedPoem.id]: asset }));
          setStatus(copy.cardsReady);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hasDesktopApi, selectedPoem, dateLabel, assets, motionRuntimeStatus, copy]);

  useEffect(() => {
    const poemsToPrime = deck.slice(1, 4);
    if (poemsToPrime.length === 0) {
      return;
    }

    let cancelled = false;

    const loadPreviewImage = async (poem: PoemRecord) => {
      if (previewImages[poem.id]) {
        return;
      }

      try {
        const asset = hasDesktopApi
          ? await window.dailyPoem.preparePreviewImageAsset(poem, dateLabel)
          : await resolvePreviewImageAsset(poem, dateLabel);
        if (!cancelled && asset) {
          setPreviewImages((current) => (current[poem.id] ? current : { ...current, [poem.id]: asset }));
        }
      } catch {
        // Keep preview cards usable even if one preview image is unavailable.
      }
    };

    void Promise.all(poemsToPrime.map((poem) => loadPreviewImage(poem)));

    return () => {
      cancelled = true;
    };
  }, [deck, hasDesktopApi, dateLabel, previewImages]);

  useEffect(() => {
    if (hasDesktopApi || !selectedPoem || assets[selectedPoem.id]) {
      return;
    }

    let cancelled = false;
    resolvePreviewMotionAsset(selectedPoem, dateLabel).then((asset) => {
      if (!cancelled && asset) {
        setAssets((current) => ({ ...current, [selectedPoem.id]: asset }));
        setStatus(copy.previewStatus);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [hasDesktopApi, selectedPoem, dateLabel, assets]);

  useEffect(() => {
    if (!hasDesktopApi) {
      let cancelled = false;
      resolvePreviewDeckBackAsset(dateLabel).then((asset) => {
        if (!cancelled) {
          setDeckBackAsset(asset);
        }
      });

      return () => {
        cancelled = true;
      };
    }

    let cancelled = false;
    window.dailyPoem
      .prepareDeckBackAsset(dateLabel)
      .then((asset) => {
        if (!cancelled) {
          setDeckBackAsset(asset);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDeckBackAsset(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hasDesktopApi, dateLabel]);

  const markPreviewSeen = async (poem: PoemRecord) => {
    if (!appState || appState.seenPoemIds.includes(poem.id)) {
      return;
    }

    const nextState: AppState = {
      ...appState,
      seenPoemIds: unique([...appState.seenPoemIds, poem.id]),
    };
    await persistState(nextState);
  };

  const primeMotionAsset = async (poem: PoemRecord) => {
    if (!hasDesktopApi || assets[poem.id] || (motionRuntimeStatus && !motionRuntimeStatus.ready)) {
      return;
    }

    try {
      const asset = await window.dailyPoem.prepareMotionAsset(poem, dateLabel);
      setAssets((current) => (current[poem.id] ? current : { ...current, [poem.id]: asset }));
    } catch {
      // Keep the current card usable even if the next card's motion asset is not ready yet.
    }
  };

  const handleSelectCard = async (index: number) => {
    const nextPoem = deck[index];
    if (!nextPoem || index === displayedIndex || isCardFlipping) {
      return;
    }

    flipTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    flipTimeoutsRef.current = [];
    setIsCardFlipping(true);
    setFlipPhase("turning-back");
    setPendingIndex(index);
    setIsCardFaceUp(false);
    setStatus(copy.turningToPoem(nextPoem.title));

    void primeMotionAsset(nextPoem);

    const swapTimeout = window.setTimeout(() => {
      setDisplayedIndex(index);
      setFlipPhase("turning-front");
      const frontTimeout = window.setTimeout(() => {
        setIsCardFaceUp(true);
      }, 210);
      const settleTimeout = window.setTimeout(() => {
        setIsCardFlipping(false);
        setFlipPhase("idle");
        setPendingIndex(null);
        setStatus(copy.poemFaceUp(nextPoem.title));
      }, 1180);
      flipTimeoutsRef.current.push(frontTimeout);
      flipTimeoutsRef.current.push(settleTimeout);
    }, 540);

    flipTimeoutsRef.current.push(swapTimeout);

    if (index > 0) {
      await markPreviewSeen(nextPoem);
    }
  };

  const updateCounters = async (textDelta: number, cardDelta: number) => {
    if (!appState) {
      return;
    }
    await persistState({
      ...appState,
      savedTextCount: appState.savedTextCount + textDelta,
      savedCardCount: appState.savedCardCount + cardDelta,
    });
  };

  const handleSaveText = async () => {
    if (!selectedPoem) {
      return;
    }

    if (!hasDesktopApi) {
      setStatus(copy.previewStatus);
      return;
    }

    setBusy(true);
    try {
      const result = await window.dailyPoem.appendTextSave({
        poem: selectedPoem,
        dateLabel,
        profileName: selectedProfile.name,
        language: selectedDisplayLanguage,
      });
      await updateCounters(1, 0);
      setStatus(`${copy.saveText} → ${result.markdownPath}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const ensurePosterCapture = async () => {
    if (!cardRef.current) {
      return undefined;
    }
    try {
      return await toPng(cardRef.current, { pixelRatio: 2, cacheBust: true });
    } catch {
      return undefined;
    }
  };

  const handleSaveRich = async () => {
    if (!selectedPoem) {
      return;
    }

    if (!hasDesktopApi) {
      setStatus(copy.previewStatus);
      return;
    }

    const asset = assets[selectedPoem.id];
    if (motionRuntimeStatus && !motionRuntimeStatus.ready) {
      setStatus(copy.animatedExportUnavailable);
      return;
    }

    if (!asset) {
      setStatus(copy.generatingBackground);
      return;
    }

    if (!asset.motionPath) {
      setStatus(copy.animatedExportUnavailable);
      return;
    }

    setBusy(true);
    setStatus(copy.preparingExportMotion);
    try {
      const posterDataUrl = await ensurePosterCapture();
      const bundle = await window.dailyPoem.saveRichCard({
        poem: selectedPoem,
        dateLabel,
        profileName: selectedProfile.name,
        motionPath: asset.motionPath,
        posterDataUrl,
        htmlMarkup: buildBundleMarkup(selectedPoem, selectedProfile, dateLabel, selectedDisplayLanguage),
      });
      setLastBundle(bundle);
      await updateCounters(1, 1);
      setStatus(`${copy.saveRichCard} → ${bundle.folderPath}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleShare = async (platform: SharePlatform) => {
    if (!selectedPoem) {
      return;
    }

    if (!hasDesktopApi) {
      setStatus(copy.previewStatus);
      return;
    }

    setBusy(true);
    try {
      const posterDataUrl = await ensurePosterCapture();
      const result = await window.dailyPoem.sharePoem({
        platform,
        poem: selectedPoem,
        dateLabel,
        language: selectedDisplayLanguage,
        bundle: lastBundle,
        posterDataUrl,
      });
      setStatus(result.message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const handlePromptSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let nextPrompt = promptValue.trim();

    if (!nextPrompt) {
      if (chatMode === "feynman" || chatMode === "munger") {
        nextPrompt = copy.reviewDefaultPrompt;
      } else if (chatMode === "chat") {
        setStatus(copy.chatPlaceholderNoPoem);
        return;
      } else {
        setStatus(copy.resonancePlaceholder);
        return;
      }
    }

    if (chatMode === "prompt") {
      setChatMessages((prev) => [
        ...prev,
        { role: "user", content: nextPrompt },
        { role: "assistant", content: buildPromptResonance(selectedPoem, nextPrompt, uiLanguage) },
      ]);
      setStatus(copy.resonanceReady);
      setPromptValue("");
      return;
    }

    // Chat mode
    if (chatMode === "chat") {
      if (!selectedPoem || isDistilling) return;

      if (hasDesktopApi && !hasAuthorChatBridge()) {
        setStatus(getBridgeReloadMessage(copy.poetDialogue, uiLanguage));
        setChatMessages((prev) => [...prev, { role: "assistant", content: `${copy.bridgeMissingPrefix}${getBridgeReloadMessage(copy.poetDialogue, uiLanguage)}` }]);
        return;
      }

      const nextMessages = [...chatMessages, { role: "user" as const, content: nextPrompt }];
      setChatMessages(nextMessages);
      setPromptValue("");
      setIsChatting(true);
      setStatus(copy.chatPlaceholderWithAuthor(selectedPoem.author));

      const payload = {
        authorId: selectedPoem.id,
        authorName: selectedPoem.author,
        authorMeta: selectedPoem.authorMeta,
        messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        poemContext: {
          title: selectedPoem.title,
          lines: selectedPoem.originalText,
        },
      };

      if (hasDesktopApi) {
        window.dailyPoem
          .chatWithAuthor(payload)
          .then((result: AuthorChatResult) => {
            setChatMessages((prev) => [...prev, { role: "assistant", content: result.reply }]);
            setStatus(`${selectedPoem.author} · ${formatChatSource(uiLanguage, result.metrics)}.${formatChatMetrics(uiLanguage, result.metrics)}`);
          })
          .catch((error: unknown) => {
            setStatus(error instanceof Error ? error.message : String(error));
          })
          .finally(() => {
            setIsChatting(false);
          });
      } else {
        setTimeout(() => {
          setChatMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: copy.previewReply(selectedPoem.author),
            },
          ]);
          setStatus(copy.previewStatus);
          setIsChatting(false);
        }, 800);
      }
      return;
    }

    // Critic modes
    if ((chatMode === "feynman" || chatMode === "munger") && selectedPoem) {
      if (hasDesktopApi && !hasCriticBridge()) {
        const featureLabel = chatMode === "feynman" ? copy.feynmanExplain : copy.mungerReview;
        setStatus(getBridgeReloadMessage(featureLabel, uiLanguage));
        setChatMessages((prev) => [...prev, { role: "assistant", content: `${copy.bridgeMissingPrefix}${getBridgeReloadMessage(featureLabel, uiLanguage)}` }]);
        return;
      }

      setChatMessages((prev) => [...prev, { role: "user", content: nextPrompt }]);
      setPromptValue("");
      setIsChatting(true);
      setStatus(chatMode === "feynman" ? copy.feynmanExplain : copy.mungerReview);

      if (hasDesktopApi) {
        window.dailyPoem
          .reviewAsCritic({ critic: chatMode, poem: selectedPoem })
          .then((result: CriticReviewResult) => {
            setChatMessages((prev) => [...prev, { role: "assistant", content: result.review }]);
            setStatus(chatMode === "feynman" ? copy.feynmanExplain : copy.mungerReview);
          })
          .catch((error: unknown) => {
            setStatus(error instanceof Error ? error.message : String(error));
          })
          .finally(() => {
            setIsChatting(false);
          });
      } else {
        setTimeout(() => {
          setChatMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: copy.previewCritic(chatMode === "feynman" ? copy.feynmanExplain : copy.mungerReview),
            },
          ]);
          setStatus(copy.previewStatus);
          setIsChatting(false);
        }, 800);
      }
    }
  };

  const handleGenerateDebate = async () => {
    if (!debateAuthorA || !debateAuthorB || !debateTopic) {
      setStatus(copy.choosePoetsAndTopic);
      return;
    }
    if (debateAuthorA === debateAuthorB) {
      setStatus(copy.chooseDifferentPoets);
      return;
    }

    setDebateLoading(true);
    setStatus(copy.debateGeneratingStatus);

    if (hasDesktopApi) {
      try {
        const result = await window.dailyPoem.runAuthorAgent({
          mode: "debate",
          debate: {
            authorA: debateAuthorA,
            authorB: debateAuthorB,
            topic: debateTopic,
            rounds: 3,
          },
        });
        setDebateResult(result.debate ?? { topic: debateTopic, rounds: [], summary: copy.noDebateResult });
        setStatus(copy.debateReady);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        setDebateLoading(false);
      }
    } else {
      setTimeout(() => {
        setDebateResult({
          topic: debateTopic,
          rounds: [
            { round: 1, speaker: debateAuthorA, content: copy.previewDebateView(debateAuthorA) },
            { round: 1, speaker: debateAuthorB, content: copy.previewDebateView(debateAuthorB) },
          ],
          summary: copy.previewDebateSummary,
        });
        setStatus(copy.previewDebateGenerated);
        setDebateLoading(false);
      }, 800);
    }
  };

  if (llmConfigured === null || (!hasDesktopApi ? false : !appState || !libraryInfo)) {
    return <main className="app-shell loading-shell">{copy.appLoading}</main>;
  }

  if (llmConfigured === false && hasDesktopApi) {
    return (
      <main className="app-shell loading-shell">
        <div className="llm-config-panel">
          <h2>{llmSetupBilingual.title}</h2>
          <p>
            {llmSetupBilingual.bodyZh}
            <br />
            {llmSetupBilingual.bodyEn}
          </p>
          <div className="llm-config-form">
            <label>
              {llmSetupBilingual.baseUrlLabel}
              <input
                type="text"
                value={llmForm.baseUrl}
                onChange={(e) => setLlmForm((f) => ({ ...f, baseUrl: e.target.value }))}
                placeholder="https://api.moonshot.cn/v1"
              />
            </label>
            <label>
              {llmSetupBilingual.apiKeyLabel}
              <input
                type="password"
                value={llmForm.apiKey}
                onChange={(e) => setLlmForm((f) => ({ ...f, apiKey: e.target.value }))}
                placeholder="sk-xxx"
              />
            </label>
            <label>
              {llmSetupBilingual.modelLabel}
              <input
                type="text"
                value={llmForm.model}
                onChange={(e) => setLlmForm((f) => ({ ...f, model: e.target.value }))}
                placeholder="kimi-latest"
              />
            </label>
            <button
              type="button"
              className="llm-config-save"
              onClick={async () => {
                if (!llmForm.baseUrl.trim() || !llmForm.apiKey.trim() || !llmForm.model.trim()) {
                  setStatus(llmSetupBilingual.fill);
                  return;
                }
                const result = await window.dailyPoem.saveLlmConfig(llmForm);
                if (result.success) {
                  setLlmConfigured(true);
                  setStatus(llmSetupBilingual.saved);
                  window.dailyPoem.prepareDailyDeck(dateLabel).then(() => {
                    Promise.all([window.dailyPoem.getState(), window.dailyPoem.getPoemLibrary()]).then(([state, library]) => {
                      setLibraryInfo(library);
                      void syncDeck(state, library.library);
                    });
                  });
                } else {
                  setStatus(result.message);
                }
              }}
            >
              {llmSetupBilingual.save}
            </button>
          </div>
          <p className="llm-config-hint">
            {llmSetupBilingual.hintZh}
            <br />
            {llmSetupBilingual.hintEn}
          </p>
        </div>
      </main>
    );
  }

  const activeDeck = deck.slice(0, 4);
  const selectedPoemInDeck = activeDeck[displayedIndex] ?? activeDeck[0];
  const selectedCardProfile = selectedPoemInDeck ? resolveProfile(selectedPoemInDeck, dateLabel, displayedIndex) : visualProfiles[0];
  const previewCards = activeDeck.slice(1, 4);
  const featuredPoem = activeDeck[0];
  const previewDateLabels = previewCards.map((_poem, index) => getOffsetDateLabel(index + 1));

  return (
    <main className="app-shell">
      <section className="deck-stage-header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1>{copy.todayTitle}</h1>
        </div>
        <div className="deck-header-actions">
          <div className="deck-language-toggle" role="tablist" aria-label={copy.languageSwitchAria}>
            <button
              type="button"
              className={`deck-language-button ${uiLanguage === "zh" ? "is-active" : ""}`}
              onClick={() => setUiLanguage("zh")}
            >
              中文
            </button>
            <button
              type="button"
              className={`deck-language-button ${uiLanguage === "en" ? "is-active" : ""}`}
              onClick={() => setUiLanguage("en")}
            >
              English
            </button>
          </div>
          <button
            type="button"
            className="deck-directory-button"
            onClick={() => {
              if (hasDesktopApi) {
                void window.dailyPoem.openDailySaveDir();
              }
            }}
          >
            {hasDesktopApi ? copy.openExportDir : copy.browserPreview}
          </button>
          <button
            type="button"
            className="deck-skill-button"
            onClick={() => setShowSkillPanel(true)}
          >
            {copy.poetAtlas}
          </button>
        </div>
      </section>

      <section className="deck-status-strip">
        <span>{status}</span>
      </section>

      {selectedPoemInDeck ? (
        <section className="deck-stage">
          <div className={`hero-card-stack ${flipPhase !== "idle" ? `is-${flipPhase}` : ""}`.trim()}>
            <div className="hero-card-shadow hero-card-shadow-back">
              <CardBack subtle imageUrl={deckBackAsset?.imageUrl} />
            </div>
            <div className="hero-card-shadow hero-card-shadow-middle">
              <CardBack subtle imageUrl={deckBackAsset?.imageUrl} />
            </div>
            <PoemCard
              key={selectedPoemInDeck.id}
              ref={cardRef}
              poem={selectedPoemInDeck}
              uiLanguage={uiLanguage}
              displayLanguage={uiLanguage}
              dateLabel={dateLabel}
              profile={selectedCardProfile}
              asset={assets[selectedPoemInDeck.id]}
              backImageUrl={deckBackAsset?.imageUrl}
              isFaceUp={isCardFaceUp}
              flipPhase={flipPhase}
              onSaveText={handleSaveText}
              onSaveRich={handleSaveRich}
              onShare={handleShare}
              isBusy={busy || isCardFlipping}
            />
          </div>

          <aside className="preview-stack-column">
            {featuredPoem && displayedIndex > 0 ? (
              <div className="preview-stack-toolbar">
                <button type="button" className="preview-stack-return" onClick={() => handleSelectCard(0)} disabled={isCardFlipping}>
                  {copy.featuredReturn}
                </button>
              </div>
            ) : null}
            {previewCards.map((poem, index) => {
              const isActive = selectedPoemInDeck.id === poem.id;
              const previewIndex = index + 1;
              const isPending = pendingIndex === previewIndex;
              return (
                <button
                  key={poem.id}
                  type="button"
                  className={`preview-stack-card ${isActive ? "is-active" : ""} ${isPending ? "is-pending" : ""} ${isCardFlipping ? "is-disabled" : ""}`}
                  onClick={() => handleSelectCard(previewIndex)}
                  disabled={isCardFlipping}
                >
                  <div className="preview-stack-date">{previewDateLabels[index]}</div>
                  <div className="preview-stack-card-inner">
                    <CardBack subtle imageUrl={previewImages[poem.id]?.imageUrl} />
                  </div>
                </button>
              );
            })}
          </aside>
        </section>
      ) : (
        <section className="empty-state">
          <h2>{copy.emptyTitle}</h2>
          <p>{copy.emptyBody}</p>
        </section>
      )}

      {showSkillPanel && (
        <div className="skill-panel-overlay" onClick={() => setShowSkillPanel(false)}>
          <div className="skill-panel" onClick={(e) => e.stopPropagation()}>
            <div className="skill-panel-header">
              <h2>{copy.atlasTitle}</h2>
              <button type="button" className="skill-panel-close" onClick={() => setShowSkillPanel(false)}>
                ×
              </button>
            </div>

            <div className="skill-panel-body">
              <section className="skill-section">
                <h3>{copy.unlockedPoets}</h3>
                {unlockedSkills.length === 0 ? (
                  <p className="skill-empty">{copy.noUnlockedPoets}</p>
                ) : (
                  <div className="skill-grid">
                    {unlockedSkills.map((skill) => (
                      <div key={skill.authorId} className="skill-card">
                        <div className="skill-card-name">{skill.authorName}</div>
                        <div className="skill-card-meta">{skill.authorMeta}</div>
                        <div className="skill-card-inline-list">
                          {skill.freshnessState ? (
                            <span className={`skill-chip-subtle ${skill.freshnessState === "source-updated" ? "is-warning" : "is-fresh"}`}>
                              {skill.freshnessState === "source-updated" ? copy.freshnessUpdated : copy.freshnessCurrent}
                            </span>
                          ) : null}
                          <span className="skill-chip-subtle">{copy.collected(skill.distillationStats.collectionCount)}</span>
                          {skill.distillationStats.abstractionMs !== undefined ? (
                            <span className="skill-chip-subtle">{copy.abstractedMs(skill.distillationStats.abstractionMs)}</span>
                          ) : null}
                          {skill.distillationStats.calibrationMs !== undefined ? (
                            <span className="skill-chip-subtle">{copy.calibratedMs(skill.distillationStats.calibrationMs)}</span>
                          ) : null}
                          {skill.distillationStats.totalMs !== undefined ? (
                            <span className="skill-chip-subtle">{copy.totalMs(skill.distillationStats.totalMs)}</span>
                          ) : null}
                        </div>
                        <div className="skill-card-traits">
                          {skill.voiceTraits.map((t) => (
                            <span key={t} className="skill-tag">{t}</span>
                          ))}
                        </div>
                        <div className="skill-card-phrases">
                          {skill.signaturePhrases.map((p) => (
                            <span key={p} className="skill-phrase">"{p}"</span>
                          ))}
                        </div>
                        <div className="skill-card-block">
                          <div className="skill-card-block-title">{copy.languageLabel}</div>
                          <p>{skill.abstraction.language}</p>
                        </div>
                        <div className="skill-card-block">
                          <div className="skill-card-block-title">{copy.thinkingLabel}</div>
                          <p>{skill.abstraction.thinking}</p>
                        </div>
                        <div className="skill-card-block">
                          <div className="skill-card-block-title">{copy.valuesLabel}</div>
                          <p>{skill.abstraction.values}</p>
                        </div>
                        <div className="skill-card-block">
                          <div className="skill-card-block-title">{copy.calibrationLabel}</div>
                          <p>{skill.calibration.resolution}</p>
                        </div>
                        {skill.calibration.tensions.length > 0 ? (
                          <div className="skill-card-inline-list">
                            {skill.calibration.tensions.map((tension) => (
                              <span key={tension} className="skill-chip-subtle">{tension}</span>
                            ))}
                          </div>
                        ) : null}
                        {skill.calibration.guardrails.length > 0 ? (
                          <div className="skill-card-block skill-card-block-compact">
                            <div className="skill-card-block-title">{copy.dialogueGuardrails}</div>
                            <div className="skill-card-inline-list">
                              {skill.calibration.guardrails.map((guardrail) => (
                                <span key={guardrail} className="skill-chip-subtle">{guardrail}</span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {skill.sourceCollection.length > 0 ? (
                          <div className="skill-card-block skill-card-block-compact">
                            <div className="skill-card-block-title">{copy.sourceWorks}</div>
                            <div className="skill-card-source-list">
                              {skill.sourceCollection.map((sample) => (
                                <div key={sample.poemId} className="skill-card-source-item">
                                  <strong>《{sample.title}》</strong>
                                  <span>{sample.originalExcerpt.join(" / ")}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="skill-section">
                <h3>{copy.debateTitle}</h3>
                <div className="debate-form">
                  <select
                    className="debate-select"
                    value={debateAuthorA}
                    onChange={(e) => setDebateAuthorA(e.target.value)}
                  >
                    <option value="">{copy.choosePoetA}</option>
                    {unlockedSkills.map((s) => (
                      <option key={`a-${s.authorId}`} value={s.authorName} disabled={s.authorName === debateAuthorB}>
                        {s.authorName === debateAuthorB ? copy.selectedB(s.authorName) : s.authorName}
                      </option>
                    ))}
                  </select>
                  <span className="debate-vs">VS</span>
                  <select
                    className="debate-select"
                    value={debateAuthorB}
                    onChange={(e) => setDebateAuthorB(e.target.value)}
                  >
                    <option value="">{copy.choosePoetB}</option>
                    {unlockedSkills.map((s) => (
                      <option key={`b-${s.authorId}`} value={s.authorName} disabled={s.authorName === debateAuthorA}>
                        {s.authorName === debateAuthorA ? copy.selectedA(s.authorName) : s.authorName}
                      </option>
                    ))}
                  </select>
                  <input
                    className="debate-topic"
                    type="text"
                    value={debateTopic}
                    onChange={(e) => setDebateTopic(e.target.value)}
                    placeholder={copy.debatePlaceholder}
                  />
                  <button
                    type="button"
                    className="debate-submit"
                    onClick={handleGenerateDebate}
                    disabled={debateLoading}
                  >
                    {debateLoading ? copy.debateGenerating : copy.debateGenerate}
                  </button>
                </div>

                {debateResult && (
                  <div className="debate-result">
                    <div className="debate-result-topic">{copy.debateTopic}：{debateResult.topic}</div>
                    <div className="debate-result-rounds">
                      {debateResult.rounds.map((r, idx) => (
                        <div key={idx} className={`debate-round debate-round-${r.speaker === debateAuthorA ? "a" : "b"}`}>
                          <div className="debate-round-speaker">{r.speaker}</div>
                          <div className="debate-round-content">{r.content}</div>
                        </div>
                      ))}
                    </div>
                    <div className="debate-result-summary">
                      <strong>{copy.debateSummary}：</strong>{debateResult.summary}
                    </div>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

      <div className="bottom-prompt-bar">
        <div className="bottom-prompt-tabs">
          <button
            type="button"
            className={`bottom-prompt-tab ${chatMode === "prompt" ? "is-active" : ""}`}
            onClick={() => {
              setChatMessages([]);
              setChatMode("prompt");
            }}
          >
            {copy.soulResonance}
          </button>
          <span className={`bottom-prompt-tab-ring ${chatMode === "chat" && isDistilling ? "is-distilling" : ""}`}>
            <button
              type="button"
              className={`bottom-prompt-tab ${chatMode === "chat" ? "is-active" : ""}`}
              disabled={authorChatDisabled}
              title={authorChatDisabledReason || undefined}
              onClick={() => {
                if (chatMode === "chat" || !selectedPoem || authorChatDisabled) {
                  if (authorChatDisabledReason) {
                    setStatus(authorChatDisabledReason);
                  }
                  return;
                }
                setChatMessages([]);
                setChatMode("chat");
                setIsDistilling(true);
                setStatus(copy.distillingPersona(selectedPoem.author));

                if (hasDesktopApi && !hasAuthorChatBridge()) {
                  const message = getBridgeReloadMessage(copy.poetDialogue, uiLanguage);
                  setStatus(message);
                  setChatMessages([{ role: "assistant", content: `${copy.bridgeMissingPrefix}${message}` }]);
                  setIsDistilling(false);
                  return;
                }

                const payload = {
                  authorId: selectedPoem.id,
                  authorName: selectedPoem.author,
                  authorMeta: selectedPoem.authorMeta,
                  messages: [] as { role: "user" | "assistant"; content: string }[],
                  poemContext: {
                    title: selectedPoem.title,
                    lines: selectedPoem.originalText,
                  },
                };

                if (hasDesktopApi) {
                  window.dailyPoem
                    .chatWithAuthor(payload)
                    .then((result: AuthorChatResult) => {
                      setChatMessages([{ role: "assistant", content: result.reply }]);
                      setStatus(
                        result.skillDistilled
                          ? `${selectedPoem.author} · ${formatChatSource(uiLanguage, result.metrics)}.${formatChatMetrics(uiLanguage, result.metrics)}`
                          : `${selectedPoem.author} · ${formatChatSource(uiLanguage, result.metrics)}.${formatChatMetrics(uiLanguage, result.metrics)}`,
                      );
                    })
                    .catch((error: unknown) => {
                      setStatus(error instanceof Error ? error.message : String(error));
                      setChatMessages([
                        {
                          role: "assistant",
                          content: `${copy.distillFailedPrefix}${error instanceof Error ? error.message : String(error)}`,
                        },
                      ]);
                    })
                    .finally(() => {
                      setIsDistilling(false);
                    });
                } else {
                  setTimeout(() => {
                    setChatMessages([
                      {
                        role: "assistant",
                        content: copy.askAuthorIntro(selectedPoem.author, selectedPoem.authorMeta, selectedPoem.title),
                      },
                    ]);
                    setStatus(copy.previewDistilled);
                    setIsDistilling(false);
                  }, 1200);
                }
              }}
            >
              {copy.poetDialogue}
            </button>
          </span>
          <button
            type="button"
            className={`bottom-prompt-tab ${chatMode === "feynman" ? "is-active" : ""}`}
            onClick={() => {
              setChatMessages([]);
              setChatMode("feynman");
              if (selectedPoem) {
                setChatMessages([
                  {
                    role: "assistant",
                    content: copy.feynmanIntro(selectedPoem.title),
                  },
                ]);
              }
            }}
          >
            {copy.feynmanExplain}
          </button>
          <button
            type="button"
            className={`bottom-prompt-tab ${chatMode === "munger" ? "is-active" : ""}`}
            onClick={() => {
              setChatMessages([]);
              setChatMode("munger");
              if (selectedPoem) {
                setChatMessages([
                  {
                    role: "assistant",
                    content: copy.mungerIntro(selectedPoem.title),
                  },
                ]);
              }
            }}
          >
            {copy.mungerReview}
          </button>
        </div>

        {(chatMode === "prompt" || chatMode === "chat" || chatMode === "feynman" || chatMode === "munger") && chatMessages.length > 0 && (
          <div className="chat-history">
            {chatMessages.map((msg, idx) => (
              <div key={idx} className={`chat-bubble chat-bubble-${msg.role}`}>
                <div className="chat-bubble-content">{msg.content}</div>
              </div>
            ))}
            {isChatting && (
              <div className="chat-bubble chat-bubble-assistant">
                <div className="chat-bubble-content chat-bubble-typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>
        )}

        <form className="bottom-prompt-shell" onSubmit={handlePromptSubmit}>
          <input
            id="poem-prompt-input"
            className="bottom-prompt-input"
            type="text"
            value={promptValue}
            onChange={(event) => setPromptValue(event.target.value)}
            placeholder={
              chatMode === "chat"
                ? selectedPoem
                  ? copy.chatPlaceholderWithAuthor(selectedPoem.author)
                  : copy.chatPlaceholderNoPoem
                : chatMode === "feynman"
                  ? copy.feynmanPlaceholder
                  : chatMode === "munger"
                    ? copy.mungerPlaceholder
                    : copy.resonancePlaceholder
            }
            disabled={
              (chatMode === "chat" && isDistilling) ||
              ((chatMode === "feynman" || chatMode === "munger") && (!selectedPoem || isChatting)) ||
              (chatMode === "chat" && !selectedPoem)
            }
          />
          <button
            type="submit"
            className="bottom-prompt-submit"
            aria-label={chatMode === "chat" ? copy.sendMessage : copy.submit}
            disabled={
              (chatMode === "chat" && isDistilling) ||
              ((chatMode === "feynman" || chatMode === "munger") && (!selectedPoem || isChatting)) ||
              (chatMode === "chat" && !selectedPoem)
            }
          >
            <SendGlyph />
          </button>
        </form>
      </div>
    </main>
  );
}

export default App;
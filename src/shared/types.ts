export type OriginalLanguage = "zh" | "en";
export type MotionPreset = "editorial" | "cinematic" | "gallery";
export type SharePlatform = "wechat" | "xiaohongshu" | "weibo" | "douyin" | "copy";

export interface PoemRecord {
  id: string;
  title: string;
  author: string;
  authorMeta: string;
  originalLanguage: OriginalLanguage;
  originalText: string[];
  translatedTitle: string;
  translatedText: string[];
  translatorNote: string;
  imagePrompt: string;
  searchKeywords: string[];
  motionPreset: MotionPreset;
}

export interface AppState {
  seenPoemIds: string[];
  premiumUnlocked: boolean;
  premiumSource: "free" | "demo" | "license";
  premiumActivatedAt?: string;
  dailyDecks: Record<string, string[]>;
  savedTextCount: number;
  savedCardCount: number;
}

export interface MotionAsset {
  motionPath: string;
  motionUrl: string;
  sourceImagePath: string;
  sourceImageUrl: string;
  provider: "brave" | "pollinations";
  prompt: string;
}

export interface MotionRuntimeStatus {
  ready: boolean;
  source: "bundled" | "external-env" | "external-default";
  skillRoot: string;
  nodeExecutable: string;
  remotionLauncher: string;
  version?: string;
  issues: string[];
}

export interface CardBackAsset {
  imagePath: string;
  imageUrl: string;
  provider: "brave" | "pollinations";
  prompt: string;
}

export interface PreviewImageAsset {
  imagePath: string;
  imageUrl: string;
  provider: "brave" | "pollinations";
  prompt: string;
}

export interface SaveTextPayload {
  poem: PoemRecord;
  dateLabel: string;
  profileName: string;
  language?: OriginalLanguage;
}

export interface SaveRichCardPayload {
  poem: PoemRecord;
  dateLabel: string;
  profileName: string;
  htmlMarkup: string;
  posterDataUrl?: string;
  motionPath: string;
}

export interface SavedCardBundle {
  folderPath: string;
  cardPath: string;
  posterPath?: string;
  motionPath: string;
  markdownPath: string;
}

export interface SharePayload {
  platform: SharePlatform;
  poem: PoemRecord;
  dateLabel: string;
  language?: OriginalLanguage;
  bundle?: Partial<SavedCardBundle>;
  posterDataUrl?: string;
}

export interface PoemLibraryResponse {
  library: PoemRecord[];
  source: "built-in" | "external" | "built-in+fetched" | "external+fetched";
  path?: string;
  count: number;
}

export interface PaymentConfigStatus {
  configured: boolean;
  providerLabel: string;
  purchaseUrlConfigured: boolean;
  supportMessage: string;
  activatedWith: AppState["premiumSource"];
}

export interface LicenseActivationResult {
  success: boolean;
  state: AppState;
  message: string;
}

export interface AuthorSourceSample {
  poemId: string;
  title: string;
  originalExcerpt: string[];
  translatedExcerpt?: string[];
}

export interface AuthorPersonaAbstraction {
  language: string;
  thinking: string;
  values: string;
}

export interface AuthorPersonaCalibration {
  tensions: string[];
  resolution: string;
  guardrails: string[];
}

export interface AuthorDistillationStats {
  sourceHash: string;
  collectionCount: number;
  abstractionVersion: number;
  calibrationVersion: number;
  abstractionMs?: number;
  calibrationMs?: number;
  totalMs?: number;
}

export interface AuthorSkill {
  version: number;
  authorId: string;
  authorName: string;
  authorMeta: string;
  freshnessState?: "fresh" | "source-updated";
  freshnessLabel?: string;
  sourceCollection: AuthorSourceSample[];
  distillationStats: AuthorDistillationStats;
  abstraction: AuthorPersonaAbstraction;
  calibration: AuthorPersonaCalibration;
  systemPrompt: string;
  voiceTraits: string[];
  signaturePhrases: string[];
  distilledAt: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AuthorChatPayload {
  authorId: string;
  authorName: string;
  authorMeta: string;
  messages: ChatMessage[];
  poemContext: {
    title: string;
    lines: string[];
  };
}

export interface AuthorChatMetrics {
  source: "cached-skill" | "background-distill-started" | "recalibrated" | "distilled-now" | "distill-failed";
  skillLookupMs: number;
  distillMs?: number;
  collectionCount?: number;
  abstractionMs?: number;
  calibrationMs?: number;
  replyMs?: number;
  totalMs: number;
  distillPromptChars?: number;
  abstractionPromptChars?: number;
  calibrationPromptChars?: number;
  replyPromptChars?: number;
}

export interface AuthorChatResult {
  reply: string;
  skillDistilled: boolean;
  metrics?: AuthorChatMetrics;
}

export interface DebateRound {
  round: number;
  speaker: string;
  content: string;
}

export interface DebatePayload {
  authorA: string;
  authorB: string;
  topic: string;
  rounds?: number;
}

export interface DebateResult {
  topic: string;
  rounds: DebateRound[];
  summary: string;
}

export interface CriticReviewPayload {
  critic: "feynman" | "munger";
  poem: PoemRecord;
}

export interface CriticReviewResult {
  critic: string;
  review: string;
}

export interface AuthorAgentPayload {
  mode: "chat" | "debate" | "critic";
  chat?: AuthorChatPayload;
  debate?: DebatePayload;
  critic?: CriticReviewPayload;
}

export interface AuthorAgentResult {
  mode: AuthorAgentPayload["mode"];
  chat?: AuthorChatResult;
  debate?: DebateResult;
  critic?: CriticReviewResult;
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface DailyPoemApi {
  getState: () => Promise<AppState>;
  updateState: (nextState: AppState) => Promise<AppState>;
  getPoemLibrary: () => Promise<PoemLibraryResponse>;
  prepareDailyDeck: (dateLabel: string) => Promise<AppState>;
  getPaymentStatus: () => Promise<PaymentConfigStatus>;
  openPurchaseLink: () => Promise<{ opened: boolean; message: string }>;
  activateLicense: (licenseKey: string) => Promise<LicenseActivationResult>;
  prepareMotionAsset: (poem: PoemRecord, dateLabel: string) => Promise<MotionAsset>;
  getMotionRuntimeStatus: () => Promise<MotionRuntimeStatus>;
  preparePreviewImageAsset: (poem: PoemRecord, dateLabel: string) => Promise<PreviewImageAsset>;
  prepareDeckBackAsset: (dateLabel: string) => Promise<CardBackAsset>;
  appendTextSave: (payload: SaveTextPayload) => Promise<{ markdownPath: string }>;
  saveRichCard: (payload: SaveRichCardPayload) => Promise<SavedCardBundle>;
  sharePoem: (payload: SharePayload) => Promise<{ message: string }>;
  openDailySaveDir: () => Promise<void>;
  chatWithAuthor: (payload: AuthorChatPayload) => Promise<AuthorChatResult>;
  reviewAsCritic: (payload: CriticReviewPayload) => Promise<CriticReviewResult>;
  listUnlockedSkills: () => Promise<AuthorSkill[]>;
  runAuthorAgent: (payload: AuthorAgentPayload) => Promise<AuthorAgentResult>;
  checkLlmConfig: () => Promise<boolean>;
  saveLlmConfig: (config: LlmConfig) => Promise<{ success: boolean; message: string }>;
}

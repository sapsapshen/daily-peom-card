import { contextBridge, ipcRenderer } from "electron";
import type { AppState, AuthorAgentPayload, AuthorChatPayload, CriticReviewPayload, DailyPoemApi, LlmConfig, PoemRecord, SaveRichCardPayload, SaveTextPayload, SharePayload } from "../shared/types";

const api: DailyPoemApi = {
  getState: () => ipcRenderer.invoke("app:get-state"),
  updateState: (nextState: AppState) => ipcRenderer.invoke("app:update-state", nextState),
  getPoemLibrary: () => ipcRenderer.invoke("app:get-poem-library"),
  prepareDailyDeck: (dateLabel: string) => ipcRenderer.invoke("app:prepare-daily-deck", dateLabel),
  getPaymentStatus: () => ipcRenderer.invoke("app:get-payment-status"),
  openPurchaseLink: () => ipcRenderer.invoke("app:open-purchase-link"),
  activateLicense: (licenseKey: string) => ipcRenderer.invoke("app:activate-license", licenseKey),
  getMotionRuntimeStatus: () => ipcRenderer.invoke("app:get-motion-runtime-status"),
  prepareMotionAsset: (poem: PoemRecord, dateLabel: string) => ipcRenderer.invoke("poem:prepare-motion", poem, dateLabel),
  preparePreviewImageAsset: (poem: PoemRecord, dateLabel: string) => ipcRenderer.invoke("poem:prepare-preview-image", poem, dateLabel),
  prepareDeckBackAsset: (dateLabel: string) => ipcRenderer.invoke("poem:prepare-deck-back", dateLabel),
  appendTextSave: (payload: SaveTextPayload) => ipcRenderer.invoke("poem:append-text-save", payload),
  saveRichCard: (payload: SaveRichCardPayload) => ipcRenderer.invoke("poem:save-rich-card", payload),
  sharePoem: (payload: SharePayload) => ipcRenderer.invoke("poem:share", payload),
  openDailySaveDir: () => ipcRenderer.invoke("app:open-daily-save"),
  chatWithAuthor: async (payload: AuthorChatPayload) => {
    const result = await ipcRenderer.invoke("author:agent-run", { mode: "chat", chat: payload });
    if (!result?.chat) {
      throw new Error("author:agent-run 未返回 chat 结果。");
    }
    return result.chat;
  },
  reviewAsCritic: async (payload: CriticReviewPayload) => {
    const result = await ipcRenderer.invoke("author:agent-run", { mode: "critic", critic: payload });
    if (!result?.critic) {
      throw new Error("author:agent-run 未返回 critic 结果。");
    }
    return result.critic;
  },
  listUnlockedSkills: () => ipcRenderer.invoke("author:list-skills"),
  runAuthorAgent: (payload: AuthorAgentPayload) => ipcRenderer.invoke("author:agent-run", payload),
  checkLlmConfig: () => ipcRenderer.invoke("llm:check-config"),
  saveLlmConfig: (config: LlmConfig) => ipcRenderer.invoke("llm:save-config", config),
};

contextBridge.exposeInMainWorld("dailyPoem", api);

declare global {
  interface Window {
    dailyPoem: DailyPoemApi;
  }
}

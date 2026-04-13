import { BrowserWindow, app } from "electron";
import path from "node:path";
import { readFile } from "node:fs/promises";
import type { PoemRecord } from "../shared/types";

const SOUYUN_ID_RANGE = { min: 1, max: 60000 };
const POETRY_FOUNDATION_IDS = [46707, 46473, 45673, 171426, 173024, 42595, 44688, 45085, 45234, 45567];

function generateImagePrompt(title: string, author: string, lines: string[], language: "zh" | "en"): string {
  const excerpt = lines.slice(0, 2).join(" ");
  const base =
    language === "zh"
      ? `${title} by ${author}, ${excerpt}, Chinese poetic atmosphere, ink wash painting style, cinematic landscape, elegant composition, no people, no text`
      : `${title} by ${author}, ${excerpt}, English poetic atmosphere, literary scene, cinematic mood, elegant composition, no people, no text`;
  return base;
}

function generateSearchKeywords(title: string, author: string, lines: string[]): string[] {
  const words = [...title.split(/[，。！？、\s,!?]+/), author, ...lines.slice(0, 2)].filter((w) => w.length > 1);
  return Array.from(new Set(words)).slice(0, 6);
}

async function fetchWithTimeout(url: string, options: RequestInit & { timeout?: number } = {}): Promise<Response> {
  const { timeout = 5000, ...rest } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...rest, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(id);
  }
}

interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

async function readLlmConfig(): Promise<LlmConfig | null> {
  try {
    const getProjectRoot = () => (app.isPackaged ? path.dirname(process.execPath) : process.cwd());
    const raw = await readFile(path.join(getProjectRoot(), "llm.config.json"), "utf8");
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
}

async function batchTranslateEnglishPoems(poems: PoemRecord[]): Promise<PoemRecord[]> {
  if (poems.length === 0) return poems;
  const config = await readLlmConfig();
  if (!config) return poems;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const prompt = poems
      .map((p, i) => `Poem ${i + 1}\nTitle: ${p.title}\nAuthor: ${p.author}\nLines:\n${p.originalText.join("\n")}`)
      .join("\n\n");

    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.4,
        max_tokens: 1200,
        messages: [
          {
            role: "system",
            content:
              'You are a poetic translator. Translate each English poem into elegant Chinese. Output ONLY a JSON array with no markdown formatting: [{"title":"中文标题","lines":["第一行","第二行",...]}, ...]. Maintain the same number of poems and poetic style.',
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) return poems;

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim() || "";
    if (!content) return poems;

    let translations: Array<{ title: string; lines: string[] }> = [];
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      translations = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      return poems;
    }

    if (!Array.isArray(translations) || translations.length !== poems.length) return poems;

    return poems.map((poem, i) => ({
      ...poem,
      translatedTitle: translations[i]?.title || poem.translatedTitle,
      translatedText: Array.isArray(translations[i]?.lines) ? translations[i].lines : poem.translatedText,
    }));
  } catch (error) {
    console.error("Batch translation failed:", error);
    return poems;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchSouYunPoems(count: number, excludeIds: string[]): Promise<PoemRecord[]> {
  const poems: PoemRecord[] = [];
  const attempts = new Set<number>();
  const maxAttempts = 20;

  while (poems.length < count && attempts.size < maxAttempts) {
    const id = Math.floor(Math.random() * (SOUYUN_ID_RANGE.max - SOUYUN_ID_RANGE.min + 1)) + SOUYUN_ID_RANGE.min;
    if (attempts.has(id)) continue;
    attempts.add(id);

    try {
      const response = await fetchWithTimeout(`https://api.sou-yun.cn/api/Poem?jsonType=true&key=${id}`, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        timeout: 4000,
      });
      if (!response.ok) continue;

      const data = (await response.json()) as {
        ShiData?: Array<{
          Title: { Content: string };
          Author: string;
          Dynasty: string;
          Clauses: Array<{ Content: string }>;
        }>;
      };

      if (!data.ShiData?.[0]) continue;
      const poemData = data.ShiData[0];
      const lines = poemData.Clauses.map((c) => c.Content).filter(Boolean);
      if (lines.length < 2) continue;

      const poemId = `souyun-${id}`;
      if (excludeIds.includes(poemId)) continue;

      const motionPresets: Array<"editorial" | "cinematic" | "gallery"> = ["editorial", "cinematic", "gallery"];
      const poem: PoemRecord = {
        id: poemId,
        title: poemData.Title.Content,
        author: poemData.Author || "无名氏",
        authorMeta: poemData.Dynasty || "古代",
        originalLanguage: "zh",
        originalText: lines,
        translatedTitle: poemData.Title.Content,
        translatedText: lines,
        translatorNote: "",
        imagePrompt: generateImagePrompt(poemData.Title.Content, poemData.Author || "无名氏", lines, "zh"),
        searchKeywords: generateSearchKeywords(poemData.Title.Content, poemData.Author || "无名氏", lines),
        motionPreset: motionPresets[Math.floor(Math.random() * motionPresets.length)],
      };

      poems.push(poem);
    } catch {
      // Continue to next attempt
    }
  }

  return await batchTranslateEnglishPoems(poems);
}

export async function fetchPoetryFoundationPoems(count: number, excludeIds: string[]): Promise<PoemRecord[]> {
  const poems: PoemRecord[] = [];
  const shuffledIds = [...POETRY_FOUNDATION_IDS].sort(() => Math.random() - 0.5);

  for (const id of shuffledIds) {
    if (poems.length >= count) break;

    const poemId = `pf-${id}`;
    if (excludeIds.includes(poemId)) continue;

    let win: BrowserWindow | null = null;
    try {
      win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 800,
        webPreferences: {
          javascript: true,
          images: false,
        },
      });

      await Promise.race([
        win.loadURL(`https://www.poetryfoundation.org/poems/${id}`, {
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        }),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error("Poetry Foundation load timeout")), 8000)),
      ]);

      // Wait for page to settle
      await new Promise((r) => setTimeout(r, 1500));

      const result = (await win.webContents.executeJavaScript(`
        (() => {
          const titleEl = document.querySelector('h1');
          const poemSelectors = [
            '.o-poem',
            '[data-testid="poem-body"]',
            'article div[class*="PoemBody"]',
            'div[class*="poem"]',
            '.c-userContent'
          ];
          let poemBody = null;
          for (const sel of poemSelectors) {
            poemBody = document.querySelector(sel);
            if (poemBody) break;
          }
          return {
            title: titleEl?.innerText?.trim() || document.title?.replace(' by ', ' ').split('|')[0]?.trim() || null,
            text: poemBody?.innerText?.trim() || null
          };
        })()
      `)) as { title: string | null; text: string | null };

      win.close();
      win = null;

      if (!result.title || !result.text) continue;

      let lines = result.text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      // Try to extract author
      let author = "Unknown";
      const byMatch = result.text.match(/^By\s+(.+?)(?:\n|$)/i);
      if (byMatch) {
        author = byMatch[1].trim();
        lines = lines.filter((l) => !l.match(/^By\s+/i));
      }

      if (lines.length < 2) continue;

      const motionPresets: Array<"editorial" | "cinematic" | "gallery"> = ["editorial", "cinematic", "gallery"];
      const poem: PoemRecord = {
        id: poemId,
        title: result.title,
        author,
        authorMeta: "English",
        originalLanguage: "en",
        originalText: lines,
        translatedTitle: result.title,
        translatedText: lines,
        translatorNote: "",
        imagePrompt: generateImagePrompt(result.title, author, lines, "en"),
        searchKeywords: generateSearchKeywords(result.title, author, lines),
        motionPreset: motionPresets[Math.floor(Math.random() * motionPresets.length)],
      };

      poems.push(poem);
    } catch (error) {
      console.error(`Failed to fetch Poetry Foundation poem ${id}:`, error);
      if (win) {
        try {
          win.close();
        } catch {
          // Ignore
        }
      }
    }
  }

  return await batchTranslateEnglishPoems(poems);
}

export async function fetchPoetryDBPoems(count: number, excludeIds: string[]): Promise<PoemRecord[]> {
  const poems: PoemRecord[] = [];

  try {
    const response = await fetchWithTimeout(`https://poetrydb.org/random/${count * 3}`, { timeout: 5000 });
    if (!response.ok) return [];

    const data = (await response.json()) as Array<{
      title: string;
      author: string;
      lines: string[];
    }>;

    for (const item of data) {
      if (poems.length >= count) break;

      const cleanLines = item.lines.filter((l) => l.trim().length > 0);
      if (cleanLines.length < 2) continue;

      // Generate a stable ID from title and author
      const baseId = `poetrydb-${item.title
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "-")
        .slice(0, 30)}-${item.author
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "-")
        .slice(0, 20)}`;
      if (excludeIds.includes(baseId)) continue;

      const motionPresets: Array<"editorial" | "cinematic" | "gallery"> = ["editorial", "cinematic", "gallery"];
      const poem: PoemRecord = {
        id: baseId,
        title: item.title,
        author: item.author,
        authorMeta: "English",
        originalLanguage: "en",
        originalText: cleanLines,
        translatedTitle: item.title,
        translatedText: cleanLines,
        translatorNote: "",
        imagePrompt: generateImagePrompt(item.title, item.author, cleanLines, "en"),
        searchKeywords: generateSearchKeywords(item.title, item.author, cleanLines),
        motionPreset: motionPresets[Math.floor(Math.random() * motionPresets.length)],
      };

      poems.push(poem);
    }
  } catch (error) {
    console.error("Failed to fetch from PoetryDB:", error);
  }

  return poems;
}

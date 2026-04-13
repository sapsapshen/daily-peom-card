import type { OriginalLanguage, PoemRecord } from "./types";

export interface PoemLanguageVersion {
  language: OriginalLanguage;
  title: string;
  lines: string[];
  heading: string;
  isOriginal: boolean;
}

export const getLanguageLabel = (language: OriginalLanguage) => (language === "zh" ? "中文" : "English");

export const resolvePoemVersion = (poem: PoemRecord, language: OriginalLanguage): PoemLanguageVersion => {
  if (language === poem.originalLanguage) {
    return {
      language,
      title: poem.title,
      lines: poem.originalText,
      heading: language === "zh" ? "原文" : "Original",
      isOriginal: true,
    };
  }

  return {
    language,
    title: poem.translatedTitle,
    lines: poem.translatedText,
    heading: language === "zh" ? "中译" : "English",
    isOriginal: false,
  };
};

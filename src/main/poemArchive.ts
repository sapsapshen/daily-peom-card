import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import type { PoemRecord } from "../shared/types";

const getProjectRoot = () => (app.isPackaged ? path.dirname(process.execPath) : process.cwd());
const getArchivePath = () => path.join(getProjectRoot(), "daily_recommended_archive.json");
const getFetchedLibraryPath = () => path.join(getProjectRoot(), "fetched_poems.library.json");

interface RecommendedArchive {
  recommendedIds: string[];
}

export async function readRecommendedArchive(): Promise<RecommendedArchive> {
  try {
    const raw = await readFile(getArchivePath(), "utf8");
    return { recommendedIds: [], ...JSON.parse(raw) } as RecommendedArchive;
  } catch {
    return { recommendedIds: [] };
  }
}

export async function addRecommendedIds(ids: string[]): Promise<void> {
  const archive = await readRecommendedArchive();
  const newIds = Array.from(new Set([...archive.recommendedIds, ...ids]));
  await writeFile(getArchivePath(), JSON.stringify({ recommendedIds: newIds }, null, 2), "utf8");
}

export async function readFetchedPoems(): Promise<PoemRecord[]> {
  try {
    const raw = await readFile(getFetchedLibraryPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as PoemRecord[];
    }
  } catch {
    // Return empty array
  }
  return [];
}

export async function saveFetchedPoems(poems: PoemRecord[]): Promise<void> {
  const existing = await readFetchedPoems();
  const existingIds = new Set(existing.map((p) => p.id));
  const newPoems = poems.filter((p) => !existingIds.has(p.id));
  if (newPoems.length === 0) return;

  const combined = [...existing, ...newPoems];
  await writeFile(getFetchedLibraryPath(), JSON.stringify(combined, null, 2), "utf8");
}

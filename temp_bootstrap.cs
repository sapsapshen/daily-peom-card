ile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const releaseRoot = path.join(projectRoot, "release");
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const version = packageJson.version;
const productName = "Daily Poem Card";
const appExeName = `${productName}.exe

import { readFile, stat, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const releaseRoot = path.join(projectRoot, "release");
const packageJsonPath = path.join(projectRoot, "package.json");

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const version = packageJson.version;
const setupFileName = `Daily Poem Card-Setup-${version}.exe`;
const bundleReadmeName = "WINDOWS-INSTALLER-README.txt";
const bundleZipName = `Daily Poem Card-InstallerBundle-${version}.zip`;

const setupPath = path.join(releaseRoot, setupFileName);
const bundleZipPath = path.join(releaseRoot, bundleZipName);
const bundleReadmePath = path.join(releaseRoot, bundleReadmeName);

if (!existsSync(setupPath)) {
  throw new Error(`Required installer artifact not found: ${setupPath}`);
}

const setupStat = await stat(setupPath);
const bundleReadme = [
  "Daily Poem Card Windows Installer Bundle",
  "",
  "Important:",
  `- ${setupFileName} is a self-contained single-file Windows installer.`,
  "- You can send this EXE by itself.",
  "- If you use the ZIP bundle, extract it first and then run the Setup.exe from the extracted folder.",
  "",
  "Artifact summary:",
  `- Setup.exe: ${(setupStat.size / (1024 * 1024)).toFixed(2)} MB`,
].join("\r\n");

await writeFile(bundleReadmePath, bundleReadme, "utf8");
await rm(bundleZipPath, { force: true });

const zipEntries = [setupFileName, bundleReadmeName];

const zipResult = spawnSync(
  "tar.exe",
  ["-a", "-cf", bundleZipPath, ...zipEntries],
  {
    cwd: releaseRoot,
    stdio: "inherit",
    windowsHide: true,
  },
);

if (zipResult.error) {
  throw zipResult.error;
}

if (zipResult.status !== 0) {
  throw new Error(`Failed to create installer bundle zip, tar.exe exited with code ${zipResult.status}`);
}

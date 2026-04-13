import { cp, mkdir, rm, copyFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const motionSkillRoot = process.env.AGENT_IMAGE_MOTION_ROOT ?? "D:/YunXue/agent-image-motion-skill";
const stageRoot = path.join(projectRoot, "build", "motion-skill-template");
const archivePath = path.join(projectRoot, "build", "motion-skill-template.zip");
const nodeExecutable = process.execPath;

const copyEntries = [
  ["bin", "bin"],
  ["lib", "lib"],
  ["public", "public"],
  ["src", "src"],
  ["node_modules", "vendor_node_modules"],
  ["remotion.config.ts", "remotion.config.ts"],
  ["tsconfig.json", "tsconfig.json"],
  ["package.json", "package.json"],
];

await rm(stageRoot, { recursive: true, force: true });
await mkdir(stageRoot, { recursive: true });

for (const [sourceEntry, targetEntry] of copyEntries) {
  const source = path.join(motionSkillRoot, sourceEntry);
  const target = path.join(stageRoot, targetEntry);
  await cp(source, target, { recursive: true, force: true });
}

await copyFile(
  nodeExecutable,
  path.join(stageRoot, "vendor_node_modules", ".bin", process.platform === "win32" ? "node.exe" : "node"),
);

await rm(archivePath, { force: true });

const tarResult = spawnSync(
  "tar.exe",
  ["-a", "-cf", archivePath, "-C", path.join(projectRoot, "build"), "motion-skill-template"],
  {
    cwd: projectRoot,
    stdio: "inherit",
    windowsHide: true,
  },
);

if (tarResult.error) {
  throw tarResult.error;
}

if (tarResult.status !== 0) {
  throw new Error(`tar.exe failed with exit code ${tarResult.status}`);
}

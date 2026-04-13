import { cp, mkdir, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const archivePath = path.join(projectRoot, "release", "win-unpacked", "resources", "motion-skill-template.zip");
const workRoot = path.join(projectRoot, "build", "node-materialize-smoke");
const extractRoot = path.join(workRoot, "extract");
const preparedRoot = path.join(workRoot, "prepared");
const extractedTemplateRoot = path.join(extractRoot, "motion-skill-template");
const vendorNodeModulesPath = path.join(preparedRoot, "vendor_node_modules");
const nodeModulesPath = path.join(preparedRoot, "node_modules");
const outputPath = path.join(projectRoot, "build", "node-materialize-smoke.mp4");

await rm(workRoot, { recursive: true, force: true });
await mkdir(extractRoot, { recursive: true });

const extractResult2 = spawnSync(
  "tar.exe",
  ["-xf", archivePath, "-C", extractRoot],
  {
    windowsHide: true,
    stdio: "ignore",
  },
);
if (extractResult2.error) throw extractResult2.error;
if (extractResult2.status !== 0) throw new Error(`tar.exe extraction exited with code ${extractResult2.status}`);

await cp(extractedTemplateRoot, preparedRoot, { recursive: true, force: true });

if (existsSync(vendorNodeModulesPath)) {
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
}

const nodeExecutable = path.join(nodeModulesPath, ".bin", "node.exe");
const smokeResult = spawnSync(
  nodeExecutable,
  [
    path.join(preparedRoot, "bin", "agent-image-motion.mjs"),
    "--mode=render",
    "--images=build/icon.png",
    "--title=Node Materialize Smoke",
    "--subtitle=Installer speed optimization",
    "--preset=editorial",
    "--width=900",
    "--height=1360",
    "--fps=18",
    "--durationInFrames=45",
    "--codec=h264",
    "--atmosphere=true",
    "--particles=false",
    "--floatingCards=false",
    "--sweepLight=false",
    "--texture=false",
    "--intensity=0.5",
    `--output=${outputPath}`,
  ],
  {
    cwd: projectRoot,
    stdio: "inherit",
    windowsHide: true,
  },
);

if (smokeResult.error) {
  throw smokeResult.error;
}
if (smokeResult.status !== 0) {
  throw new Error(`Smoke render exited with code ${smokeResult.status}`);
}

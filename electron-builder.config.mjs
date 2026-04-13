import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const motionSkillRoot = process.env.AGENT_IMAGE_MOTION_ROOT ?? "D:/YunXue/agent-image-motion-skill";
const stagedMotionRuntimeArchive = path.join(projectRoot, "build", "motion-skill-template.zip");

export default {
  appId: "com.yunxue.dailypoemcard",
  productName: "Daily Poem Card",
  afterPack: path.join(projectRoot, "scripts", "after-pack-rcedit.mjs"),
  directories: {
    output: "release",
  },
  files: [
    "out/**/*",
    "package.json",
    "!llm.config.json",
    "!llm.config.sample.json",
    "!premium.config.json",
    "!premium.config.sample.json",
    "!start-ai-agent.bat",
    "!release{,/**}",
  ],
  extraResources: [
    {
      from: stagedMotionRuntimeArchive,
      to: "motion-skill-template.zip",
    },
    {
      from: path.join(projectRoot, "build", "icon.png"),
      to: "icon.png",
    },
  ],
  asar: true,
  win: {
    signAndEditExecutable: false,
    icon: path.join(projectRoot, "build", "icon.ico"),
    target: [
      {
        target: "nsis",
        arch: ["x64"],
      },
    ],
    artifactName: "${productName}-Setup-${version}.${ext}",
    requestedExecutionLevel: "asInvoker",
  },
  nsis: {
    include: path.join(projectRoot, "build", "installer.nsh"),
    oneClick: false,
    perMachine: false,
    differentialPackage: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    runAfterFinish: false,
    installerIcon: path.join(projectRoot, "build", "icon.ico"),
    uninstallerIcon: path.join(projectRoot, "build", "icon.ico"),
    installerHeaderIcon: path.join(projectRoot, "build", "icon.ico"),
    preCompressedFileExtensions: [".zip", ".mp4", ".mov", ".m4v", ".m4p", ".qt", ".mkv", ".webm", ".avi", ".vmdk"],
  },
};

import path from "node:path";
import { rcedit } from "rcedit";

export default async function afterPack(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const productFilename = context.packager.appInfo.productFilename;
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
  const iconPath = path.join(context.packager.projectDir, "build", "icon.ico");

  await rcedit(exePath, {
    icon: iconPath,
    "requested-execution-level": "asInvoker",
    "version-string": {
      ProductName: "Daily Poem Card",
      FileDescription: "Daily Poem Card",
      OriginalFilename: `${productFilename}.exe`,
      CompanyName: "YunXue",
    },
  });
}

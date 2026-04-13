import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const releaseRoot = path.join(projectRoot, "release");
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const version = packageJson.version;
const productName = "Daily Poem Card";
const appExeName = `${productName}.exe`;

const publicSetupName = `${productName}-Setup-${version}.exe`;
const payloadZipName = `daily-poem-card-app-payload-${version}.zip`;
const nsisArchiveName = `daily-poem-card-${version}-x64.nsis.7z`;
const blockmapName = `${publicSetupName}.blockmap`;
const nsisUninstallerName = `${productName}-Setup-${version}.__uninstaller.exe`;

const publicSetupPath = path.join(releaseRoot, publicSetupName);
const payloadZipPath = path.join(releaseRoot, payloadZipName);
const appUnpackedRoot = path.join(releaseRoot, "win-unpacked");
const blockmapPath = path.join(releaseRoot, blockmapName);
const iconPath = path.join(projectRoot, "build", "icon.ico");
const stageRoot = path.join(releaseRoot, "full-installer-stage");
const sourcePath = path.join(stageRoot, "FullInstallerBootstrap.cs");
const wrapperOutputPath = path.join(stageRoot, `${publicSetupName}.tmp`);
const nsisArchivePath = path.join(releaseRoot, nsisArchiveName);
const nsisUninstallerPath = path.join(releaseRoot, nsisUninstallerName);

if (!existsSync(appUnpackedRoot)) {
  throw new Error(`Missing unpacked app output: ${appUnpackedRoot}`);
}

if (!existsSync(publicSetupPath)) {
  throw new Error(`Missing electron-builder setup launcher: ${publicSetupPath}`);
}

if (!existsSync(path.join(appUnpackedRoot, appExeName))) {
  throw new Error(`Missing unpacked app executable: ${path.join(appUnpackedRoot, appExeName)}`);
}

const setupStats = await stat(publicSetupPath);
if (setupStats.size > 5 * 1024 * 1024) {
  console.log(`Skipping full-installer wrapping because ${publicSetupName} already looks self-contained.`);
  process.exit(0);
}

const cscCandidates = [
  process.env.CSC_PATH,
  "C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe",
  "C:/Windows/Microsoft.NET/Framework/v4.0.30319/csc.exe",
].filter(Boolean);

const cscCommand = cscCandidates.find((candidate) => existsSync(candidate));

if (!cscCommand) {
  throw new Error("Could not find csc.exe to build the single-file installer wrapper.");
}

await rm(stageRoot, { recursive: true, force: true });
await mkdir(stageRoot, { recursive: true });

await rm(payloadZipPath, { force: true });
const zipResult = spawnSync(
  "tar.exe",
  ["-a", "-cf", payloadZipPath, "."],
  {
  cwd: appUnpackedRoot,
  stdio: "inherit",
  windowsHide: true,
  },
);

if (zipResult.error) {
  throw zipResult.error;
}

if (zipResult.status !== 0) {
  throw new Error(`Failed to create app payload zip, tar.exe exited with code ${zipResult.status}`);
}

const sourceFile = `using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading;
using System.IO.Compression;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class FullInstallerBootstrap
{
  private const string ProductName = "${productName}";
  private const string AppExeName = "${appExeName}";
  private const string PayloadResourceName = "${payloadZipName}";
  private const string InstallerCopyName = "Daily Poem Card Installer.exe";
  private const string UninstallRegistryKey = @"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DailyPoemCard";

    [STAThread]
  private static int Main(string[] args)
    {
    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);

        try
        {
      if (HasArg(args, "/uninstall"))
      {
        var uninstallDir = ParseInstallDir(args) ?? InferInstallDirFromExecutable();
        UninstallApplication(uninstallDir, HasArg(args, "/silent"));
        return 0;
      }

      if (HasArg(args, "/silent"))
      {
        InstallApplication(ParseInstallDir(args) ?? GetDefaultInstallDir(), null);
        return 0;
      }

      using (var form = new InstallerForm())
      {
        return form.ShowDialog() == DialogResult.OK ? 0 : 1;
      }
        }
        catch (Exception ex)
        {
            MessageBox.Show(
        "Unable to complete installation.\\r\\n\\r\\n无法完成安装。\\r\\n\\r\\n" + ex,
                "Daily Poem Card Installer",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            return 1;
        }
  }

  private static bool HasArg(string[] args, string expected)
  {
    foreach (var arg in args)
        {
      if (string.Equals(arg, expected, StringComparison.OrdinalIgnoreCase))
      {
        return true;
      }
        }

    return false;
    }

  private static string ParseInstallDir(string[] args)
    {
    foreach (var arg in args)
        {
      if (arg.StartsWith("/D=", StringComparison.OrdinalIgnoreCase))
      {
        return arg.Substring(3).Trim('"');
      }
    }

    return null;
  }

  private static string GetDefaultInstallDir()
  {
    return Path.Combine(
      Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
      "Programs",
      ProductName
    );
  }

  private static string InferInstallDirFromExecutable()
  {
    var executableDir = Path.GetDirectoryName(Application.ExecutablePath);
    if (!string.IsNullOrWhiteSpace(executableDir) && File.Exists(Path.Combine(executableDir, AppExeName)))
        {
      return executableDir;
        }

    return GetDefaultInstallDir();
    }

  private static void InstallApplication(string installDir, Action<string> reportStatus)
    {
    if (string.IsNullOrWhiteSpace(installDir))
        {
      throw new InvalidOperationException("Installation directory is empty.");
    }

    reportStatus = reportStatus ?? delegate { };
    var stagingRoot = Path.Combine(Path.GetTempPath(), "DailyPoemCardInstaller", Guid.NewGuid().ToString("N"));
    var payloadZipPath = Path.Combine(stagingRoot, PayloadResourceName);
    var extractRoot = Path.Combine(stagingRoot, "app");

    Directory.CreateDirectory(stagingRoot);

    try
    {
      reportStatus("Preparing installer... / 正在准备安装程序...");
      ExtractResource(PayloadResourceName, payloadZipPath);

      reportStatus("Extracting application files... / 正在解压应用文件...");
      Directory.CreateDirectory(extractRoot);
      ZipFile.ExtractToDirectory(payloadZipPath, extractRoot);

      reportStatus("Copying files to installation directory... / 正在复制文件到安装目录...");
      if (Directory.Exists(installDir))
            {
        TryDeleteDirectory(installDir);
            }

      Directory.CreateDirectory(installDir);
      CopyDirectory(extractRoot, installDir);

      reportStatus("Creating shortcuts... / 正在创建快捷方式...");
      CreateShortcut(GetDesktopShortcutPath(), Path.Combine(installDir, AppExeName));
      CreateShortcut(GetStartMenuShortcutPath(), Path.Combine(installDir, AppExeName));

      reportStatus("Registering uninstall information... / 正在注册卸载信息...");
      var installerCopyPath = Path.Combine(installDir, InstallerCopyName);
      File.Copy(Application.ExecutablePath, installerCopyPath, true);
      RegisterUninstall(installDir, installerCopyPath);

      reportStatus("Installation complete. / 安装完成。");

      MessageBox.Show(
        "Daily Poem Card is installed.\\r\\n\\r\\n每日诗卡已安装完成。",
        "Daily Poem Card Installer",
        MessageBoxButtons.OK,
        MessageBoxIcon.Information
      );
    }
    finally
    {
      TryDeleteDirectory(stagingRoot);
        }
    }

  private static void UninstallApplication(string installDir, bool silent)
  {
    if (!string.IsNullOrWhiteSpace(installDir) && Directory.Exists(installDir))
    {
      TryDeleteFile(GetDesktopShortcutPath());
      TryDeleteFile(GetStartMenuShortcutPath());

      using (var key = Registry.CurrentUser.OpenSubKey(@"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall", true))
      {
        if (key != null)
        {
          key.DeleteSubKeyTree("DailyPoemCard", false);
        }
      }

      ScheduleDirectoryRemoval(installDir);
    }

    if (!silent)
    {
      MessageBox.Show(
        "Daily Poem Card uninstall has started. Some files may disappear a few seconds later.\\r\\n\\r\\n每日诗卡卸载已开始，部分文件会在几秒后移除。",
        "Daily Poem Card Installer",
        MessageBoxButtons.OK,
        MessageBoxIcon.Information
      );
    }
  }

  private static void ExtractResource(string resourceName, string outputPath)
  {
    var assembly = Assembly.GetExecutingAssembly();
    using (var stream = assembly.GetManifestResourceStream(resourceName))
    {
      if (stream == null)
      {
        throw new InvalidOperationException("Missing embedded resource: " + resourceName);
      }

      using (var file = File.Create(outputPath))
      {
        stream.CopyTo(file);
      }
    }
  }

  private static void CopyDirectory(string sourceDir, string destinationDir)
  {
    foreach (var directory in Directory.GetDirectories(sourceDir, "*", SearchOption.AllDirectories))
    {
      var targetDirectory = directory.Replace(sourceDir, destinationDir);
      Directory.CreateDirectory(targetDirectory);
    }

    foreach (var file in Directory.GetFiles(sourceDir, "*", SearchOption.AllDirectories))
    {
      var targetFile = file.Replace(sourceDir, destinationDir);
      Directory.CreateDirectory(Path.GetDirectoryName(targetFile));
      File.Copy(file, targetFile, true);
    }
  }

  private static void CreateShortcut(string shortcutPath, string targetPath)
  {
    var shellType = Type.GetTypeFromProgID("WScript.Shell");
    if (shellType == null)
    {
      return;
    }

    dynamic shell = null;
    dynamic shortcut = null;

    try
    {
      shell = Activator.CreateInstance(shellType);
      shortcut = shell.CreateShortcut(shortcutPath);
      shortcut.TargetPath = targetPath;
      shortcut.WorkingDirectory = Path.GetDirectoryName(targetPath);
      shortcut.IconLocation = targetPath;
      shortcut.Description = ProductName;
      shortcut.Save();
    }
    finally
    {
      if (shortcut != null)
      {
        System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shortcut);
      }

      if (shell != null)
      {
        System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);
      }
    }
  }

  private static void RegisterUninstall(string installDir, string installerCopyPath)
  {
    using (var key = Registry.CurrentUser.CreateSubKey(UninstallRegistryKey))
    {
      if (key == null)
      {
        return;
      }

      key.SetValue("DisplayName", ProductName);
      key.SetValue("DisplayVersion", "${version}");
      key.SetValue("Publisher", "YunXue");
      key.SetValue("InstallLocation", installDir);
      key.SetValue("DisplayIcon", Path.Combine(installDir, AppExeName));
            key.SetValue("UninstallString", "\\\"" + installerCopyPath + "\\\" /uninstall /D=\\\"" + installDir + "\\\"");
            key.SetValue("QuietUninstallString", "\\\"" + installerCopyPath + "\\\" /uninstall /silent /D=\\\"" + installDir + "\\\"");
      key.SetValue("NoModify", 1, RegistryValueKind.DWord);
      key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
    }
  }

  private static void ScheduleDirectoryRemoval(string directoryPath)
  {
    var cmd = "/c ping 127.0.0.1 -n 3 > nul && rmdir /s /q \\\"" + directoryPath + "\\\"";
    Process.Start(new ProcessStartInfo
    {
      FileName = "cmd.exe",
      Arguments = cmd,
      CreateNoWindow = true,
      UseShellExecute = false,
    });
  }

  private static string GetDesktopShortcutPath()
  {
    return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), ProductName + ".lnk");
  }

  private static string GetStartMenuShortcutPath()
  {
    return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), ProductName + ".lnk");
  }

  private static void TryDeleteFile(string filePath)
  {
    try
    {
      if (File.Exists(filePath))
      {
        File.Delete(filePath);
      }
    }
    catch
    {
    }
  }

  private static void TryDeleteDirectory(string path)
  {
    for (var attempt = 0; attempt < 10; attempt++)
    {
      try
      {
        if (Directory.Exists(path))
        {
          Directory.Delete(path, true);
        }

        return;
      }
      catch
      {
        Thread.Sleep(250);
      }
    }
  }

  private sealed class InstallerForm : Form
  {
    private readonly TextBox installDirTextBox;
    private readonly Label statusLabel;
    private readonly Button installButton;
    private readonly Button cancelButton;

    public InstallerForm()
    {
      Text = "Daily Poem Card Installer";
      Width = 560;
      Height = 240;
      FormBorderStyle = FormBorderStyle.FixedDialog;
      MaximizeBox = false;
      MinimizeBox = false;
      StartPosition = FormStartPosition.CenterScreen;

      var titleLabel = new Label
      {
        Left = 20,
        Top = 20,
        Width = 500,
        Height = 40,
        Text = "Install Daily Poem Card\\r\\n安装每日诗卡",
      };

      var pathLabel = new Label
      {
        Left = 20,
        Top = 80,
        Width = 500,
        Text = "Install location / 安装位置",
      };

      installDirTextBox = new TextBox
      {
        Left = 20,
        Top = 105,
        Width = 410,
        Text = GetDefaultInstallDir(),
      };

      var browseButton = new Button
      {
        Left = 440,
        Top = 103,
        Width = 80,
        Text = "Browse",
      };
      browseButton.Click += BrowseButton_Click;

      statusLabel = new Label
      {
        Left = 20,
        Top = 140,
        Width = 500,
        Height = 30,
        Text = "Ready to install / 准备安装",
      };

      installButton = new Button
      {
        Left = 340,
        Top = 175,
        Width = 85,
        Text = "Install",
      };
      installButton.Click += InstallButton_Click;

      cancelButton = new Button
      {
        Left = 435,
        Top = 175,
        Width = 85,
        Text = "Cancel",
      };
      cancelButton.Click += delegate { Close(); };

      Controls.Add(titleLabel);
      Controls.Add(pathLabel);
      Controls.Add(installDirTextBox);
      Controls.Add(browseButton);
      Controls.Add(statusLabel);
      Controls.Add(installButton);
      Controls.Add(cancelButton);
    }

    private void BrowseButton_Click(object sender, EventArgs e)
    {
      using (var dialog = new FolderBrowserDialog())
      {
        dialog.SelectedPath = installDirTextBox.Text;
        dialog.Description = "Choose the installation folder / 选择安装目录";
        if (dialog.ShowDialog(this) == DialogResult.OK)
        {
          installDirTextBox.Text = dialog.SelectedPath;
        }
      }
    }

    private void InstallButton_Click(object sender, EventArgs e)
    {
      try
      {
        ToggleBusy(true);
        InstallApplication(installDirTextBox.Text, UpdateStatus);
        DialogResult = DialogResult.OK;
        Close();
      }
      catch (Exception ex)
      {
        ToggleBusy(false);
        MessageBox.Show(
          this,
          "Installation failed.\\r\\n\\r\\n安装失败。\\r\\n\\r\\n" + ex,
          "Daily Poem Card Installer",
          MessageBoxButtons.OK,
          MessageBoxIcon.Error
        );
      }
    }

    private void UpdateStatus(string message)
    {
      statusLabel.Text = message;
      statusLabel.Refresh();
      Application.DoEvents();
    }

    private void ToggleBusy(bool busy)
    {
      installDirTextBox.Enabled = !busy;
      installButton.Enabled = !busy;
      cancelButton.Enabled = !busy;
      UseWaitCursor = busy;
    }
  }
}
`;

await writeFile(sourcePath, sourceFile, "utf8");
await rm(wrapperOutputPath, { force: true });
await rm(blockmapPath, { force: true });

const result = spawnSync(cscCommand, [
  "/nologo",
  "/target:winexe",
  "/platform:x64",
  `/out:${wrapperOutputPath}`,
  `/win32icon:${iconPath}`,
  "/reference:System.Windows.Forms.dll",
  "/reference:System.Drawing.dll",
  "/reference:System.IO.Compression.dll",
  "/reference:System.IO.Compression.FileSystem.dll",
  `/resource:${payloadZipPath},${payloadZipName}`,
  sourcePath,
], {
  cwd: stageRoot,
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  throw new Error(`csc.exe failed with exit code ${result.status}`);
}

if (!existsSync(wrapperOutputPath)) {
  throw new Error(`Expected full installer wrapper was not created: ${wrapperOutputPath}`);
}

await rm(publicSetupPath, { force: true });
await writeFile(publicSetupPath, await readFile(wrapperOutputPath));

await rm(stageRoot, { recursive: true, force: true });
await rm(payloadZipPath, { force: true });
await rm(blockmapPath, { force: true });
await rm(nsisArchivePath, { force: true });
await rm(nsisUninstallerPath, { force: true });
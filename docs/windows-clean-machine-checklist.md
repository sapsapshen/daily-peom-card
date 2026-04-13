# Windows Clean Machine Checklist

Use this checklist to validate that the packaged installer behaves like a true standalone desktop app on a machine that does not have the development workspace, the external motion skill repo, or a system Node.js installation.

## Test Environment

1. Windows 10 or Windows 11
2. No `D:\YunXue\agent-image-motion-skill` directory
3. No system `node` command in `PATH`
4. No local source checkout of `daily-peom-card`
5. Fresh user profile or disposable VM snapshot recommended

## Install Validation

1. Run `Daily Poem Card-Setup-0.1.0.exe`
2. Confirm the installer shows the branded product name `Daily Poem Card`
3. Confirm desktop and Start Menu shortcuts are created if selected
4. Launch the app directly from the installed location, not from the source repo

## Startup Validation

1. App launches without a terminal window
2. App opens without requiring the external motion skill repository
3. The main window icon is branded instead of the default Electron icon
4. No blocking startup error appears about missing motion runtime assets

## Motion Runtime Validation

1. Wait for the featured card background to finish preparing
2. Confirm the app does not require an external `node` installation
3. Confirm the packaged motion runtime can render on the clean machine
4. If rendering fails, capture the exact status-bar message and inspect `%LOCALAPPDATA%` logs if available

## Core Feature Validation

1. Switch between Chinese and English
2. Verify the header, status bar, poet atlas chips, and bottom interaction tabs all follow the selected language
3. Save plain text and confirm output is written to `daily_poem_archive.md`
4. Export an animated card and confirm output is written under `daily_save/`
5. Open the exported folder and confirm it contains HTML, poster, video, and metadata files

## Share Validation

1. Use `Copy` and confirm the generated caption reaches the clipboard
2. Use one social target and verify the platform handoff opens without crashing the app
3. Confirm share actions do not depend on the development repo path

## Packaging Validation

Inspect the installed app resources and confirm these packaged files exist:

1. `resources/motion-skill/bin/agent-image-motion.mjs`
2. `resources/motion-skill/lib/run-agent-image-motion.mjs`
3. `resources/motion-skill/node_modules/.bin/node.exe`
4. `resources/motion-skill/node_modules/.bin/remotion.cmd`

Confirm these runtime config files are not bundled:

1. `llm.config.json`
2. `llm.config.sample.json`

## Pass Criteria

1. The app launches and remains usable on a machine with no development environment
2. Motion background generation works using only packaged resources
3. Animated export works from the installed app
4. No feature depends on `D:\YunXue\agent-image-motion-skill`
5. No feature depends on a system Node.js installation

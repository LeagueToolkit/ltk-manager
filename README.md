# 🛠️ LTK Manager

The next-generation mod manager for League of Legends, built by the [League Toolkit](https://github.com/LeagueToolkit) organization. LTK Manager is the modern successor to [cslol-manager](https://github.com/LeagueToolkit/cslol-manager), rebuilt from the ground up with a Rust backend and a React-based UI.

[![Releases](https://img.shields.io/github/v/release/LeagueToolkit/ltk-manager?style=for-the-badge)](https://github.com/LeagueToolkit/ltk-manager/releases)
[![License: MIT/Apache-2.0](https://img.shields.io/badge/License-MIT%2FApache--2.0-blue?style=for-the-badge)](https://github.com/LeagueToolkit/ltk-manager)
[![Windows 10+](https://img.shields.io/badge/Windows-10+-0078D4?style=for-the-badge&logo=windows)](https://www.microsoft.com/windows)
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FLeagueToolkit%2Fltk-manager.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2FLeagueToolkit%2Fltk-manager?ref=badge_shield)

---

## 📸 Screenshots

|                  Mod Library                  |                  Workshop                   |                  Settings                   |
| :-------------------------------------------: | :-----------------------------------------: | :-----------------------------------------: |
| ![Mod Library](docs/screenshots/library.webp) | ![Workshop](docs/screenshots/workshop.webp) | ![Settings](docs/screenshots/settings.webp) |

---

## ✨ Features

- **Mod Library** — Install, enable, disable, reorder, and uninstall mods with a visual card-based interface. Supports drag-and-drop installation.
- **Profile Management** — Create multiple profiles to quickly switch between different mod configurations.
- **Workshop (Creator Tools)** — Build and package your own mods with a full project editor, layer management, and `.modpkg` export.
- **Mod Inspector** — Preview mod contents and metadata before installing.
- **Overlay Patcher** — Apply your mods to League of Legends with a single click. Real-time progress tracking keeps you informed.
- **Automatic Updates** — The app checks for new versions and can update itself in the background.
- **Theming** — Dark and light themes with a fully customizable accent color and optional backdrop images.

### Supported Mod Formats

| Format     | Description                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| `.modpkg`  | LeagueToolkit mod package — the recommended format with full metadata, thumbnails, and multi-layer support |
| `.fantome` | Legacy Fantome format — automatically recognized and fully supported                                       |

---

## 🚀 Getting Started

### Prerequisites

- **Windows 10 or 11** (64-bit). macOS and Linux support is planned.
- **League of Legends** — a valid game installation.

### Installation

1. Go to the [latest release](https://github.com/LeagueToolkit/ltk-manager/releases/latest).
2. Download the `.msi` installer (recommended) or the NSIS `.exe` installer.
3. Run the installer and launch **LTK Manager**.
4. On first launch, the app will attempt to auto-detect your League of Legends installation. If it can't find it, you'll be prompted to select the game folder manually.

### Installing Mods

1. Download a mod in `.modpkg` or `.fantome` format from your preferred source.
2. Drag and drop the file onto the LTK Manager window, or use the install button.
3. Enable the mod in your library and click **Run** to start the patcher.

---

## ⚖️ License & Reuse

LTK Manager is open-source under a dual **MIT / Apache-2.0** license — you may choose either.

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FLeagueToolkit%2Fltk-manager.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2FLeagueToolkit%2Fltk-manager?ref=badge_large)

### `cslol-dll.dll` Policy

This application bundles `cslol-dll.dll`, the core injection module originally from cslol-manager. Its use and redistribution are governed by the [CSLOL DLL License Addendum](LICENSE-CSLOL.md).

If you are a developer looking to reuse this DLL in your own launcher or tool, you must comply with the following:

1. **Re-signing** — You may not redistribute the DLL with the official signature. You must re-sign it using your own publicly trusted code-signing certificate.
2. **Transparency** — You must publish your certificate's SHA-256 fingerprint and the DLL's SHA-256 hash in your project's documentation or about page.
3. **Anti-Skinhacking** — You must implement technical measures to prevent the use of "skinhacking" (replicating paid content) and competitive advantage mods.
4. **No Reverse Engineering** — Patching or tampering with the DLL itself is strictly prohibited.

For full terms, see [LICENSE-CSLOL.md](LICENSE-CSLOL.md).

---

## ⚠️ Disclaimer

- **Use at your own risk.** This software is not endorsed by or affiliated with Riot Games.
- **Server support:** Officially supports Riot-operated servers. Asian servers and Garena are not officially supported and may experience issues.

---

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a pull request.

If you'd like to build LTK Manager from source or work on the codebase, see the [Development Guide](docs/DEVELOPMENT.md).

---

Developed by the **[League Toolkit](https://github.com/LeagueToolkit)** organization.

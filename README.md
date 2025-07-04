# 🎨 Excali Local

> A powerful browser extension that brings offline Excalidraw editing with screenshot annotation and presentation features.

<p align="center">
  <img src="./.assets/banner.jpg" alt="Banner">
</p>

## ✨ Key Features

- **📸 Smart Screenshot Annotation** - Capture any webpage area and instantly annotate with Excalidraw
- **🔧 Offline Excalidraw Editor** - Full-featured local editor that works without internet
- **📊 Presentation Mode** - Turn your drawings into interactive slide presentations
- **⌨️ Keyboard Shortcuts** - Quick access to all features
- **🌙 Dark Mode Support** - Seamless theme switching

## 🚀 Quick Start

### Install
- [Chrome Web Store](https://chromewebstore.google.com/detail/excali-local/ebmgbhnihcbgpbcjnjeamnkkplnppddd)
- [Firefox Add-ons](https://addons.mozilla.org/addon/excali-local)
- [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/excali-local/kflccadkimelkkjcmedhhfbnnlbdggol)

### Demo
- [YouTube](https://youtu.be/_aHWUz9Og-I) | [Bilibili](https://www.bilibili.com/video/BV1gJqnY3EAP)

## 📖 How It Works

### 1. Screenshot & Annotate
<img src="./.assets/capture-tab.png" width="400px" /> <img src="./.assets/select-area.png" width="400px" />

Capture full page or select specific areas, then annotate directly in Excalidraw.

### 2. Smart Marking Tools
<img src="./.assets/number-mark-tool.png" width="600px" />

Use specialized marking tools for quick annotations and callouts.

### 3. Presentation Mode
<img src="./.assets/presentation-mode.png" width="600px" />

Transform your drawings into professional presentations with slide navigation.

## 🛠️ Development

This project uses a monorepo structure with Bun as the package manager.

```bash
# Install dependencies
bun install

# Development
bun run page:dev      # Start editor webapp
bun run local:dev     # Start extension development

# Build
bun run page:build    # Build editor webapp
bun run local:build   # Build extension
bun run local:tar     # Archive build assets
```

## 🗺️ Roadmap

- [x] Screenshot annotation with area selection
- [x] Offline Excalidraw editor
- [x] Presentation mode with slide navigation
- [x] Keyboard shortcuts support
- [x] Internationalization (i18n)
- [x] Dark mode support
- [x] Settings customization

---

*Screenshots from [unDraw](https://undraw.co/) - Free illustrations for everyone.*


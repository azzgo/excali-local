# Excali Local

[English](./README.md)

> 一款本地优先、完全离线的 Excalidraw 应用，整个运行在你的浏览器里。

<p align="center">
  <img src="./.assets/new-banner.png" alt="Excali Local banner">
</p>

Excali Local 是一个浏览器扩展，让 **Excalidraw 完全离线可用**：截图标注、完整的本地编辑器、私有图库和演示模式——没有后端、没有账号、没有上传。每张绘图都留在你的浏览器里。

## v1.8.0 新特性

- **实时协作** — 无宿主、端到端加密的房间，跑在你自行部署的中继之上（约 150 行的 PartyKit 参考实现；没有 Excali Local 后端——中继只转发密文）。团队房间对组织端到端加密，私有房间按房间端到端加密；包含文件同步。→ [协作指南](docs/COLLAB.zh-CN.md) · [ADR 0003](docs/adr/0003-byo-relay-realtime-collab.md)

## v1.7.0 新特性

- **从 ZIP 导入图库** — 把之前导出的压缩包（即使在应用之外编辑过）重新导入图库。
- **智能体驱动编辑** — 通过 `excali-local` 技能和 `excali-bridge` 守护进程，经仅限本地的 WebSocket，从 CLI 或 AI 智能体驱动当前画布。→ [Agent Bridge 指南](docs/AGENT_BRIDGE.zh-CN.md)

> 快速上手（约 1 分钟、无声、双语字幕）：
>
> [![Agent Drive 快速上手 — 1 分钟、无声、带双语字幕](https://img.youtube.com/vi/0ceYcxnoB9M/maxresdefault.jpg)](https://youtu.be/0ceYcxnoB9M)

## 功能

- **截图标注** — 截取整页或框选区域，然后在 Excalidraw 中标注。
- **离线编辑器** — 完整的 Excalidraw 体验，无需联网。
- **图库与集合** — 在本地保存、整理、搜索和管理绘图；可将全部内容导出或导入为 ZIP 压缩包。
- **演示模式** — 把任何绘图变成基于幻灯片的演示。
- **自定义字体** — 上传 `.ttf`、`.woff` 或 `.woff2` 字体，或使用系统字体；编辑器基于完全离线的 Excalidraw 0.18 分支构建。
- **直接打开 `.excalidraw` 文件** — 从任意网站或本地文件夹在编辑器中打开文件。
- **快捷键与深色模式** — 处处快速访问，夜间护眼。

## 安装

- [Chrome 网上应用店](https://chromewebstore.google.com/detail/excali-local/ebmgbhnihcbgpbcjnjeamnkkplnppddd)
- [Firefox 附加组件](https://addons.mozilla.org/addon/excali-local)
- [Edge 加载项](https://microsoftedge.microsoft.com/addons/detail/excali-local/kflccadkimelkkjcmedhhfbnnlbdggol)

演示：[YouTube](https://youtu.be/_aHWUz9Og-I) | [哔哩哔哩](https://www.bilibili.com/video/BV1gJqnY3EAP)

## 工作原理

1. **截图并标注** — 截取整页或框选区域，直接在 Excalidraw 中标注。

| 整页截图 | 框选区域 |
|:-:|:-:|
| <img src="./.assets/capture-tab.png" width="480px" /> | <img src="./.assets/select-area.png" width="480px" /> |

2. **本地编辑与整理** — 每张绘图都存在浏览器里（IndexedDB）。把绘图归入集合、搜索它们，并将全部内容导出或导入为 ZIP 压缩包。

| 空图库侧栏 | 带绘图的图库 |
|:-:|:-:|
| <img src="./.assets/gallery-sidebar-empty.png" width="480px" /> | <img src="./.assets/gallery-with-drawing.png" width="480px" /> |

3. **演示** — 用简单的导航把绘图变成幻灯片演示。

<img src="./.assets/presentation-mode.png" />

4. **个性化** — 上传自己的字体，或使用系统字体系列（`.ttf`、`.woff`、`.woff2`）。

<img src="./.assets/FontFamily-Customization.png" />

5. **打开 `.excalidraw` 文件** — 被识别的文件会得到"用 Excali Local 打开"按钮，一键导入。

<video src="https://github.com/user-attachments/assets/3be7b273-cac4-4fc8-ab03-5bb50eab8cd4" autoplay loop muted></video>

6. **从智能体或 CLI 驱动画布** — 在扩展中开启智能体访问，安装技能（`npx skills add azzgo/excali-local --skill excali-local -y`），然后通过本地 WebSocket 桥接以编程方式绘图。完整指南：[Agent Bridge 指南](docs/AGENT_BRIDGE.zh-CN.md)。

## 参见

构建智能体驱动功能时参考过的实现：

- [smart-excalidraw-next](https://github.com/liujuntao123/smart-excalidraw-next) — 一个支持智能体驱动画布控制的 Next.js Excalidraw 应用。
- [excalidraw-diagram-skill](https://github.com/coleam00/excalidraw-diagram-skill) — 一个用于绘制 Excalidraw 图表的智能体技能。

## 开发

基于 pnpm 的 monorepo。

```bash
pnpm install        # 安装依赖
pnpm page:dev       # 启动编辑器 webapp
pnpm page:build     # 构建编辑器 webapp
pnpm local:build    # 构建扩展（然后以解压方式加载 .output/chrome-mv3）
pnpm local:tar      # 归档构建产物
```

---

*截图来自 [unDraw](https://undraw.co/) — 面向所有人的免费插图。*

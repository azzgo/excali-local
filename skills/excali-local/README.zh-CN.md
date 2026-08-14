# excali-local —— 智能体无关的绘图技能

[English](./README.md)

一个自包含的技能，教任何编码智能体通过一个小巧的 CLI —— `excali-bridge` —— 驱动 **Excali
Local** 编辑器（一个本地优先、完全离线的浏览器扩展，运行 Excalidraw）。

- **先读** [`SKILL.md`](SKILL.md) —— 总览、授权模型、路由。
- **参考文档** 在 [`references/`](references/)（命令面、元素模板、JSON schema、调色板、
  样式预设、图形语法、工作流）。
- **守护进程（daemon）** 已为四个平台预构建，放在 [`bin/`](bin/) 下。它既是编辑器页面连接的
  WS 服务器（Leg B），也是你调用的智能体 CLI（Leg A）——一个二进制，首次使用懒加载启动。

## 安装

### 快速安装（推荐）

把下面这段粘贴给你的 AI 智能体（Claude、Codex、Cursor、Pi、Gemini CLI 等）——它会帮你处理一切：

> 从 azzgo/excali-local 安装 excali-local 技能。安装后，从技能的 bin 目录运行
> `excali-bridge ping` 来启动守护进程。我在 macOS Apple Silicon 上。

就这样。智能体会安装技能、检测你的平台并启动守护进程。守护进程运行后，在浏览器中打开
Excali Local 扩展——它会检测到守护进程并提供配对（弹窗显示 "Paired"（已配对）；画布按钮：
就绪 → 激活）。

### 手动安装

如果你想自己安装，使用 [`skills`](https://github.com/vercel-labs/skills) CLI
（npm 包 `skills`，由 **vercel-labs/skills** 维护）：

```bash
npx skills add azzgo/excali-local --skill excali-local -y
```

安装前可用只读发现（`--list`）确认技能存在且名为 `excali-local`：

```bash
npx skills add azzgo/excali-local --list
```

然后告诉你的智能体启动守护进程：

> **"使用 excali-local 技能：运行 excali-bridge ping"**

或者你自己从技能文件夹运行（见下文的[选择你的二进制](#选择你的二进制)）。

> **只安装是不够的——你必须启动守护进程。**
> 配对的条件是**守护进程在运行**，而守护进程只在首次使用时懒加载启动。只有到那时扩展才会
> 检测到它并提供配对。

## 选择你的二进制

| 平台 | 二进制 |
| --- | --- |
| macOS（Apple Silicon） | `bin/excali-bridge-darwin-arm64` |
| macOS（Intel） | `bin/excali-bridge-darwin-amd64` |
| Linux（x86-64） | `bin/excali-bridge-linux-amd64` |
| Windows（x86-64） | `bin/excali-bridge-windows-amd64.exe` |

验证：`bin/excali-bridge-<你的平台> ping` → 打印 `"pong"`。面向人的启动方式就是告诉你的
智能体：**"使用 excali-local 技能：运行 excali-bridge ping"**——首次调用即启动守护进程
（懒加载）——也就是你的画布所连接的本地桥接（也可以自己运行 `excali-bridge serve`）。

## 从源码构建

预构建二进制已提交，通常你不需要构建。如需自行重新构建（在 excali-local 仓库中）：

```bash
pnpm bridge:build                 # 本机构建（开发）
pnpm skill:pack                   # 交叉编译 4 个平台二进制到 bin/ + 静态验证
tsx scripts/agent-bridge/driver-skill.ts   # 对源码技能的二进制做冒烟测试
pnpm skill:check                  # command-reference.md 与契约的漂移检查
```

`skill-pack` 会把二进制**就地**构建进 `bin/`（已提交的源码技能本身就是产物），并且只要任一
目标构建失败、`go vet` 不过或静态验证失败，就会大声报错。

## 版本

本技能跟踪 excali-local 的发布版本（当前 `1.7.4`）。

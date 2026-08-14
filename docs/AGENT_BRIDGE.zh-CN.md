# Agent Bridge 指南

[English](./AGENT_BRIDGE.md)

如何构建扩展、启用 Agent Bridge（智能体桥接）、把绘图技能加载进你的智能体，并对完整闭环做冒烟测试。（两级授权模型 —— 术语见 `CONTEXT.md`。）

---

## 第一部分 — 构建并加载扩展

按照 [`docs/BUILD_AND_RELEASE.md`](BUILD_AND_RELEASE.md)（`## Commands` 与 `## Build pipeline`）中的命令和流程构建编辑器 + 扩展并加载进浏览器：
`pnpm install` → `pnpm page:build` → `pnpm local:build`，然后把 `.output/chrome-mv3`
（Chromium）或 `.output/firefox-mv3/manifest.json`（Firefox）作为解压/临时附加组件加载。

打开编辑器：点击 Excali Local 工具栏图标 → 打开 **本地编辑器**（一个完整的编辑器标签页）。
这就是智能体将要驱动的画布。

---

## 第二部分 — 启用 Agent Bridge（授权门）

桥接**默认关闭**。最快的路径是在画布上做一次操作；Options 页面是一个保守的总开关。

1. **开启 + 配对 + 激活（从画布按钮）。** 在 **本地编辑器** 标签页中，点击右上角工具栏的
   **Agent** 按钮 → 确认 **"开启 Agent 控制？"**。这一次确认会同时打开主开关（第 0 层）
   **和**配对连接（门 1），并且——一旦本地桥接守护进程在运行——直接把当前画布激活（门 2）
   进入 **控制中** 状态。冷启动路径上不需要单独的配对或激活步骤。（快速编辑器从不激活。）
2. **启动桥接守护进程。** 浏览器无法启动本地进程，所以这一步在外部完成。两条等效路径——任选其一：
   - **方式 A —— 让智能体来启动（默认）。** 直接请你的智能体绘图。它的第一条命令（例如
     `excali-bridge ping`）会懒加载启动守护进程；画布在它应答的瞬间激活。
   - **方式 B —— 你自己启动。** 在终端运行 `excali-bridge serve`（二进制见第三部分），然后画布激活。
   - 如果你在守护进程启动之前就开启了开关，按钮会显示 **"等待桥接守护进程"**（琥珀色）——点击它
     可查看这两种启动方式。顺序无关紧要：在守护进程启动前还是后开启，最终都会到达相同的状态。

> **Options 页面（保守的总开关）。** **Options → "Agent control"** 主开关仍然存在，默认 OFF。
> 在那里把它打开会启用该功能，但*不会*自动配对或激活——请使用画布按钮。把它**关掉**会立即拆除
> 任何配对/激活。**弹出窗口**不显示智能体状态指示——守护进程状态显示在 **Options** 页面
> （守护进程停止指示条）。

> **每道门允许什么：** 只有配对连接（门 1）时，你的智能体可以做**全局**操作（图库列表/保存、
> 字体配置）——不需要画布。**画布绑定**操作（绘图、读取场景、导出、图库加载/保存）额外需要一个
> 已激活画布（门 2）。同一时间至多一个画布处于激活状态；激活另一个会**顶替**前一个。每画布的
> 授权弹窗在*热*路径上每画布询问一次（功能已开启，你在画布上点击激活）；冷启动的"开启"即算作
> 该次授权。

---

## 第三部分 — 构建技能并加载进你的智能体

智能体面对的界面是 **excali-local 技能**：一个 `SKILL.md` + `references/`，打包了静态、无依赖的守护进程二进制。

### 打包技能
```bash
pnpm skill:pack
# → skills/excali-local/bin/            （4 个平台二进制就地构建并提交）
```
`skill-pack` 交叉编译 4 个目标（`darwin-arm64`、`darwin-amd64`、`linux-amd64`、
`windows-amd64`；禁用 CGO、剥离符号），并在安装进技能前对每个目标做**静态验证**（无依赖）。
任一目标构建/vet 失败或非静态，打包会**快速失败**。

### 安装到你的智能体技能目录
技能与智能体无关（YAML frontmatter 的 `name`/`description`）。把组装好的文件夹复制到你的
智能体读取技能的地方：

| 智能体运行时 | 技能目录 |
| --- | --- |
| **pi** | `~/.pi/agent/skills/excali-local/` |
| **Claude Code** | `~/.claude/skills/excali-local/` |
| **Cursor** | `.cursor/skills/excali-local/`（项目）或 `~/.cursor/skills/` |
| **跨智能体标准** | `~/.agents/skills/excali-local/` |

```bash
# 示例：跨智能体 home
mkdir -p ~/.agents/skills
cp -r skills/excali-local ~/.agents/skills/
chmod +x ~/.agents/skills/excali-local/bin/excali-bridge-*
```

### 验证二进制能运行（这一步不需要扩展）
运行一次技能正是**启动守护进程**的动作——也就是画布所连接的桥接。
```bash
cd ~/.agents/skills/excali-local     # 或你安装它的任何位置
BIN=bin/excali-bridge-darwin-arm64  # Apple Silicon Mac；Intel 用 -darwin-amd64，
                                    # Linux 用 -linux-amd64，Windows 用 -windows-amd64.exe
chmod +x $BIN
$BIN ping                # → "pong"（首次使用时懒加载启动守护进程）
$BIN commands.list       # → 33 个方法的清单
```
如果 `ping` 返回 `"pong"`，守护进程 + CLI 就是健康的。（守护进程绑定 `127.0.0.1` 上
`[17331..17335]` 段的第一个空闲端口；无需配置、无需开放端口。）守护进程是机器级单实例桥接
（pidfile `~/.excali-local/bridge.pid`）；再次启动会复用已在运行的那个。画布开关在之前还是
之后打开都行——顺序无关紧要。

---

## 第四部分 — 对你的活动画布做完整闭环冒烟测试

扩展已加载（第一部分）、桥接已启用且画布已激活（第二部分）、技能已安装（第三部分）后，从技能文件夹运行：

```bash
BIN=bin/excali-bridge-darwin-arm64

$BIN scene.get                              # 读取已激活画布（JSON）
$BIN scene.exportPng '{"mimeType":"image/png"}'   # base64 PNG 快照 —— 保存并查看

# 画一个矩形，然后读回来：
$BIN elements.add '{"elements":[{"type":"rectangle","x":100,"y":100,"width":180,"height":90,"strokeColor":"#020817","backgroundColor":"#f1f5f9","strokeWidth":2,"roughness":0,"opacity":100}]}'
$BIN scene.get                              # 矩形现在在你的画布上了 ✓

# 全局操作（无需画布，仅需配对）：
$BIN gallery.list                           # 你的本地图库

# 字体：列出系统字体（守护进程本地），然后把一个分配到 "code" 槽位
$BIN fonts.system.list | head               # 系统已安装字体，来自守护进程
$BIN fonts.assign '{"slot":"code","postscriptName":"<列表中的一个 postscriptName>"}'
# → 返回 {config, requiresReload:true}：刷新编辑器页面后，该槽位生效
```

如果 `scene.get` 反映了你的 `elements.add`，完整的 **智能体 → 守护进程 → 页面 → 守护进程 → 智能体**
闭环就工作了。如果得到 `-32001`，说明你忘了激活画布（第二部分第 3 步）；`-32005` 表示某个
阻塞操作（图库删除、字体安装/清除）在确认弹窗上被拒绝了。

> **渲染→查看→修复循环：** 这是技能的核心工作流。"渲染" = 通过 CLI 发出元素；"查看" =
> `scene.exportPng`（保存 base64，打开 PNG）或 `scene.bounds`（能发现文字被裁剪/重叠）；
> "修复" = 调整坐标并重新发出。见 `skills/excali-local/references/workflows/draw-a-diagram.md`。

---

## 第五部分 — 需要注意的事项 / 已知限制

- **真实浏览器的渲染是你的 QA 车道。** e2e 驱动会 stub 掉 `window.excaliAPI`，所以它们证明的
  是*协议*闭环，而不是 Excalidraw 真的渲染了你的元素。请在实际标签页中目视确认绘图、破坏性操作
  toast、阻塞确认弹窗和顶替（displacement）UI。
- **技能的元素模板已经过往返验证**（针对打过补丁的 Excalidraw：
  `test/features/editor/lib/element-templates-roundtrip.test.ts`）。值得注意：`elements.add`
  **会重新生成 id**（你的 id 只是绑定提示）；文本默认 `fontSize 20`/`fontFamily 5`/左对齐/
  顶部对齐 —— **要显式指定**；`roughness` 默认为 **1**（想要干净的线条就设 `0`）。见
  `skills/excali-local/references/element-templates.md`。
- **字体需要刷新 + 设置 fontFamily。** `fonts.install`/`fonts.assign` 返回 `requiresReload:true`
  （字体在启动时注入一次）。刷新后，把画布 `appState.fontFamily`（1/2/3 = 手写/常规/代码）
  设为期望值即可看到变化。不支持不刷新热切换。
- **macOS 二进制链接 4 个 Apple 系统库**（libSystem、libresolv、CoreFoundation、Security）——
  这是 Go ≥1.24 无 cgo 的 x509 行为，不是 bug；无需安装任何东西。
- **`internal/ws` 中的 `TestCloseHandshake` 在重度并发负载下可能偶发失败**——单独运行时能通过；
  除非单独跑也失败，否则忽略。

---

## 快速参考

日常构建/测试命令清单（`page:*`、`local:*`、`bridge:*`、`skill:*`），见
[`AGENTS.md`](../AGENTS.md)（"Daily commands"）和 [`docs/BUILD_AND_RELEASE.md`](BUILD_AND_RELEASE.md)
（`## Commands`）。其中未覆盖、与 agent bridge 相关的部分：

```bash
tsx scripts/agent-bridge/driver-skill.ts   # 对源码技能二进制做冒烟测试
# 任意 driver 之后的清理：
pkill -f 'excali-bridge serve'; pkill -f 'bin/excali-bridge'; rm -f ~/.excali-local/bridge.pid
```

智能体面对的契约是 `skills/excali-local/SKILL.md` + `references/`；更深层的上下文见
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md)。

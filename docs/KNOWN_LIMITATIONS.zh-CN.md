# 已知限制（Known Limitations）

[English](./KNOWN_LIMITATIONS.md)

记录扩展无法用代码修复的平台/上游约束。每一条都说明限制是什么、为什么存在、代码对此做了什么。
当某条限制解除时（例如某个 Chrome 里程碑默认启用了一个功能），请更新本文件。

## 默认 Chrome ≤156 上 chrome-extension:// 页面中的 WebMCP 被阻止

**状态**：上游平台限制——本仓库无法修复（在未带 dev flags 的正式版/默认 Chrome 上对用户可见）。

**现象**：在**默认（未加 flag）Chrome ≤156** 上，WebMCP（`document.modelContext`
命令式 API——扩展 "WebMCP" 主动控制路线的基础，Wayfinder 043/044）在 `chrome-extension://`
页面中存在但**不可用**：调用 `registerTool` / `getTools` 会抛出

```
SecurityError: document.modelContext cannot be used when document.domain is enabled.
```

Chrome 把扩展源当作启用了 `document.domain` 的源，而 WebMCP 实现拒绝之。普通网页
（`https://…`、`http://localhost`——测试中用 `example.com` 验证过）可以正常注册。

**注意——该阻止与 flag 有关，不是绝对的**（E2E 复核发现）：使用 WebMCP **测试 flags**
（`--enable-features=WebMCPTesting,WebMCP,DevToolsWebMCPSupport`，仓库的 `.mcp.json`
正是这样传给 chrome-devtools-mcp 启动的 Chrome 的）时，扩展源上的阻止被**解除**：
`getTools()` 和 `registerTool()` 在 `chrome-extension://` 页面上可以工作。所以限制恰好是：
*默认/正式版 Chrome ≤156 且没有这些 flags*。这正是扩展要做诚实检测的场景——普通用户的浏览器
不可能有这些 flags，所以对他们 WebMCP 路线会正确地置灰；带 flags 的 dev/test 浏览器则会
正确地亮起。

扩展源支持在上游被标记为 "ongoing development"；Chrome 157 是 WebMCP 默认启用的里程碑，
它是否解除对扩展页面的这个阻止从这里无法验证。

**在实践中意味着什么**：

- 在**默认 Chrome ≤156** 上：只有在 API 实际可用后，Options 页面才能切换到 WebMCP 路线——
  见下面的诚实检测。实际上该区段会保持置灰（**"Requires Chrome with WebMCP enabled"**，
  即"需要启用 WebMCP 的 Chrome"），直到 Chrome 157（或带 flags 的 dev 浏览器）。
- 在**带 flags 的 dev 浏览器**上：完整的 WebMCP 流程（切换路线 → Register → AI 调用
  `excali_canvas` 工具 → Unregister）可以在扩展页面本身上测试。
- 两种情况下 ws + daemon 路线都不受影响。

**代码做了什么**（E2E 发现 → 加固的特性检测）：

- 存在不等于可用：`'modelContext' in document` 在扩展页面上为 `true`，尽管该 API 在那里会抛错。
  `packages/shared/src/agent-bridge.ts` 中的 `isWebmcpUsable()` 会探测一次 API——抛错的调用
  （上面的 SecurityError）会把该特性报告为**不可用**。
- Options 页面使用该探测：在被阻止的源上 WebMCP 区段置灰（"Requires Chrome with WebMCP
  enabled"），而不是亮起后点击失败。
- 页面的 `registerWebmcp` 也会先探测并在不尝试的情况下返回 `false`，所以按钮的失败路径是诚实的
  toast（"无法暴露此画布。请重试，或切换到 ws + daemon。"），而不是裸的 SecurityError。

**何时重新验证**：Chrome 157+ 成为默认渠道时——检查扩展页面能否在无 flags 的情况下调用
`document.modelContext.registerTool`；如果能，去掉探测在抛错时的 catch-all `return false`
（或保留它——web 源上真实的 SecurityError 仍然是需要暴露的回归）。

## 实时协作（1.8.0）

协作功能的设计与平台限制（[COLLAB.zh-CN.md](COLLAB.zh-CN.md)、
[ADR 0003](adr/0003-byo-relay-realtime-collab.md)）。每一条都说明限制是什么、
为什么存在、代码对此做了什么。

### 单文件 20MB 上限，不支持断点续传

**现象**：协作房间中同步的文件（图片、附件）**每文件上限 20MB**，上传不可断点续传——
中断的上传需要重来。

**原因**：中继把每条消息分块到 DO 256KB 上限以下（20MB / 200KB = 每文件 100 块），
且 v1 有意不携带断点续传机制。

**代码做了什么**：file-put 路径在客户端拒绝超限文件并给出明确错误；上限以下的
一切照常工作。

### 每个扩展一个中继

**现象**：扩展同一时刻只连接一个中继——永久如此。接受服务器邀请即替换已存配置，
不存在多中继列表。

**原因**：多中继支持在 ADR 0003 中被永久否决（设计排除项，不是延后）——它消除了
房间邀请所依赖的路由歧义。

**代码做了什么**：服务器邀请解析器和选项页协作区强制执行单配置不变式；房间邀请
从不携带服务器地址。

### 无逐成员吊销

**现象**：成员密钥泄露后无法单独吊销；驱逐走组织级路径——轮换组织密钥、重新签发
服务器邀请、让受影响成员重装。

**原因**：按 ADR 0003 身份自声明（无 PKI）；迷你 CA 被明确否决。

**代码做了什么**：旧成员密钥签署的已存内容仍可通过自包含的 `signer` 字段验证，
轮换不会破坏历史。

### 中继无速率限制（v1）

**现象**：中继参考实现不对流量做速率限制或节流。

**原因**：v1 面向组织私有的小团队部署，运营者信任成员；带宽滥用不在 v1 威胁模型内。

**代码做了什么**：记录在案的行为——中继不适用于公开/多租户运营。

### 非 Cloudflare 的自托管中继延后（等待 celld WebCrypto）

**现象**：中继的非 Cloudflare 自托管路径暂停。首选目标
——[celld](https://github.com/denoland/celld)（原生读 wrangler 配置、跑 partyserver DO、
支持 hibernatable WebSocket）——其内嵌 V8 缺少 WebCrypto Ed25519 密钥导入，
导致中继的 org 签名准入拒绝所有连接。

**原因**：2026-08 试点实测：整条链路（`celld deploy`、SQLite cells、vars、WS 升级）
都正常，唯独 `crypto.subtle.importKey("raw", …, {name:"Ed25519"})` 失败。中继的
准入与逐帧验签按设计就是 Ed25519 系的（ADR 0003）。

**代码做了什么**：中继当前以 Cloudflare 为目标（`wrangler deploy`）；COLLAB.md 已把
自托管标记为暂停、等待 celld 的加密支持。若自托管提前成为发布要求，兜底方案是自行运行
**workerd**（完整运行时；需 capnp 配置翻译、单节点、TLS 走反向代理），或给
`collab-core` 加纯 JS Ed25519 验签补丁作为应急。

### v1 实际为单 org：房间不绑定组织

**现象**：多 org 是计划中的设计，但 v1 实际只有单 org——开发循环只注册一个组织
（`local`），每个客户端只持有一份服务器配置（一个 org 标签），且房间从不绑定组织。
任何被准入到中继的成员，只要拿到某房间的 shareId 就能连进去；org 只决定客户端能
*解密*什么（团队房间：本 org 的 `ck`），而不是能*到达*哪些房间。

**原因**：org 标签和 `ORG_PUBKEYS` 环境变量结构是刻意的向前兼容——数组现在
就接受多个条目，将来多 org 部署无需破坏性变更；按组织隔离房间需要 v1 刻意没有的
org→room 绑定。

**代码做了什么**：`ORG_PUBKEYS` 接受 org 数组；准入用 hello 的 org 签名对该组织
注册的每个密钥逐一验签；没有任何代码比较 hello 的 org 与房间的归属。组织间房间级
隔离是将来的工作，不是 v1 的属性。

### 空房间即消亡

**现象**：房间为空且 Durable Object 被驱逐（约 70–140 秒无活动）时，房间的快照和
文件被删除。任何用户可见的东西都不会在服务器端持久化。

**原因**：按设计——房间是临时叠加层，本地图库才是持久记录（ADR 0003）。

**代码做了什么**：房间列表在本地保存邀请载荷；重进已死房间时提示第一个成员从图库
重新播种。

### 激光笔同步不在 v1

**现象**：`tool: "laser"` 指针模式不会同步给协作者。

**原因**：ADR 0003 后果清单——激光同步是 1.9 候选。

**代码做了什么**：激光笔迹仅限本地；指针消息类型已携带 tool 字段，线路协议本身
已支持它。

### 房间名对中继为明文（尚未端到端加密）

**现象**：房间共享名（ADR 0004）走**未加密**的 `room-name` 与 `room-probe` 消息，因此中继可以看到它——与今天已提交的明文线路下中继可读场景载荷完全一致。

**原因**：058 的签名加密信封（届时 `room-name` 与探测的 `roomName` 必须装入其中）是将来的工作。在那之前，房间名与场景一样对中继可见；并**没有引入新的泄露类别**。此外，探测会向任何持邀请者返回 `{roomName, snapshotAvailable, peerCount}`——但这也正是他们加入后就会了解到的信息，因此并未增加泄露面。

**代码做了什么**：房间探测门控（ADR 0005）保证了"此房间是空的"提示始终真实；房间名是随房间一起消亡的短生命周期房间内容。

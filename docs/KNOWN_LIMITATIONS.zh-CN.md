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

### 空房间即消亡

**现象**：房间为空且 Durable Object 被驱逐（约 70–140 秒无活动）时，房间的快照和
文件被删除。任何用户可见的东西都不会在服务器端持久化。

**原因**：按设计——房间是临时叠加层，本地图库才是持久记录（ADR 0003）。

**代码做了什么**：房间列表在本地保存邀请载荷；重进已死房间时提示第一个成员从图库
重新播种。

### 演示模式 × 协作延后

**现象**：1.8.0 中演示模式与协作房间互不联动（跟随协作者 / 全房间演示超出范围）。

**原因**：2026-08-16 人工决策——等协作模型在实际使用中成熟后再议。

**代码做了什么**：两种模式是独立的编辑器形态；从协作会话保存的绘图照常可以演示。

### 激光笔同步不在 v1

**现象**：`tool: "laser"` 指针模式不会同步给协作者。

**原因**：ADR 0003 后果清单——激光同步是 1.9 候选。

**代码做了什么**：激光笔迹仅限本地；指针消息类型已携带 tool 字段，线路协议本身
已支持它。

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

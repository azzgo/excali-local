# Peering — 测试与验收指南

> 设计：[ADR 0012](adr/0012-bridge-daemon-is-the-product-presence-is-its-face.md)、
> [ADR 0013](adr/0013-cross-machine-canvas-transfer.md)。实现说明：[PEERING.md](PEERING.md)。
>
> 本文档面向"要验证这次改动的人"。分三部分：**A 自动化验证**（应全绿）、
> **B 手动局域网实测**（需要两台机器，即真实 E2E）、**C 已知边界**（不要当 bug 报）。

---

## A. 自动化验证

### A1. Go 单元与集成测试

```bash
cd packages/bridge
CGO_ENABLED=0 go build ./... && CGO_ENABLED=0 go vet ./...
CGO_ENABLED=0 go test -count=1 ./...
```

预期：

```text
ok  internal/config      ok  internal/lan        ok  internal/paths
ok  internal/contract    ok  internal/peering    ok  internal/pidfile
ok  internal/server      ok  internal/transfer   ok  internal/ws
FAIL internal/fonts  ← 既有失败，与本次改动无关（见 C3）
```

### A2. 竞态检测（重要）

这次顺手修了 `internal/server` 与 `internal/ws` 里 **既有** 的并发缺陷（干净 HEAD 上
`-race` 必失败）。请确认修好：

```bash
cd packages/bridge
CGO_ENABLED=0 go test -race -count=5 ./internal/server/...
```

预期：`ok`，约 110 秒。**任何 race 报告都视为失败。**

### A3. 契约零漂移

```bash
pnpm skill:check
```

预期：前三项 `✓`，第四项 **故意失败**——

```text
✗ binaries found under skills/excali-local/bin/
```

这是 ADR 0012 新加的门禁在起作用：那 4 个二进制还在 git 里。要完成迁移需执行：

```bash
git rm --cached skills/excali-local/bin/*
```

在此之前，该失败是**预期行为**，不是回归。

### A4. 发布产物出仓库

```bash
pnpm skill:pack
```

预期：4 个目标全部通过（build / vet / 静态链接校验），产物落在
`$TMPDIR/excali-skill-dist/`，**仓库内不新增任何文件**，并打印每个二进制的 sha256
与 `checksums.txt`。

---

## B. 手动局域网实测（真实 E2E）

### B0. 前提

- 两台机器在同一网段，能互相 ping 通（**不需要**组播，见 C1）
- 两边都构建或安装了 `excali-bridge`
- 扩展已加载，编辑器中有一个可用画布

### B1. 接收方：开启局域网监听

```bash
excali-bridge lan on      # 持久化开关
excali-bridge serve       # 启动 daemon；日志会打印 LAN 监听端口
```

> ⚠️ **`lan on` 只写配置，不动态起 listener。** 如果 daemon 已经在跑，必须先
> 重启它，否则 `/health` 里 `lanPort` 会是 `0`（配置写了、端口没开）。这是刻意
> 的取舍：运行期动态起停会与 Shutdown 生命周期打架。
>
> ```bash
> pkill -f "excali-bridge serve"; sleep 1
> excali-bridge serve
> ```
> 

日志中出现：

```text
[bridge] listening on 0.0.0.0:<port> (LAN listener, Canvas transfer only)
[bridge] LAN listener on 0.0.0.0:<port> (Canvas transfer only)
```

记下 `<port>`。核对状态：

```bash
excali-bridge lan.status
# { "lan": "on", "lanPort": <port>, "peers": 0, "peerAddresses": [] }
```

也可直接读 `/health`：

```bash
curl -s http://127.0.0.1:17331/health | grep -E '"lan"|"lanPort"'
```

### B2. 发送方：确认能看到这台机器

```bash
excali-bridge lan.status     # 应为 off/unset —— 发送方不需要开 LAN 监听
```

发送方只需能**拨出去**。手工地址即接收方的 `IP:port`（B1 里记下的那个）。

### B3. 传输

当前可用的入口是 daemon 侧的 `peers.transferOffer`。在发送方：

```bash
excali-bridge peers.list     # 目前是手工添加的对端列表（见 C1）
excali-bridge peers.transferOffer '{"address":"<ip>:<port>"}'
```

接收方应在**扩展页面上**看到 offer 确认浮层（右上角通知中心，非 modal、
非 banner），带**倒计时**——倒计时读的是协议里的 `expiresAt`，由 daemon 给出。

### B4. 期望结果

> ⚠️ **当前能测到哪里（2026-10 实测）。** 后端链路已完整验证：Mac 读取 5.4MB
> 场景 → 拨号对端 → 投递 offer → 对端解码并作答。唯一缺的是**接收端的人工确认
> UI**（`peering.Decider` 还没有扩展页面实现），所以接受动作无法完成。
>
> 因此现在跑到最后会看到：
>
> ```text
> rpc error -32011: peering: the peer rejected the offer: no decider is wired
> ```
>
> 这**不是传输失败**，而是接收端还没有问「要不要接受」的那个界面。看到这一行
> 说明 transport、offer 编码、跨机连通性全部正常。

| 场景 | 期望 |
| --- | --- |
| 接收方接受 | 画布替换为发送方的场景；元素数、尺寸与发送方一致 |
| 接收方拒绝 | 发送方收到明确的 reject；**发送方画布不受影响** |
| 60 秒无人应答 | 发送方超时失败；接收方不留任何内容（见 C4） |
| 接收方没有扩展页面 | 同上，超时失败——不会排队 |
| 场景超过 64MB | 在 prepare 阶段就被拒，不传输任何字节 |

### B5. 失败排查

```text
连不上
  ├─ 接收方 lan.status 是 off/unset？     → excali-bridge lan on 后需重启 daemon
  ├─ 端口不对？                            → 以 lan.status 的 lanPort 为准，不要猜
  ├─ 防火墙拦了？                          → 两台机器上放行该端口
  └─ 不同网段？                            → 局域网传输要求 IP 直达

连上但没弹确认
  ├─ 接收方扩展页面没开？                  → 开一个编辑器页面
  └─ 页面开着但没反应？                    → 看 daemon 日志有没有 offer 到达

超时
  └─ 60 秒内没人点接受                     → 这是设计行为（C4），不是 bug
```

---

## C. 已知边界（不要当 bug 报）

### C1. 任何平台都没有自动发现

**这是决定，不是缺陷。** 对端靠**手工交换地址**，没有 mDNS 弹窗列表。

原因：macOS 上 `mDNSResponder` 独占 5353 且只把组播投给第一个套接字，用户态库收不到
包；通行绕法违反 RFC 6762 §11 会被合规对端丢弃。做对需要为 macOS 绑 Bonjour cgo、
为 Linux 绑 Avahi——而且一半真实网络（访客 Wi-Fi 客户端隔离、企业 VLAN）本来就把组播
拦死。详见 [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)。

**手输地址在那些网络里反而能用**，所以它不是降级路径。

### C2. 传输是明文，同网段可观察、可伪造

无认证、无加密。唯一的门是接收方的人工确认。offer 只带描述信息（别名、指纹、元素数、
字节数、画布名、截止时间），**不含任何画布内容，也不含缩略图**——字节只在接受后才离开
发送方。

Device fingerprint **只用于识别，不用于认证**。见 ADR 0013 决定 4。

### C3. `internal/fonts` 的测试失败是既有的

```text
--- FAIL: TestParseNameTableWOFF   fonts_test.go:186
    ParseNameTable(woff): no parseable name table
```

`git diff` 显示该目录零改动，与本次工作无关。

### C4. offer 过期即失败，不排队

60 秒无人接受就失败，daemon **不在接受前存储任何画布内容**。这是刻意的：一个对局域网
开放的端口同时累积无主内容，比一次失败的传输更糟。

### C5. 局域网监听默认关闭，重启后恢复关闭

除非显式 `lan on` 持久化。运行期 `lan.on/off` 只写配置并返回
`takesEffectOnRestart: true`——**不会**动态起停 listener（避免与 Shutdown 生命周期打架）。

### C6. `autostart` 只有检测

`autostart.status` 能报告登录项状态；`autostart.on/off` 返回"未实现"。写入职责待定
（ADR 0012 决定 2：daemon 拥有登录项，托盘只是调用方），且要避免出现两条登录项。

---

## D. 本次实现的具体范围

```text
新增
  packages/bridge/internal/paths      平台目录解析 + 旧位置一次性迁移
  packages/bridge/internal/config     LAN 开关（三态）/ 别名 / 设备指纹
  packages/bridge/internal/lan        LAN listener（第二个监听面，仅 transfer）
  packages/bridge/internal/transfer   三段式状态机 + 200KB 分片 + 整场景 sha256
  packages/bridge/internal/peering    LAN ← transfer 接线（Decider/Deliverer 注入点）
  packages/bridge/internal/autostart  登录项检测（只读）
  packages/bridge/cli_peering.go      lan / peers / autostart 子命令

修改
  internal/server/server.go           按 config.lan 启动 LAN 面；新增 daemon-local RPC；
                                      /health 与 bridge.status 加 lan/lanPort 字段
  internal/ws/ws.go                   closeSent 改为 atomic.Bool + CAS（修既有竞态）
  internal/pidfile/pidfile.go         状态目录迁移（读旧位置一次，避免双 daemon）
  internal/contract/contract.go       Peering/LAN/autostart 方法集、常量、错误码
  main.go                             子命令分发接上新方法
  packages/shared/src/agent-bridge.ts 契约真源（含 TransferOffer.expiresAt）
```

**尚未实现**（后续）：扩展页面的通知中心浮层（`Decider` 的 UI 侧）、
Presence host（系统托盘）、`autostart` 写入、以及容器化双机 e2e 脚本。

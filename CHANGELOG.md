# 更新日志

## 2.1.0 — DSH 0.2 兼容

修复 2.0.0 在 DSH 0.2 下**完全不加载**的问题。

- **peerDependencies 版本门禁**：`@deepseek-ai/dsh-client-ui-slots` / `@deepseek-ai/dsh-tools` 由 `^0.1.0-rc.6` 改为 `^0.2.0-rc.2`，并补上 `engines.dsh`。DSH 0.2 的 `dsh-app-boot` 会校验插件所有 `@deepseek-ai/dsh*` peer，任一条不满足即静默跳过整个 bundle。
- **`shell.run()` 已被移除**：0.2 的 `ShellExecutor` 只有 `resolve()` + `execute()`。完成音改为直接 `spawn` 子进程（不经 shell 缝，避免被会话沙箱降级），并从 `inject` 移除 `shell`。
- **`agent/request-error` 是 waterfall 事件**：旧监听器不调用 `next()`，会否决内置行为与后续监听器（含重试策略）。现在监听后原样放行。
- Windows 完成音改用 `assets/voice.wav` + `System.Media.SoundPlayer`（winmm），不再依赖 WPF `MediaPlayer` / Media Foundation；WAV 缺失时退回 MP3 + MediaPlayer。
- 素材读取由 Harness `fs` 服务改为 `node:fs`：素材属于插件包自身，不受会话 workspace 沙箱管辖；`inject` 相应移除 `fs`。
- `dsh.client.inject` 中已下线的 `@deepseek-ai/dsh-client-runtime` 换成真实存在的 `@deepseek-ai/dsh-client-ui-renderer`。
- `tsdown.config.ts` 的客户端 external 列表改为对齐 0.2 web shell 的真实模块表（react / react-dom / cordis / dsh-client-store / dsh-client-ui-slots / dsh-client-ui-primitives / dsh-client-ui-dockkit）。
- 校验脚本新增回归护栏：DSH peer 范围必须面向 0.2、源码不得再用 `shell.run()`、waterfall 必须放行 `next()`、`voice.wav` 必须是 PCM、构建产物不得残留 `dsh-client-runtime`。
- README 重写：补上 0.2 适配说明、三种本地安装方式、旧安装修复、以及把新代码推到 GitHub 的完整流程。

## 2.0.0 — DSH 静态 Bundle

- 从会话级 `cordis_define` 动态插件迁移为可安装到 profile 的静态 bundle。
- 在根 `package.json` 声明 `dsh.bundle.patch` 和 `dsh.client`，并新增 `cordis.patch.yml`。
- Host 与 Client 分别构建为 `plugin/lib/index.js`、`plugin/lib/client.js`；发布时提交构建产物，支持 GitHub 直接安装。
- 素材改为相对包路径，不再依赖开发者电脑上的绝对路径。
- 修复当前 DSH 中 `agent/request-error` 的广播事件签名，并直接监听 `agent/status`，保留轮询作为兼容兜底。
- 修复多 Agent 状态快照、失败动画被轮询立即覆盖、已释放 Agent 状态残留等问题。
- Windows 完成音改用支持 MP3 的 WPF `MediaPlayer`；macOS 使用 `afplay`，Linux 使用 `ffplay`。
- 新增 bundle 结构校验、发布内容检查和 GitHub Actions CI。

## 1.x — 动态插件历史

### v5（系统级完成音）

- 由 DSH Host 调用系统命令播放完成音。
- 任意 Agent 干净结束回合且没有其他 Agent 运行或等待输入时触发庆祝。
- 庆祝期间防止重复发声。

### v4（轮询驱动状态机）

- 以 `agents` 服务轮询作为动态插件环境下的可靠状态来源。
- `worked` / `errored` 标记改为按 Agent 归属。

### v3（事件探针）

- 使用 `internal/dispatch` 探针定位动态插件环境中的事件总线隔离。

### v2（按 Agent 归属工作标记）

- 修复跨 Agent 共享工作标记以及运行状态切换导致标记丢失的问题。
- 新增 `kun_pet_debug`。

### v1（首个可用版本）

- 移植 8 × 9 精灵图素材。
- 实现 Host 状态机、素材路由和 Client overlay。

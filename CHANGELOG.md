# 更新日志

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

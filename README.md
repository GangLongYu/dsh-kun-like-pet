# 🐤 Kun Like 桌宠（DSH 静态 Bundle）

- 原项目：[liyupi/dsh-kun-like-pet](https://github.com/liyupi/dsh-kun-like-pet)

> 一只住在 DeepSeek Harness Web 界面右下角的小坤宠。它会根据 Agent 状态工作、思考、等待、庆祝或难过，并在任务完成时播放「你干嘛~哎哟」。

![Kun Like 桌宠 · 工作中](docs/screenshot-working.png)

![Kun Like 桌宠 · 挥手](docs/screenshot-wave.png)

当前 `2.0.0` 已从会话级 `cordis_define` 动态插件改写为 **DSH profile 静态 bundle**。插件安装到 `web` profile 后由 DSH 启动时自动装配，不再依赖个人电脑的绝对素材路径。

## 功能

- 9 种精灵动画，沿用 8 列 × 9 行、每格 192 × 208 的素材契约。
- 监听 `agent/status`，并以 `agents.list()` 轮询兜底，感知运行和完成状态。
- 结合 `tools/execute`、`approval/request`、`agent/request-error` 显示工作、等待和失败状态。
- 任务完成时由 Host 播放系统提示音；Windows、macOS、Linux 均有对应实现。
- 可以拖动桌宠；点击会挥手并播放互动语音。
- 提供 `kun_pet_debug` 工具以及 `/kun-pet/state` 调试接口。

| Agent 状态 | 桌宠动作 | 气泡文案 |
| --- | --- | --- |
| 工具执行中 | 专注干活 | 努力工作中… |
| 回合运行但没有工具执行 | 思考 | 思考中… |
| 等待回复或审批 | 期待 | 在等你回复哦~ |
| 请求出错 | 难过 | 呜…出错了 (._.) |
| 回合完成 | 挥手/跳跃并播放提示音 | 完成啦！你干嘛~哎哟 |
| 空闲 | 呼吸待机 | 休息中~ 有事叫我 |

## 环境要求

- Node.js `22.19` 或更高版本。
- DeepSeek Harness `0.1.0-rc.6`。DSH 仍处于开发预览阶段，升级后若 API 有破坏性变化，请先运行本仓库测试。
- Linux 的系统完成音依赖可用的 `ffplay`；Windows 使用 WPF `MediaPlayer`，macOS 使用 `afplay`。

## 安装

### 从 GitHub 安装

```bash
npx @deepseek-ai/dsh plugin --profile web add github:GangLongYu/dsh-kun-like-pet
npx @deepseek-ai/dsh web
```

`plugin/lib/` 已提交到仓库，因此 GitHub 安装无需在 DSH 安装阶段现场构建。

### 本地开发安装

```bash
git clone https://github.com/GangLongYu/dsh-kun-like-pet.git
cd dsh-kun-like-pet
npm ci
npm run build
npm test
npx @deepseek-ai/dsh plugin --profile web add .
npx @deepseek-ai/dsh web
```

打开终端输出中的 Web 地址，桌宠应显示在右下角。Host 自检接口：

```text
http://127.0.0.1:3080/kun-pet/state
http://127.0.0.1:3080/kun-pet/spritesheet.webp
http://127.0.0.1:3080/kun-pet/voice.mp3
```

如果 3080 已占用，DSH 会使用其他端口，请以启动日志为准。

## 修复旧的损坏安装

旧版转换曾使用 `@dsh-external/dsh-kun-like-pet`，但包中没有 `dsh.bundle`，启动时会出现：

```text
profile bundle "@dsh-external/dsh-kun-like-pet" declares no dsh.bundle in its package.json
```

移除旧依赖，再安装本仓库根目录：

```bash
npx @deepseek-ai/dsh plugin --profile web remove @dsh-external/dsh-kun-like-pet
npx @deepseek-ai/dsh plugin --profile web add .
npx @deepseek-ai/dsh web
```

这只会替换损坏的桌宠依赖，不会删除 profile 中的其他插件。

## 开发与验证

```bash
npm run build       # plugin/src → plugin/lib
npm test            # 素材、源码、bundle 清单和构建产物校验
npm run pack:check  # 检查 npm/GitHub 发布包内容
```

修改 `plugin/src/` 后必须重新执行 `npm run build`，并把更新后的 `plugin/lib/` 一并提交。独立动画预览可直接运行 `demo/index.html`。

## 架构

```text
DSH web profile
  └─ cordis.patch.yml
      └─ plugin/lib/index.js (Host)
          ├─ agent/tool/approval 事件 + agents 轮询
          ├─ /kun-pet/state 与素材路由
          ├─ 系统完成音
          └─ kun_pet_debug

Web modules service
  └─ plugin/lib/client.js (Client)
      └─ shell.overlay → React 桌宠、拖动和点击互动
```

主要目录：

```text
├─ cordis.patch.yml             # profile 安装补丁
├─ package.json                 # dsh.bundle / dsh.client 声明
├─ plugin/
│  ├─ src/index.ts              # Host 源码
│  ├─ src/client/index.ts       # Client 源码
│  ├─ lib/                      # 已构建并提交的发布产物
│  └─ tsdown.config.ts          # Host/Client 构建配置
├─ assets/                      # 精灵图和语音
├─ demo/                        # 无 DSH 的动画预览
├─ docs/                        # 素材契约与截图
├─ scripts/                     # 完整性和 bundle 校验
└─ src/、kunpet.package.json    # 1.x 动态插件历史参考，不参与静态安装
```

## 上传 GitHub 前检查

```bash
npm ci
npm run build
npm test
npm run pack:check
git status --short
```

确认 `plugin/lib/` 与源码同步，且没有提交 `.tmp/`、`node_modules/` 或生成的 `.tgz`。然后创建自己的仓库并推送；若不是 GitHub Fork，请把 `package.json` 的 `repository.url` 改成你的仓库地址。

## 素材与许可

- 代码使用 [MIT License](LICENSE)。原项目：[liyupi/dsh-kun-like-pet](https://github.com/liyupi/dsh-kun-like-pet)。
- `assets/voice.mp3` 是网络二创梗语音片段，`assets/spritesheet.webp` 是粉丝二创像素形象，仅供个人学习交流；素材不随 MIT 代码许可自动获得商业使用授权。
- 若你是权利人且不希望相关内容被展示，请联系仓库维护者删除。

## 感想
Vibe coding时代，想要什么自己写。一开始是让dsh改，后面把自己改崩了，codex抢救一下。
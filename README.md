# 🐤 Kun Like 桌宠（DSH 静态 Bundle）

- 原项目：[liyupi/dsh-kun-like-pet](https://github.com/liyupi/dsh-kun-like-pet)

> 一只住在 DeepSeek Harness Web 界面右下角的小坤宠。它会根据 Agent 状态工作、思考、等待、庆祝或难过，并在任务完成时播放「你干嘛~哎哟」。

![Kun Like 桌宠 · 工作中](docs/screenshot-working.png)

![Kun Like 桌宠 · 挥手](docs/screenshot-wave.png)

当前 `2.1.0` 是 **DSH 0.2 兼容版**：仍是安装到 profile 的静态 bundle（Host + Client 两半），但已修掉 0.2 的两处破坏性变更，详见 [DSH 0.2 适配](#dsh-02-适配要点)。

## 功能

- 9 种精灵动画，沿用 8 列 × 9 行、每格 192 × 208 的素材契约。
- 监听 `agent/status`，并以 `agents.list()` 轮询兜底，感知运行和完成状态。
- 结合 `tools/execute`、`approval/request`、`agent/request-error` 显示工作、等待和失败状态。
- 任务完成时由 Host 播放系统提示音；Windows 用 `System.Media.SoundPlayer`，macOS 用 `afplay`，Linux 用 `ffplay`。
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

## DSH 0.2 适配要点

2.0.0 在 DSH 0.2 上**完全不会加载**，DSH 启动时会跳过整个 bundle：

```text
dsh: skipping profile bundle "dsh-kun-like-pet": Error: Plugin dsh-kun-like-pet@2.0.0 is
incompatible with dsh 0.2.0-rc.2: peerDependencies {"@deepseek-ai/dsh-client-ui-slots":"^0.1.0-rc.6",
"@deepseek-ai/dsh-tools":"^0.1.0-rc.6"}.
```

三处修改：

1. **peerDependencies 版本门禁**（这就是「不生效」的直接原因）。DSH 0.2 起 `dsh-app-boot` 会校验插件里所有 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 的 peerDependencies，只要有一条不满足当前 DSH 版本，整个 bundle 会被跳过且**不报错到界面**。现已改为 `^0.2.0-rc.2`，并补上 `engines.dsh`。
2. **`shell.run()` 已不存在**。0.2 的 `ShellExecutor` 只有 `resolve()` + `execute()`，而且解析结果会带上执行器的默认沙箱策略。桌宠完成音只是一次性界面反馈，不需要工作目录/超时/沙箱语义（Windows 沙箱在只读模式下会把 PowerShell 降级为 ConstrainedLanguage），因此改为直接 `spawn` 子进程，并从 `inject` 里去掉 `shell`。
3. **`agent/request-error` 是 waterfall 事件**。旧代码的监听器不调用 `next()`，按 cordis 语义会**否决**内置行为与后续监听器（例如重试策略）。现在监听后原样放行。

另外三处顺手修掉的隐患：

- Windows 完成音改用 **WAV + `System.Media.SoundPlayer`（winmm）**，不再依赖 WPF `MediaPlayer` / Media Foundation；缺少 WAV 时才退回 MP3 + MediaPlayer。
- 素材读取从 Harness 的 `fs` 服务改为 `node:fs`：素材属于插件包自身，不该受会话 workspace 沙箱管辖（同时少一个 inject 依赖）。
- `dsh.client.inject` 里已下线的 `@deepseek-ai/dsh-client-runtime` 换成真实存在的 `@deepseek-ai/dsh-client-ui-renderer`（`ctx.slots` 服务的提供者）。

## 环境要求

- Node.js `22.19` 或更高版本。
- DeepSeek Harness `0.2.x`（`engines.dsh: ^0.2.0-rc.2`）。DSH 仍处于开发预览阶段，升级到 0.3 后如 API 再次破坏性变更，请先运行本仓库测试。
- Linux 的宿主完成音依赖可用的 `ffplay`；Windows 用 `System.Media.SoundPlayer`，macOS 用 `afplay`。

## 安装

三种方式，选一种即可。装完都要**重启 DSH**（Web 页面刷新不够）。

### 方式 A：从 GitHub 安装（推荐给只是要用的人）

```bash
npx @deepseek-ai/dsh plugin --profile web add github:GangLongYu/dsh-kun-like-pet
npx @deepseek-ai/dsh web
```

`plugin/lib/` 是已提交的构建产物，所以 GitHub 安装不需要在 DSH 安装阶段现场编译。

### 方式 B：从本地目录安装（推荐给自己改了代码的人）

```bash
git clone https://github.com/GangLongYu/dsh-kun-like-pet.git
cd dsh-kun-like-pet
npm install
npm run build
npm test
npx @deepseek-ai/dsh plugin --profile web add .
npx @deepseek-ai/dsh web
```

`add .` 会在 profile 里写一条 `link:` 依赖指向这个目录。之后改动 `plugin/src/` → `npm run build` → 重启 DSH 就能看到新代码，不用重新 `add`。

### 方式 C：从已下载的本地路径安装

```bash
npx @deepseek-ai/dsh plugin --profile web add C:\Users\dragon\Desktop\dsh-kun-like-pet
npx @deepseek-ai/dsh web
```

## 从旧版升级 / 修复被门禁跳过的旧安装

如果 profile 里装的是 `2.0.0`（它会被 0.2 静默跳过），先移除再装新版：

```bash
npx @deepseek-ai/dsh plugin --profile web remove dsh-kun-like-pet
npx @deepseek-ai/dsh plugin --profile web add github:GangLongYu/dsh-kun-like-pet
npx @deepseek-ai/dsh web
```

判断 profile 里到底装的是哪一版：

```bash
npx @deepseek-ai/dsh --profile web --dump-config
```

只要输出里出现 `skipping profile bundle "dsh-kun-like-pet"`，就说明还在用被门禁拦下的旧版。

> 不建议用 `dsh plugin allow-version` 绕过门禁：那只是关掉检查，0.2 里 `shell.run` 已经不存在，完成音仍然是坏的。请换成 2.1.0。

旧版转换还曾用过 `@dsh-external/dsh-kun-like-pet`（包内没有 `dsh.bundle`）。若残留，一并清理：

```bash
npx @deepseek-ai/dsh plugin --profile web remove @dsh-external/dsh-kun-like-pet
```

## 装完之后怎么确认生效

打开终端输出里的 Web 地址，桌宠应显示在右下角。Host 自检接口：

```text
http://127.0.0.1:3080/kun-pet/state
http://127.0.0.1:3080/kun-pet/spritesheet.webp
http://127.0.0.1:3080/kun-pet/voice.mp3
```

`/kun-pet/state` 返回 `{"mode":"idle","seq":0,"spriteUrl":"/kun-pet/spritesheet.webp","voiceUrl":"/kun-pet/voice.mp3"}`。如果 3080 已占用，DSH 会使用其他端口，请以启动日志为准。也可以用 `kun_pet_debug` 工具看状态机内部计数。

**完成音听不到？** 先确认这台机器真的有可用音频输出设备：

```powershell
Get-PnpDevice -Class AudioEndpoint | Select-Object Status, FriendlyName
```

若列表为空（虚拟机、无声卡、音频被禁用），任何实现都不会出声——`System.Media.SoundPlayer` 会瞬间返回，WPF `MediaPlayer` 则会报 `HRESULT: 0xC00D11D2`（本仓库在无声卡机器上验证过这两种表现）。这与插件无关。

## 开发与验证

```bash
npm install         # 只装 tsdown / typescript / @types/node 与 peer 类型包
npm run build       # plugin/src → plugin/lib
npm test            # 素材、源码、bundle 清单和构建产物校验
npm run pack:check  # 检查 npm/GitHub 发布包内容
```

修改 `plugin/src/` 后必须重新执行 `npm run build`，并把更新后的 `plugin/lib/` 一并提交（`plugin/lib` 是仓库的一部分，GitHub 安装直接用它）。独立动画预览可直接运行 `demo/index.html`。

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
├─ assets/                      # 精灵图 + 提示音（mp3 给浏览器，wav 给 Windows 宿主）
├─ demo/                        # 无 DSH 的动画预览
├─ docs/                        # 素材契约与截图
├─ scripts/                     # 完整性和 bundle 校验
└─ src/、kunpet.package.json    # 1.x 动态插件历史参考，不参与静态安装
```

## 把新代码推到 GitHub

仓库已经有两个 remote：

```bash
git remote -v
# origin    https://github.com/GangLongYu/dsh-kun-like-pet.git   ← 你自己的仓库，往这里推
# upstream  https://github.com/liyupi/dsh-kun-like-pet.git       ← 原项目，只用来拉更新
```

### 1. 推送前自检（很重要）

`plugin/lib/` 是提交进仓库的构建产物，**改完源码忘了 build 就会推出旧代码**：

```bash
npm install
npm run build
npm test
npm run pack:check
git status --short          # 确认 plugin/lib 与 plugin/src 同步
git diff --stat -- plugin/lib
```

确认没有把 `node_modules/`、`.tmp/`、`*.tgz` 加进来（`.gitignore` 已覆盖）。

### 2. 提交并推送

```bash
git add -A
git commit -m "fix: 适配 DSH 0.2（peer 门禁 / shell.run / waterfall 放行）"
git push origin main
```

首次推送新分支时用 `git push -u origin main` 建立跟踪关系；之后直接 `git push` 即可。
如果推送被拒（远端有新提交）：先 `git pull --rebase origin main` 再 `git push`。

### 3. 认证方式（三选一）

| 方式 | 做法 |
| --- | --- |
| GitHub CLI | `gh auth login`，之后 `git push` 自动带凭据 |
| HTTPS + PAT | 用 Personal Access Token 当密码；把凭据交给 Git Credential Manager 记住 |
| SSH | 把 `origin` 换成 `git@github.com:GangLongYu/dsh-kun-like-pet.git`，并配好 SSH key |

不确定现在是什么状态时：

```bash
git config --get remote.origin.url
gh auth status
```

### 4. 打版本 / 发 Release（可选）

版本号写在 `package.json`，改完记得同步 `CHANGELOG.md`：

```bash
npm run build
npm test
git add -A && git commit -m "chore: release v2.1.0"
git tag v2.1.0
git push origin main --tags
npm pack                      # 产出 dsh-kun-like-pet-2.1.0.tgz
gh release create v2.1.0 dsh-kun-like-pet-2.1.0.tgz --notes "DSH 0.2 兼容"
```

别人就能用 `npx @deepseek-ai/dsh plugin --profile web add github:GangLongYu/dsh-kun-like-pet` 直接安装。

### 5. 从原项目同步更新（可选）

```bash
git fetch upstream
git merge upstream/main       # 或用 git rebase upstream/main
```

## 素材与许可

- 代码使用 [MIT License](LICENSE)。原项目：[liyupi/dsh-kun-like-pet](https://github.com/liyupi/dsh-kun-like-pet)。
- `assets/voice.mp3` 是网络二创梗语音片段，`assets/voice.wav` 是它的 PCM 转换（仅供 Windows 宿主播放），`assets/spritesheet.webp` 是粉丝二创像素形象，仅供个人学习交流；素材不随 MIT 代码许可自动获得商业使用授权。
- 若你是权利人且不希望相关内容被展示，请联系仓库维护者删除。

## 感想
Vibe coding时代，想要什么自己写。一开始是让dsh改，后面把自己改崩了，codex抢救一下。

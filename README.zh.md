# DeepSeek Harness / DSH Next 个人扩展安装器

[English](README.md)

为 Windows 上**已安装的官方 DeepSeek Harness 原版或 DSH Next 桌面版**补齐 9 个个人扩展。[一条命令安装器](#一条命令安装最新版)自动选择最新正式版 Profile，并使用所选应用自带的 Node、Electron 和 pnpm。Windows PowerShell 5.1 即可执行，不需要另外安装 Node、pnpm 或 Git。

本仓库仅维护版本锁和安装器。插件源码在独立的 [DSH-Next-Plugins](https://github.com/xue-ding-e/DSH-Next-Plugins) 或各自上游仓库维护。Release ZIP 只包含安装器和预构建插件 tgz，不包含 Harness 本体或 Harness 源码树。

扩展清单：`dsh-browser-control`、`dsh-nav-buttons`、`dsh-input-guard`、`dsh-whale-boot`、`dsh-bsk-bridge`、`dsh-retry-tuning`、`dsh-plugin-subscriptions`、`dsh-qoder-connect`、`dsh-chat-import`。

以上 9 项是本仓默认预设。安装器接受任意非空、npm 包名合法且唯一、精确版本和哈希齐全的清单，也支持单个 scoped 包。增减清单条目即可调整配方，无需修改 CLI。删除条目表示停止管理该插件；已有安装如需卸载，请另用所选宿主的受支持 plugin CLI。

冻结的 v0.1.0 候选包已经完成真实隔离 Next smoke：安装版 native CLI 在空白隔离 home 中安装并启用 9/9，重复安装返回 `changed: false` 且 `package.json` 字节完全一致；正常桌面 Host 收到 `ready`、确认 `shutdown-complete` 并以退出码 0 结束。smoke 使用无凭据的隔离 DS_HOME 和 OS 用户环境。网页未登录时 HTTP 401 是宿主原生认证预期，不是插件安装失败；GUI 渲染仍未验证。

## 在新电脑安装

1. 要复现源码功能，请安装 **DSH Next**；官方 DeepSeek Harness 可安装外置插件子集。安装后完全退出应用，包括托盘中的进程，只关窗口可能仍在后台运行。CLI 通过安装包自带的初始化函数创建空白 Profile；不完整的既有 Profile 仍需先打开客户端恢复。
2. 从本仓库 Releases 下载 Windows ZIP，完整解压到本地目录。`Install.cmd`、`installer/`、`src/`、`profile/`、`artifacts/` 必须放在一起，不要在压缩包预览窗口中直接运行。
3. 双击 `Install.cmd`。9 个插件 tgz 已随包附带，普通运行依赖仍可能需要从 npm registry 下载，因此安装时可能需要网络。
4. 出现已核对 9 个依赖和 9 个 bundle 的提示后，重新启动所选客户端。登录、PAT、OAuth、浏览器绑定和视频资源需按下表单独配置。

安装器通过两种应用的卸载注册信息、开始菜单快捷方式和运行中程序位置发现安装目录，再核对实际安装包身份与运行时。双击时发现多个安装目录会让用户选择；CLI、check 和 dry-run 要求显式选择。`--host original|next` 优先且必须与安装包身份匹配，不符就报错，不会回退到另一宿主或另一套账号目录。开发源码目录不能当作安装版使用。

```cmd
Install.cmd --host original --app-dir "C:\Apps\DeepSeek Harness" --dry-run
Install.cmd --host next --app-dir "C:\Apps\DSH Next" --check
Install.cmd --host next --app-dir "C:\Apps\DSH Next" --home "C:\Data\dsh-next"
```

原版使用 `DSH_HOME` 或 `%USERPROFILE%\.dsh`；Next 使用 `DSH_NEXT_HOME` 或 `%USERPROFILE%\.dsh-next`。`--home` 优先于所选宿主的默认值，必须指向该应用实际使用的目录。安装命令可初始化尚不存在的桌面 Profile，不会猜测并补写不完整 Profile 中缺少的文件。自定义目录应在启动该宿主时设置对应环境变量。安装器不复制用户 Profile，会拒绝另一宿主的已知数据目录、它的父子目录、应用安装目录，以及通过 junction 指向这些位置的路径。安装到原版是明确选择，不是 Next 探测失败后的后备行为。

`--dry-run` 只检查已初始化 Profile、运行时、退出状态、锁、路径和归档哈希，不写 Profile。`check` / `--check` 不下载归档，核对安装版本、运行文件和 `dsh.profile.bundles`，仍要求退出应用；`doctor` 可在客户端运行时读取同一清单，对尚未创建的 Profile 返回缺失状态而不创建它。包安装、服务商授权、运行时与 GUI 可用状态分别报告。加 `--json` 可获得机器可读结果。无人值守时可在当前进程设置 `DSH_NEXT_INSTALL_NO_PAUSE=1`，跳过命令窗口结束前的 `pause`。

`--isolated` 只用于受控的 packaged host smoke，必须同时显式指定 `--host`、`--app-dir`、`--home`，且 home 位于 `.dsh` 与 `.dsh-next` 两套正常目录之外。只有确认其他进程的可执行文件位于所选私有 app 根目录之外时才可排除它；选中进程或归属未知仍会阻止安装。普通安装继续要求完整退出宿主。

## 安装后配置

| 插件或集成 | 代码安装完成后仍需处理 |
| --- | --- |
| DSH 与订阅 provider | 根据需要登录或分别授权。Antigravity 可能还需要独立配置 OAuth application；未授权不代表插件安装失败。 |
| Qoder Connect | 配置自己的 Qoder PAT。需要本地脱敏时，在 Magpie 下载隐私过滤模型，并在插件配置中开启 `privacyFilter.enabled`。 |
| BSK bridge | 使用前在新电脑显式绑定目标浏览器。发布包不得保留旧 browser ID，未绑定时应明确报错，不能静默选择任意浏览器。 |
| Whale boot | **不包含视频资源，资源待提供**；使用视频功能前需自行配置本地资源。 |
| Browser control | 新电脑没有旧电脑的网页登录状态，按需登录网站。 |
| Chat import | 安装后自行选择本地数据源，安装器不会导入聊天记录。 |

安装器仅核验插件代码安装与 bundle 选择，不会登录账号、验证 PAT、授权 OAuth、绑定浏览器、下载视频，也不会把这些集成报告为已经可用。

`dsh-nav-buttons` 的原生鼠标 AppCommand 导航依赖 `globalThis.dshDesktop.protocolVersion === 1` 和 `dshDesktop.navigation.subscribe`。原版宿主若缺少该 IPC，只能使用插件的 DOM 鼠标事件回退；安装器不会宣称原生导航已通过验证。Browser control 需要提供 `executeJavaScript`、`loadURL` 的 Electron 侧栏 webview；收集的实现缺少受支持的公开 preload 截图接口，因此截图动作不可用，可按需使用 snapshot/read_text。这些限制单独报告，不阻塞 Next 的代码安装；原版具体具备哪些 GUI 能力仍需真实宿主验收。

## 一条命令安装最新版

完全退出 DSH Next（包括托盘）后，在 **Windows PowerShell** 中执行下面这一行。可以从任意目录执行，安装过程在 DSH 的 GUI 聊天窗口外进行：

```powershell
irm https://github.com/xue-ding-e/DSH-Next-Profile/releases/latest/download/Install-Latest.ps1 | iex
```

默认执行宿主 `next` 的 `install`。每次运行都会查询 GitHub 最新正式版，选择该版不可变的 ZIP 和校验文件 URL，验证 SHA-256 后执行包内的 `Install.ps1`。下载文件是临时文件，已安装的插件归档保留在所选桌面 Profile 中。验证成功后重新启动 DSH Next。以后要安装新版本，仍执行同一行；它不会安装后台更新器，也不会升级 DSH 桌面程序本身。

使用官方原版、自定义目录、只读诊断或精确基线匹配时，可下载脚本并传入选项：

```powershell
Invoke-WebRequest https://github.com/xue-ding-e/DSH-Next-Profile/releases/latest/download/Install-Latest.ps1 -OutFile Install-Latest.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-Latest.ps1 -HostKind next -Command doctor -MatchBaseline
```

脚本支持 `-HostKind next|original`、`-AppDir`、`-HomeDirectory`、`-Command install|check|doctor|features` 和 `-MatchBaseline`。官方原版必须显式传入 `-HostKind original`。也可手动下载[最新版 Windows ZIP](https://github.com/xue-ding-e/DSH-Next-Profile/releases/latest/download/dsh-next-profile-windows.zip)，完整解压后按上文运行 `Install.cmd`。

### pnpm 备选入口

已有 Node 24.9+ 和 pnpm 的电脑，可使用下面固定名称的完整包。缓存选项让每次运行都重新解析 dlx 包；普通 dlx 默认会将命令缓存 24 小时。无需发布 npm 注册表，也不需要 GitHub 账号令牌：

```powershell
pnpm --config.dlx-cache-max-age=0 dlx --package="https://github.com/xue-ding-e/DSH-Next-Profile/releases/latest/download/dsh-next-profile.tgz" dsh-next-profile install --host next
```

CLI 支持 `install`、`check`、`doctor`、`features`、`--app-dir`、`--home`、`--manifest`、`--dry-run`、`--json` 和 `--match-baseline`。需要复现旧版本时使用带版本号的资产 URL；验证本地候选包时使用构建后 tgz 的路径。GitHub 自动生成的源码压缩包不是预构建安装包。

`profile/manifest.json` 除插件版本和 SHA-256 外，还记录精确的骨架基线。`--match-baseline` 在写 Profile 前拒绝宿主种类、运行时版本或安装版应用版本不一致的情况；`doctor` 在包状态旁报告 `baselineMatches`。这锁定安装的代码，不复制账号、浏览器身份、会话或外观偏好。新电脑的 OAuth/PAT 授权、BSK 安装与绑定、本地视频仍按上表配置。

`profile/feature-matrix.json` 是完整功能归属的维护位置：需要源码的 GUI 和底层实现整体保留，既有外置包单独记录，原生侧键的插件部分仍标记为依赖 Next 骨架。`features` 不访问 Desktop 或网络即可读取经哈希锁定的记录。将插件装到官方 Harness 只能得到插件子集，不会添加 Next 的源码功能。运行时和 GUI 等价需要匹配骨架及对应功能验收，不能仅凭静态包清单宣称通过。

完整 v0.1.0 候选包使用不可变插件 tgz 通过 `--archives` 组装，并携带哈希核验的 `profile/compatibility.json` 静态证据。记录会区分源码/API 匹配与运行时验证，保留官方宿主 preflight 拒绝和原生导航 IPC 缺口，不会把原版 GUI 或 provider 授权报告为已验证。

## 重复安装与错误诊断

安装器在写入前逐个核验 tgz 的 SHA-256，manifest 路径经过链接解析后仍必须位于发布目录内。归档缓存到 `profiles/desktop/.extension-pack/artifacts/`，因此删除下载目录不会破坏 profile 中的本地依赖引用。

实际安装调用受支持的安装版 CLI：`dsh plugin --profile desktop add <缓存中的本地 tgz 路径>`，只在子进程中设置正确的 `DSH_HOME`。Next 子进程还会设置 `DSH_NEXT_HOME`；原版子进程会移除 Next 专用变量。安装器尊重桌面 profile 的 `lock` 和 `package.json.lock`，不删除残留锁、不终止正在运行的桌面宿主。合集内原先禁用的 bundle 会通过安装版自己的写锁和原子写入方法启用，保留其他 profile 选择。

同一发布版本已有成功回执，且依赖、版本和 bundle 均匹配时，重复执行不会重新安装。失败返回非 0，保留 `profiles/desktop/.plugin-manager/logs/` 下的 CLI 诊断；按错误提示处理、完全退出所选宿主后重试。残留锁或包管理运行记录需通过对应宿主或其受支持的 plugin CLI 恢复，不能删除仍在运行的操作所持有的锁。失败可能留下下载的模块或缓存归档，重启前可用 `--check` 验证。

安装器不读取或修改账号凭据、workspace 和会话记录，只写入所选桌面 profile 中的插件包状态及安装器缓存、回执。报告问题时保留完整错误提示；转发日志前先检查其中是否含 provider 的敏感输出。

## 构建发布包

构建机需要 Node 24.9+ 和 pnpm 11.28.5。每个插件的源码、已构建的 **`lib/` 产物**、运行资源和上游许可证均放在独立 Plugins 仓库的 `plugins/<name>/`。Profile 仓库不跟踪插件源码，`vendor/` 仅作为被忽略的过渡备份。构建脚本不会编译插件、安装插件依赖或修改外部源码树。先清理个人路径和凭据，BSK 保持明确未绑定状态，Whale 视频保持未配置状态。

由维护者创建 `profile/manifest.json`，使用 schema version 1 和所需的非空插件清单：

```json
{
  "schemaVersion": 1,
  "plugins": [
    {
      "name": "dsh-browser-control",
      "version": "1.0.0",
      "source": "plugins/dsh-browser-control",
      "url": "https://github.com/xue-ding-e/DSH-Next-Plugins/releases/download/<tag>/dsh-browser-control-1.0.0.tgz",
      "sha256": "<64位小写十六进制>"
    }
  ]
}
```

示例单项是一个合法的自定义配方，本仓默认配方列出前述 9 个插件。`name` 和精确 `version` 必填，`source` 相对于 `--sources`，不能越界或通过链接指向该目录外。预构建包可省略 `source`，改用成对的 `url`、`sha256` 锁定公开 HTTPS tgz。指定 `--sources` 时会核对源码包版本及清单中已有的归档哈希。首次引导的源码配方可暂缺 `url`、`sha256`，但供安装器消费前必须补齐公开 URL 与哈希；每项安装清单都要求精确 SHA-256。合集版本读取仓库根 `package.json`。

```powershell
node --test tests/*.test.mjs
node scripts/build-release.mjs --sources ../DSH-Next-Plugins --manifest profile/manifest.json --output scripts/.output
node scripts/smoke-package.mjs --directory scripts/.output/package
```

插件归档冻结后，不重新打包而直接组装完整发布包：

```powershell
node scripts/build-release.mjs `
  --archives .output/plugins-v0.1.0/artifacts `
  --manifest profile/manifest.json `
  --compatibility profile/compatibility.json `
  --output .output/full-v0.1.0
node scripts/smoke-package.mjs --directory .output/full-v0.1.0/package
```

每次使用新的输出目录，已存在的 `package/` 会被拒绝，避免混入旧产物。Windows 通过系统 PowerShell/.NET 生成 ZIP；其他平台需要 `zip` 命令，也可用 `--no-zip` 只生成 tgz。不传 `--sources` 时，构建器从 URL 锁下载，用系统 `tar` 检查并解包后才接收产物，无需额外 Node 依赖。全部 URL 和哈希公开发布后，可在仓库根运行 `pnpm pack` 生成薄包，prepack 会验证所需文件与版本锁。

构建脚本内部使用 npm 的维护版 packlist 整理插件归档，删除开发依赖和全部插件生命周期脚本，并保留运行依赖与许可证；终端用户使用 pnpm 的 `dlx`，CI 发布任务使用受控的 npm pack 步骤生成薄归档。下载的 tgz 必须预先构建并去掉脚本、开发依赖。遇到不可移植依赖、缺失构建入口、patch 或许可证、个人账号及浏览器文件、旧磁盘绝对路径、可识别密钥格式、旧 BSK 浏览器绑定时停止打包。下载归档若包含链接、特殊文件或重复路径也会被拒绝。自动检查只能拒绝已知问题，发布前维护者仍应审查插件内容。

若还需精确拒绝指定密钥，可通过 `DSH_PROFILE_DENY_SECRETS_FILE` 指向仓库外的私有 JSON 文件，内容是密钥字符串数组。构建器按字节查找，命中即拒绝且不打印密钥值；文件及内容不会复制到产物。密钥回归测试仅使用合成值。根 MIT 许可证仅覆盖安装器代码，各插件归档保留各自上游许可证。

完整构建的 `profile/manifest.json` 包含 `schemaVersion: 1`，为每个选定插件记录 `name`、精确 `version`、`archive`（例如 `artifacts/dsh-browser-control-1.0.0.tgz`）和小写十六进制 `sha256`，不记录绝对源码路径。Windows ZIP 与完整 npm tgz 都包含发布 manifest、`src/`、`installer/`、LICENSE 和清单中全部插件 tgz；ZIP 根还包含 `Install.cmd`。薄 npm 包则保留公开 URL 锁，安装时下载归档。输出目录的 `SHA256SUMS` 列出外层产物哈希。哈希用于检测相对于 manifest 的文件变化，并非发布者签名，请从可信发布来源下载整包。

测试使用 Node 内置 `node:test` 和可丢弃的隔离夹具，覆盖哈希与路径拒绝、双宿主目录隔离、首次初始化、锁、CLI 参数及环境、失败返回、幂等、bundle 核验、个人数据拒绝、公开 URL 锁和真实 pnpm/npm 打包。设置 `DSH_NEXT_TEST_APP_DIR` 为真实 Next 安装目录，还可用一次性 profile 夹具核验其 Electron 探测、安装版原子写入和 PowerShell 退出状态检查，不会停止正在运行的客户端。测试不验证 provider 已可用，也不能替代两种真实宿主的隔离 profile 安装验收。

公开包冒烟测试使用独立的 pnpm 缓存、存储和夹具用户环境。Windows 上未显式配置环境代理或 pnpm 代理时，运行器会为公开下载使用系统代理；回环请求保留直连路径。命令超时会保留操作名称与已捕获的输出，终止该命令的进程树，并等待输出管道关闭后再报告失败。

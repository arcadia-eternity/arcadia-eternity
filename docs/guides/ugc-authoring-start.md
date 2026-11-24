# 创建与调试资料包和环境

在桌面客户端的“创作工坊”页打开“终端命令”，即可复制带完整路径的命令，粘贴到终端或发给能执行命令的 agent。`arcadia-content` 用于创建、调试和安装内容，`arcadia` 用于对战、验证回放和开服。下文用这两个短名称代表对应的启动命令，实际使用时保留复制出的路径和引号，把 `--help` 换成示例参数即可。例如，把创作命令末尾的 `--help` 换成 `init pack frost-pack`，就会在当前目录创建资料包。

Linux AppImage 首次为项目连接 SDK 时，会把创作依赖保存在 `${XDG_DATA_HOME:-$HOME/.local/share}/arcadia-eternity/author-sdks`。同一 AppImage 的项目共用一份，关闭客户端后项目内的命令仍能找到依赖。

在新目录创建资料包用 `arcadia-content init pack frost-pack`。模板包含精灵、技能、减速印记、TypeScript 效果和场景测试。首个示例命中后减速两回合，重复命中刷新持续时间。

要用已有资料包编排赛制，可以直接创建独立环境。

```sh
arcadia-content init environment singles-cup
arcadia-content workspace singles-cup check
arcadia-content workspace singles-cup demo --execute --seed cup-baseline
arcadia-content workspace singles-cup preview --execute
```

环境的 `package.json` 用 `dependencies` 选择资料包，用 `arcadiaEnvironment` 保存规则。模板提供 `blue` 和 `orange` 两支测试队。可用的同版基础包会在本机复用，缺少的注册表依赖首次运行时可能需要联网。静态检查通过后，用固定种子的演示验证实际组装的环境。试玩命令会持续运行，按 Ctrl+C 结束。

通过 MCP 连接这个目录后，可用 `environment_list` 读取环境版本，`environment_save` 保存规则，`preview_start` 准备新候选，然后用 `team_validate` 逐队检查该版本的准入结果。命中禁用规则时，结果含 `valid: false`、诊断和环境修订。用 `battle_create` 指定两支合法队伍和种子即可开局。完整创作指南可从 `author_reference` 的 `authoring` 主题读取。

## 安装到玩家的桌面客户端

保持目标客户端打开。以下命令会列出可连接的实例、安装已打包的环境并核对玩家库。将 `INSTANCE_ID` 换成第一条命令返回的 `id`，将归档路径换成 `arcadia-content pack` 输出的文件名。只有一个实例在线时可以省略 `--instance`。

```sh
arcadia-content desktop instances
arcadia-content desktop environments install ./singles-cup.tgz --instance INSTANCE_ID
arcadia-content desktop environments list --instance INSTANCE_ID
```

资料包使用 `desktop packages install` 和 `desktop packages list`。安装源支持本地 `.tgz` 或精确 npm 版本，资料包也支持桌面端已有的 `.zip` 格式。默认使用离线物料，允许下载时加 `--allow-download`。客户端沿用已有的安装确认和效果执行授权。新环境安装后可在客户端环境列表中选择。

## 用已安装的环境对战和开服

保持客户端打开，把下面的 `ENV_ID` 换成环境列表返回的 ID，队伍路径换成自己的队伍文件，也可以直接使用创作模板生成的 `debug/teams/blue.yaml` 和 `debug/teams/orange.yaml`。模拟使用该环境已应用的内容和规则，并保留界面当前选中的环境。用同一个环境可以验证这场对战的回放。

```sh
arcadia battle simulate -1 blue.yaml -2 orange.yaml --environment ENV_ID --seed cup-1 --replay-out cup.json --json
arcadia battle replay cup.json --environment ENV_ID --verify --json
arcadia battle local -1 blue.yaml -2 orange.yaml --environment ENV_ID --ai player2
```

首次开客户端里的托管服，可以运行 `arcadia desktop server start --scope local --port 0`，让系统分配本地端口。此后运行 `arcadia desktop server start` 会沿用保存的设置。用 `status` 看状态、`restart` 重启、`stop` 停服。多个客户端同时运行时，用 `arcadia desktop instances` 查 ID，再给对战或托管服命令加 `--instance ID`。

也可以关闭客户端，用默认内置内容跑 `arcadia battle simulate`，或用 `arcadia server --host 127.0.0.1 --port 8102 --data-dir ./league-server` 从终端独立开服。

## 从独立模板开始

桌面端从“创作”页创建、打开本地源项目，或通过 HTTPS 克隆源项目。本地源项目的保存不会自动替换对战使用的安装版本。进入包后恢复上次内容分类，单击对象即可在旁边编辑规则、关联、资源及名称描述；列表保留筛选和滚动位置。搜索覆盖包内各类对象。技能显示实际属性图标和物理／特攻／属性／必杀类别，不使用重复的通用图标。特性和纹章是带对应标签的印记，关联列表支持选择已有内容，也支持“新建并关联”。为精灵选择技能、特性或纹章时，可以按名称或 ID 搜索当前项目和已声明、已安装的依赖。候选项标出来源，保存后仍引用原包中的对象。

在顶栏选择项目或内容语言。「外部工具」可以打开编辑器、显示项目文件夹或连接本机 SDK。「项目设置」可以调整包版本、依赖与兼容范围，以及构建和导出内容包。打开基础包源目录（本仓库的 `packs/base`）时，工作台按它原有的 `pack.json` 文件清单只读浏览内容和语言，不修改基础包布局。基础包不能在工作台内修改、导入资源、连接开发 SDK 或运行生成文件的任务；复制出的 MCP 配置也只提供读取。自己的内容包仍按原来的草稿、保存与外部冲突流程编辑。

新建时只需选择类型和名称，稳定标识与建议位置折叠在“对象标识与保存位置”中。定义默认保存到对应 `data` 目录内的新文件，可调整子目录；已有文件的整理、合并与移动仍使用外部工具。新建对象和关联先进入草稿，“查看并保存”核对后才写入磁盘。文件移动后会按 ID 重新定位，但未保存草稿必须先核对新来源；路径或 ID 被占用不会覆盖原文件。多个文件逐个保存，部分成功时保留其余草稿。YAML 的共享字段保持只读。

“资源”支持导入本地图片、音频和 SWF，并独立预览、查看使用位置。导入立即复制到项目的 `assets/imports`，资源定义和表现关联分别进入草稿保存。效果代码和文件组织使用外部编辑器。

打开项目后，默认显示「AI 助手」。复制连接提示词并粘贴到本机 AI 客户端的项目对话中。连接绑定当前项目。提示词包含本机启动参数，要求助手按客户端格式合并配置，再调用 `workspace_describe` 核对项目和权限。可编辑项目默认允许读写，运行测试、演示和打包需要单独勾选。展开「手动配置 MCP」后，可按客户端复制对应的 JSON 或 TOML。连接后，AI 可用 `workspace_context` 读取当前包、查看位置、对象或资源、多语言状态、未保存草稿及外部冲突，无需勾选协作对象。查看位置只是上下文，任务范围由人与 AI 的对话决定。AI 可以继续查询关联内容；源码读取仍返回磁盘版本，外部修改继续走刷新与冲突核对。上下文只写入 Electron userData 下的临时状态，不进入内容包或源项目导出；关闭工作区会清除，异常退出后的快照会过期。工作台不直接调用模型。

连接提示词会引导助手按任务读取 `git` 或 `release` 技能，使用本机 Git、已登录的 `gh` 或 AI 客户端自己的 GitHub 连接。可执行的操作取决于该工具对目标仓库的权限。

在独立仓库开发时，可以从 `@arcadia-eternity/content-sdk` 发行包复制模板，再运行 `npm install`、`npm test` 和 `npm run demo`。见 [UGC SDK 安装](ugc-npm-release.md)。

保存草稿后，点击常驻工具栏的“调试试玩”。准备完成会打开独立调试窗口，先调整双方测试队伍，再点击“开始对战”。模板从 `debug/teams/*.yaml` 读取 `arcadia.config.mjs` 指定的默认队伍，也可修改精灵、等级、技能、性格、特性、纹章和首发顺序；第一位玩家手动操作，对手由 AI 控制。测试队伍与个人编队分开；双方共用项目多队伍库，修改自动暂存为本机草稿，点击“保存队伍”才写入 `debug/teams/*.yaml`，由作者决定 Git 提交。关窗、重启或准备新版会保留草稿和选择。外部文件改变时，保存报冲突，可重新载入项目文件，或复制草稿为新队伍后保存。

“返回编辑器”回到原来的编辑位置；再次打开调试窗口可以继续对局。战斗中“结束并调整队伍”回到测试配置，确认后可以重新开局。编辑源码不会替换正在玩的版本；顶部统一使用“调试试玩”：已保存内容未变时复用现有窗口，变化后自动准备最新候选。客户端全局只保留一个试玩；准备新版本或切换项目试玩前，会结束旧对局并关闭旧窗口。

检查内容、场景测试和无界面演示对战位于顶部“更多操作”，构建内容包位于项目菜单。保存后可在“Git 版本管理”查看差异并提交，选择“检查并生成发行包”测试归档，成功后创建版本标签。详见 [Git 工作区与发行流程](ugc-npm-release.md#桌面-git-工作区)。构建成功后点击“用于环境”选择本机目标。修改源码后先保存，再点“重新构建并用于环境”。任务执行时保留当前编辑位置，底部可折叠的“输出”只显示最近一次任务的进度、结果和错误，下一次任务直接替换；当前任务失败时自动展开。侧栏只承担内容浏览，不再提供独立的运行页面。

CLI 使用 `arcadia-content workspace /path/to/pack preview --execute`；MCP 使用 `preview_start` 并通过 `job_get` 读取结果。`result.preview` 提供本机宿主 endpoint、客户端路径，以及配置了 `ARCADIA_PREVIEW_CLIENT_URL` 时的完整地址。桌面复制的 MCP 配置自动提供配套客户端地址。独立 CLI 可以设置该变量为本机配套网页地址。任务会保持试玩宿主运行，Ctrl+C 或 `job_cancel` 停止；其他入口可以通过相同项目的任务 ID 查询和取消。取消保留源码，异常退出的任务在重新打开后显示 interrupted。

模板按 `data/species`、`data/skills`、`data/marks` 分文件维护 JSON/YAML，效果放在 `src/effects/*.effect.ts`，使用 `@effect` / `@on` 装饰器由 SDK 自动发现装载，演示队伍放在 `debug/teams/*.yaml`，由 `arcadia.config.mjs` 的 `teams` 引用。通用构建、校验、重命名、安装和演示由本仓库的 [`@arcadia-eternity/content-sdk`](../../packages/content-dev/README.md) 提供，模板通过 `arcadia-content` 命令调用。通用工具和它的测试都留在主仓库，作者只维护本包内容与行为测试。

独立模板把 `@arcadia-eternity/content-sdk` 固定到精确版本。需要匹配本地未发布宿主时，可以用 `node scripts/stage-author-sdk.mjs /new/sdk-dir` 生成开发物料。

## 本地 SDK 与验证

如需使用已经构建好的本地 SDK，先在主仓库运行：

```sh
pnpm --filter @arcadia-eternity/content-sdk... run build
node scripts/stage-author-sdk.mjs /path/to/new-sdk-directory
```

再在自己的模板项目运行：

```sh
npm run setup -- --sdk-dir /path/to/new-sdk-directory
npm test
npm run demo
```

效果只在 TypeScript 中定义，并由技能或印记的数据引用；不再在 `package.json` 重复维护 `arcadia.exports`。文件可以分别放置，也可以在一个 JSON/YAML 数组中维护多条记录，引用依靠稳定的内容 ID。

模板测试会打包并安装真实 npm 产物，覆盖命中、未命中、刷新、来源清理、自然到期、参数修改和等待点恢复。通用测试工具保留在主仓库，模板只维护自己的行为断言。

SDK 版本与宿主构建身份分别记录。创建项目、安装依赖和通过测试不替代服务器管理员的准入决定。安装、战斗和回放流程见 [npm 内容包](npm-content.md)。

### 资源与表现

“形象与声音”保存到独立表现定义；资源 ID 与素材路径分开维护。资源页可查看使用者并修复位置，外部文件变动沿用草稿核对。详见 [表现格式 v2](content-presentation.md)。

在桌面工作台选择「发布新版本」可完成版本检查、建标签、推送与 GitHub 发行。操作和所需权限见 [Git 工作区与发行](ugc-npm-release.md#桌面-git-工作区)。

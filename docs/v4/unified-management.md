# 工作区与服务器管理

内容工作区、服务器实例和环境绑定分别表达所有权与使用关系。桌面可信页面通过私有 IPC 调用管理服务，远程桌面/配套网页通过认证 HTTP 调用相同服务。普通玩家只能读取公开目录；玩家登录、持有本地 UID、使用桌面客户端都不会自动获得远程管理权。

本页描述当前未发行工作树的实现接口与运行要求。正式桌面安装包、跨平台升级、真实 SMTP/GitHub 和生产部署需要对应验收证据，不能由单元测试代替。完整范围见 #273、#274、#214、#243、#244、#209、#217、#220。

## 所有权与持久化

| 资源                                    | 权威来源               | 使用方式                                                      |
| --------------------------------------- | ---------------------- | ------------------------------------------------------------- |
| 环境草稿、标准依赖锁、固定材料版本      | ContentWorkspace 文件  | 可编辑草稿产生新的固定版本，不修改活动局材料                  |
| serverId                                | data-dir/identity.json | 与数据库中的服务器身份校验，重启保持、克隆重建                |
| 服务器配置、默认环境绑定                | SQLite 或 PostgreSQL   | ServerInstance 持久保存自己的选择                             |
| EnvironmentBinding                      | 同一个业务数据库       | 引用 workspace/environment/version，区分 desired 与 effective |
| 账号、管理主体/授权、任务、审计、保留根 | 同一个业务数据库       | 服务端查询与事务，客户端不直接连接数据库                      |
| 房间、席位、游戏会话、运行 Worker/租约  | 当前进程               | 停机后失效；不会从数据库标志自动复活                          |

一个工作区只有一个写入 owner。客户端开服使用客户端已有安装材料与工作区，不重复安装服务器副本；托管子进程经私有通道访问桌面 owner。独立服务器持有自己的工作区。客户端本地游玩选择、服务器默认绑定、管理目标分别保存。

环境沿用 JSON/Zod 与标准 npm lock，旧 v1 调试环境可读取为共享模型。准备完成表示静态材料可装配，不等于作者逻辑通过全部运行验证，也不自动公开。安装与准备不得执行作者安装/构建脚本、模块入口或 Effect 工厂。官方维护服务不执行第三方作者代码；社区服可显式通过 `--allow-third-party-execution` 或 `ARCADIA_ALLOW_THIRD_PARTY_EXECUTION=1` 承担其批准环境的权威执行。

取得第三方内容与执行第三方代码分别授权。`--allow-third-party-content` 只开放取得/准备内容，不授予服务器权威执行；`--allow-third-party-execution` 同时开放内容取得，并允许社区宿主使用受信工具静态编译其作者 Effect。未允许执行的宿主要求预构建材料，不运行作者仓库脚本，也不凭包名推定内容可信。

## 配置与初始化

运行时为 Node 24。默认玩家模式是 guest，管理存储默认 SQLite：

```sh
pnpm build:prod
node dist/cli.js server --host 127.0.0.1 --port 8102 --data-dir /srv/arcadia
```

数据目录默认是当前目录下的 `.arcadia-server`。第一次启动在 `identity.json` 保存 serverId，在 `server.sqlite` 初始化数据库，并在 `workspace/` 保存内容工作区。目录应位于持久卷；SQLite 文件不要放网络共享文件系统。

普通 CLI 首次启动还会创建并公开一个 `builtin-server` 默认 binding，因此创建私人房间和普通匹配可以立即使用。这个一次性初始化状态与 binding 一同持久化；后续管理员清空默认选择、停用或删除 binding 后，重启不会恢复它。已有服务器记录不会被追溯性自动发布，可在管理面板中显式准备并发布环境。

| 配置                                              | 含义                                               |
| ------------------------------------------------- | -------------------------------------------------- |
| `--data-dir` / `ARCADIA_DATA_DIR`                 | 服务器身份和默认数据库/工作区的持久根目录          |
| `--workspace-root` / `ARCADIA_WORKSPACE_ROOT`     | 可选的工作区位置                                   |
| `--server-id` / `SERVER_ID`                       | 可选显式身份；必须与已有 identity.json 一致        |
| `STORAGE_DRIVER=sqlite`、`SQLITE_PATH`            | 本机 SQLite，路径默认 data-dir/server.sqlite       |
| `STORAGE_DRIVER=postgres`、`DATABASE_URL`         | 标准 PG 连接；不再使用 Supabase SDK 或 service key |
| `--public-origin` / `PUBLIC_ORIGIN`               | 访问者看到的配套网站 origin，与监听地址分开        |
| `CORS_ORIGIN`                                     | 允许的确切浏览器来源，生产管理应使用 HTTPS         |
| `--content-sources` / `ARCADIA_CONTENT_SOURCES`   | 宿主维护的来源注册表 JSON 文件                     |
| `--npm-registry` / `ARCADIA_NPM_REGISTRY`         | 托管环境使用的 HTTPS npm registry                  |
| `--offline-content` / `ARCADIA_OFFLINE_CONTENT=1` | 只用本机来源与已有 npm 缓存                        |
| `MANAGEMENT_TRUSTED_PROXY_IPS`                    | TLS 代理的确切 IP 地址，逗号分隔                   |

未指定 driver 而已有 DATABASE_URL 时兼容使用 PG。SQLite 与 PG 的相互冲突配置会报错；改连接字符串不会迁移数据。PG 支持不意味着多节点工作区管理已实现。

SQLite 与 PostgreSQL 共用 Kysely 查询和业务合同。G3 仍要求配置邮箱 OTP 和 GitHub App 两条恢复路径，数据库种类不会删减账号功能。Guest 服务器不需要玩家登录提供商，但仍能初始化管理 owner。

### 宿主内容来源

环境草稿的 `packages` 指定 npm 包和版本范围，`sources` 引用宿主来源注册表中的包名。来源文件是包名到描述对象的 JSON，例如：

```json
{
  "@example/community-pack": {
    "kind": "archive",
    "file": "/srv/arcadia-content/community-pack.tgz"
  }
}
```

支持的描述为 `archive {file}`、`directory {directory}`、`url {url, integrity?}`、`git {url, commit, artifactPath?}`。来源内 package.json 的包名必须与登记键一致。Git 使用 HTTPS 与完整固定提交 ID；URL 使用 HTTPS，不能包含用户密码。源仓库需要预构建产物时，`artifactPath` 指向其发布产物目录，不能指定构建命令。注册表路径和本机路径由宿主 CLI 配置，远程管理请求只引用已登记包名。

```sh
node dist/cli.js server --data-dir /srv/arcadia \
  --content-sources /srv/arcadia/content-sources.json \
  --npm-registry https://registry.npmjs.org/ \
  --allow-third-party-content
```

准备会按捕获的草稿修订创建真实 npm 项目，以 `--ignore-scripts` 解析并安装依赖，保存标准锁并校验实际解析版本；更新草稿不会继续使用旧安装组合冒充新环境。离线模式拒绝新的远程 Git/URL 获取；本地归档/目录可继续使用，但 npm 所需依赖必须已在缓存中。私有 registry 凭据通过受保护的 `ARCADIA_NPM_USERCONFIG` 文件提供，不进入来源文件、公开环境或分享包。

桌面内容页提供“导入环境来源”，由可信主进程打开文件选择器并保存同一格式的 `content-sources.json`，渲染页面不能提交任意本机路径。环境的 `sources` 可以引用已登记来源；未登记但已有安装材料时，使用唯一已安装版本或唯一选中的版本，有歧义则要求用户明确选择。

桌面准备复用 `ManagedProjects` 的来源获取、标准锁和安装管线，完成后把取得的项目移入客户端现有 `projects` 目录；托管服务器通过 owner 借用该材料，不再建立第二份包库。与当前已安装组合完全相同时直接复用。准备管理环境不会改变客户端本地游玩选择，使用期间由材料租约阻止回收。

## 升级数据库

空数据库可以在首次启动时初始化。已有库需要迁移时，启动会拒绝使用未兼容 schema。先停止写入并完成备份，再执行：

```sh
node dist/cli.js server db status --data-dir /srv/arcadia
node dist/cli.js server db migrate --data-dir /srv/arcadia
```

管理配置和现行 G3 账号共用版本化迁移。旧 PG `arcadia_auth` 先校验结构，再登记基线，保留 serverId/accountId、身份绑定与停用状态。历史公开 players/旧邮箱/战报 SQL 不会自动认领为新账号，也不作为当前 schema 初始化脚本。

`db status` 是只读检查；目标目录或 SQLite 文件不存在时报告 empty，不创建目录、身份或数据库。迁移与离线备份取得独占维护锁，运行中的服务持有 owner 锁时不能升级同一数据目录。在线备份使用下文的工作区快照与数据库快照校验。

## 管理登录与权限

在持有服务器数据目录访问权的宿主终端获取一次性登录码：

```sh
node dist/cli.js server admin login-code --data-dir /srv/arcadia
```

数据目录必须已经初始化。如果尚未启动过服务，先运行 `server db migrate --data-dir /srv/arcadia`。管理登录码命令不会隐式建立或升级数据库；它可在正常服务运行时签发凭据，但不能与独占迁移/离线备份同时修改管理数据。

命令仅在显式调用时输出登录码及到期时间。将登录码输入配套网页的 `/management` 页面；码只能兑换一次，默认 10 分钟到期。它不是邀请链接，不能放 URL、环境分享或常规服务日志。此命令也用于宿主管理恢复，不另建密码注册系统。

管理权限由主体、scope 与 action 决定。服务器管理员只能管理被授权服务器；工作区编辑/准备/删除权限另行授予。发布环境需要目标服务器的 publish 权限与来源环境的 use 权限。已有 G3 账号必须被显式关联并授权后才能管理；停用或撤权后不能继续通过页面、API 或尚未提交的长任务操作。

网页管理会话使用独立 HttpOnly/SameSite cookie；写请求检查 Origin 与 CSRF，生产使用 Secure/HTTPS。自动化服务凭证另行限权与撤销。远程服务器窗口不能取得本机文件系统或管理 IPC；可信本地页面才可通过私有 bridge 管理本机资源。浏览器仍保持一站一服，不提供任意后端选择器。

服务凭证的明文 token 仅在签发时展示。重新打开页面可通过 `GET /api/management/v1/credentials` 查询有权管理的服务凭证元数据：独立公开 ID、所属主体、创建/到期时间与权限；列表不返回 token、存储摘要、bootstrap 或浏览器会话。撤销使用公开 ID，并再次校验对应 scope 的管理权限；同一主体身份不自动授予跨 scope 的凭证管理权。

非回环管理 HTTP 请求必须经过 TLS。反向代理终止 TLS 时，设置 HTTPS 的 `PUBLIC_ORIGIN`，并在 `MANAGEMENT_TRUSTED_PROXY_IPS` 列出连接服务器的代理确切 IP；只有来自该地址且带 `X-Forwarded-Proto: https` 的请求才作为代理 TLS 处理。不接受 CIDR/通配符，也不信任普通客户端自报的转发头。回环传输例外只允许本机连接，仍需正常管理认证。

## 发布、任务与运行

管理入口前缀为 `/api/management/v1`。页面先查询 capabilities，分开处理功能支持、权限和资源限制。管理请求捕获目标身份，切换页面/目标后迟到响应不能更新另一目标。

环境准备和发布等任务返回 operationId，可重新查询状态；写入使用 expectedRevision/If-Match 与幂等键。取消、撤权和版本变化在提交前重新检查。文件与数据库没有跨介质事务，重启会按材料和持久绑定对账，旧 running 任务不得被当作成功结果。

### 环境导入与已提交操作恢复

环境导入先在工作区 `imports/` 写入 `arcadia.environment-import/1` 持久记录，固定 operationId、目标版本和预期草稿修订，再在数据库事务中检查权限并标记操作 `committed`。随后提交材料目录与草稿，完成后才标记任务成功。提交边界之后的取消不能把已有持久效果报告成“已撤销”。

若数据库提交已成功、但响应丢失或进程在文件提交前退出，保留 staging 和导入记录。维护清理或经授权的重试读取数据库事实，继续同一个 operation/version，不重新生成一份版本；修复成功后补齐原任务结果并清理记录。确认未提交的导入才可丢弃暂存材料。完成回执重放不覆盖后续草稿编辑；与外部编辑冲突时保留材料和可诊断的失败状态，不自动覆盖。桌面 owner 的私有 IPC 同样提供这组恢复操作。

导出操作在尝试数据库提交后也保留已生成文件，避免“提交成功但响应丢失”留下成功任务却没有可下载产物。文件下载租约与到期回收共同保护当前使用中的材料。

### 绑定与运行

EnvironmentBinding 默认固定版本；显式跟随指定环境的 ready 版本仍需通过兼容和执行政策检查。新房间捕获 effectiveVersion，默认环境或绑定更新不改变已有对局。删除检查运行租约、desired/effective 绑定与保留根，不能因当前房间数量为零就删材料。

排空停止接纳新局，现有对局按生命周期结束。独立服务器的进程启停由 systemd/Docker 等 supervisor 负责；进程退出后网页自身无法重新唤醒它。容量参数见[服务运行](server-runtime.md#对战容量)。

## 私人约战与固定环境

服务器已发布的 `peer` 环境与未发布的个人 Challenge 使用不同引用。个人环境通过 `arcadia.personal-environment` v1 文件或明确选择的 HTTPS 来源导入，在客户端校验完整材料。私人房间只接收 `PersonalEnvironmentReference`：固定描述、规则、版本和文件名/HTTPS 来源提示；不接收代码或归档，不要求登记为服务器 binding，也不能进入公共匹配队列。官方信令服不按该来源下载材料、不编译或执行作者代码。

个人环境固定身份覆盖运行材料修订、规则、包列表，以及可移植展示内容、原始规则数据和显式内嵌资源的整体快照。客户端校验描述与实际捕获材料一致，不能靠替换 metadata 或沿用旧 ID 改写环境。创建分享材料只读取调用方明确提供的数据，不隐式抓取官方材料、媒体或运行作者模块。HTTPS 获取由客户端在用户明确导入后执行，受大小、来源与取消约束。

房主和加入者分别校验已准备目录中的队伍、技能学习条件及环境规则，再提交 Ready；玩家宿主在创建对战 Worker 前再次校验双方队伍。配置、环境或宿主变化会推进 `challengeGeneration` 并清除旧确认，迟到 Ready 不能启动另一轮配置。房间、重连和再开局保留固定材料，私人引用只能采用玩家宿主模式。

内嵌媒体注册为当前导入拥有的 Blob 资源，由正常媒体加载链按需使用；更换环境、连接清理或取消时释放。公开 HTTP(S) 媒体仍按既有按需策略读取，不因导入预下载全部素材。真实 production 配套网页的两个独立浏览器已完成私人环境首局和同房间再战，两局自然结算、UGC 媒体实际解码；完整网络故障与双设备 LAN 矩阵另行验收。

## 在线服务器备份

宿主配置备份回调后，capabilities 返回 `server.backup`。共享管理页提供“创建服务器备份”，调用 `POST /api/management/v1/servers/:id/backup` 并返回异步 operation；成功后用户在任务中手动下载 `GET /api/management/v1/backups/:operationId`。创建、提交和下载均校验服务器 `backup` 与工作区 `export` 权限，归档含多个同工作区服务器时还检查每个服务器的授权。该入口不授予在线覆盖恢复能力。

一致性采用工作区 owner 内的文件捕获、数据库原子逻辑快照和捕获后复核：先取得带 owner/boot/generation 标识的工作区快照，再导出数据库，最后检查同一 owner 的文件观察值仍然有效。复制材料和桌面 IPC 期间不持有数据库长事务，也不宣称暂停所有业务写入。材料正在变化、owner 更换或快照失效时重新捕获，默认最多三次；持续不稳定则返回 `BACKUP_BUSY`，不交付混合版本归档。

备份产物存于受保护的临时目录，默认上限 512 MiB、有效期 24 小时；操作记录只保存下载元数据，不内嵌账户归档。下载重新验证权限、大小和完整性，下载租约与到期回收协调；数据库提交结果不明时保留产物等待查询或到期处理。会话、bootstrap/服务凭证及活动房间仍按恢复合同排除，已有对局不会被备份或恢复成在线状态。

## 离线备份、恢复与克隆

以下宿主 CLI 命令提供离线创建、检查、恢复和克隆；离线创建取得工作区 owner 锁，要求源服务停止写入。在线创建使用上面的管理 API；恢复/克隆仍由宿主向新目标执行。

```sh
node dist/cli.js server backup create --data-dir /srv/arcadia --file /backups/arcadia.json
node dist/cli.js server backup inspect --file /backups/arcadia.json
node dist/cli.js server backup restore --file /backups/arcadia.json --target /srv/arcadia-restored
node dist/cli.js server backup clone --file /backups/arcadia.json --target /srv/arcadia-new
```

目标目录必须不存在。恢复先校验并暂存内容和引用，再切换目录；原服务器恢复保留服务器/工作区/账号身份，旧运行会话和一次性凭证失效。克隆生成新身份，默认排除账号、授权、历史与凭证。目标数据库按同一存储配置选择；PG 导入要求空目标，不覆盖在线数据。

恢复/克隆根据当前宿主的政策重新验证材料，默认只接受预构建 Effect。社区宿主明确允许静态编译作者 Effect 时，可在该备份命令上加 `--allow-third-party-execution`；备份中记录的原执行政策不能自动授予当前宿主编译/执行权。此开关仍不执行作者 npm 安装/构建脚本或模块入口。

服务器备份包含敏感账户与管理数据，应由宿主保护。环境分享只携带内容定义/锁/材料，不带管理员、账号、服务器身份或秘密；可编辑源项目备份另保留未完成草稿。不要把环境包当作服务器备份，也不要把正在写入的 SQLite 主文件单独复制而遗漏 WAL。

## 验证责任

本地合同测试覆盖存储约束、账户一致性、管理权限/任务/发布和工作区引用，CI 已配置相应检查。PG 测试必须提供真实 `TEST_DATABASE_URL`，跳过不算通过。

2026-11-05 当前本地回归：服务端 30 文件/320 项通过，真实 SQLite/PostgreSQL，127.44 秒、exit 0 且无未处理异常；自有临时 PG 已停止。编译后 CLI 生命周期 3/3（21.45 秒）、首次初始化 5/5 与 bindings 7/7 已验证 pending retention、管理保留重启及旧库/clone/restore 真启动。此前 Web 257 项、备份核心 14 项、工作区 20 项及桌面 IPC 13 项证据保留。最新全仓 ESLint、根/服务端/Web 类型、Vite production 与 paired stage 通过；资源 3 文件/76 项和管理页面窄幅回归 8/8 通过。

真实普通匹配和权威好友房 2/2（约 1.3 分钟）通过。最终 paired build 的管理备份 UI 1/1（17.1 秒）通过，按 builtin 初始 1、归档共 2 环境验证。私人 Challenge 两浏览器 1/1（50.2 秒）通过：首局和再战各 2 回合自然结束、媒体解码，网络/UI 错误为空，292 次采样无服务端 Worker、目录不变。此前 Blob 提前回收的失败经 transition 回归先红后绿并在本轮严格验收通过；当前附件已保留到隔离输出目录。

最终 Linux arm64 Docker 镜像 `sha256:fcb6bcc5739ee951dd6668b6fdcf861943bfda6de99b55c67996e943b744f8b8` 验收 15.6 秒，包含最后初始化/retention/UI 修补；两库重建保留身份、默认绑定和版本，PG 重启通过。最终冻结源码 r3 macOS arm64 预览的真实包内 SQLite/完整宿主 1/1（12.74 秒）通过，356 个 renderer 与 62 个 server 文件匹配输入。PR #275 的生产代码快照 82dd37d4 已通过 baseline 6/6 与桌面四平台 4/4；桌面四个平台均包含真实包内 SQLite 和完整开服验收；arm64 首次未取得托管运行器，仅重跑该项后成功。随后修正独立展示文件的测试素材准备，服务器 UGC 同步的有媒体、无媒体两种本地场景均通过，验证了默认环境替换后的旧房间版本保留、重连与自然结算。5 项许可证问题保持 releaseReady=false；正式安装升级、双设备 LAN、真实 SMTP/GitHub 和完整故障矩阵仍开放。源码审查为 WATCH / APPROVE，不等于发行批准。精确提交、产物来源和验证口径见[统一管理验证记录](validation/unified-management-2026-11-05.md)。

```sh
pnpm --filter @arcadia-eternity/database test:run
pnpm test:server-standalone
pnpm typecheck:server-standalone
pnpm exec vitest run bin/__tests__/server-*.test.ts --maxWorkers=1
pnpm --filter @arcadia-eternity/web-ui exec vitest run src/services/__tests__/managementClient.test.ts src/features/management/__tests__ --maxWorkers=1
```

下列交付证据分别记录，不从代码存在或合同测试推定完成：

- #259：Windows/macOS/Linux 正式安装包、SQLite native ABI、升级与桌面 IPC。
- #260/#262：干净宿主、持久卷、TLS、实际管理发布/入房与重启恢复。
- #261：真实 SMTP 投递、GitHub App 回调与账户恢复。
- #258/#266/#268：完整跨机/离线来源、备份故障、版本更新/回滚与回收竞争。
- #224/#264：私人 Challenge 代表性严格复验已通过；完整网络异常、多客户端与真实双设备 LAN 场景继续验收。
- #217/#262：在线一致性备份的实际部署、并发/故障及恢复流程；本地快照合同不替代完整运维验收。
- #233/#234：G4 战绩、积分和录像仍按原 Deferred 边界，不因管理面交付自动完成。

# 单进程房间与身份

当前服务端使用单进程房间与独立席位授权。G3 基础由 [PR #235](https://github.com/arcadia-eternity/arcadia-eternity/pull/235) 合并，Better Auth 验证层由 [PR #238](https://github.com/arcadia-eternity/arcadia-eternity/pull/238) 合并。管理配置与可选玩家账号使用同一 Kysely 持久层，支持 SQLite 和 PostgreSQL。工作区、环境绑定、管理员入口与迁移命令见[统一管理](unified-management.md)；UGC 固定环境与公开目录见[npm 内容包](npm-content.md)和[客户端边界](client-server-boundaries.md)。

## 合并与上线门槛

- **分支合并：G3。** 启用账号时必须有邮箱验证码和 GitHub App 用户授权两条可实际登录、跨重启恢复本服账号的路径；GitHub 是唯一第三方登录提供商。还要能显式绑定多个经验证的身份、处理冲突、拒绝解绑最后一种恢复方式，以及停用账号并撤销会话和房间权限。默认社区部署仍可只提供游客身份，使用本机 SQLite 保存管理数据，无需外部数据库或玩家登录提供商。
- **官方维护服务器对外上线：G4。** 服务端权威战绩、积分及榜单见 [#233](https://github.com/arcadia-eternity/arcadia-eternity/issues/233)，持久在线录像见 [#234](https://github.com/arcadia-eternity/arcadia-eternity/issues/234)。这两项在后期实施，不阻塞 G3 分支合并；合并也不代表官方服达到上线门槛。
- 现存旧玩家 UID、旧邮箱记录不自动认领新账号。G3 的恢复只恢复本服务器真正保存的账号身份，不等于恢复浏览器中的宠物、队伍和设置。

真实 SMTP 和 GitHub 登录尚未验收。维护者于 2026-10-24 免除了这两项对 #235 合并的阻塞；它们仍属于官方上线前的验证工作，不能视为已经通过；真实部署与提供商验证另行记录证据。

## 启动

```sh
pnpm install
pnpm build:prod
pnpm cli server --port 8102 --data-dir .arcadia-server
pnpm web:dev
```

也可以用 `docker compose up --build` 启动一个服务容器。默认游客模式使用 SQLite；Compose 将服务器数据保存到命名卷。无需 Redis、外部数据库、邮件或 gRPC 配置。数据库模式与 `ACCOUNT_MODE` 分开：游客服也可使用 PostgreSQL，SQLite 也可启用 G3。

`SERVER_ID` 是部署的稳定身份。省略时首次启动生成并原子保存在 `data-dir/identity.json`，重启和升级保持不变；显式指定的值必须与已有记录一致。切换机器需恢复同一份持久数据，克隆新服则生成新身份。每次进程启动仍生成新的 `bootId`。玩家浏览器凭证按服务器地址及 serverId 隔离，存入当前标签页的 sessionStorage；本地 UID 独立保存在本地资料中。管理会话使用独立的认证和作用域。

宿主通过 `--content-sources` 登记 Git 固定提交、HTTPS 归档或本机归档/目录，环境页面引用包名而不是任意文件路径。`--npm-registry` 指定 HTTPS npm registry；`--offline-content` 要求已有本地材料/缓存。`--allow-third-party-content` 仅允许取得第三方材料，`--allow-third-party-execution` 才允许社区宿主静态编译和权威执行获准内容。具体格式见[宿主内容来源](unified-management.md#宿主内容来源)。

公网管理网页使用 HTTPS。独立服务默认允许反向代理终止 TLS 后以 HTTP 转发。配置 `MANAGEMENT_TRUSTED_PROXY_IPS` 或显式设 `MANAGEMENT_REQUIRE_TLS=true` 可开启应用内检查，代理地址须为确切 IP，并与 HTTPS `PUBLIC_ORIGIN` 及代理的 `X-Forwarded-Proto: https` 一起使用。管理 Cookie 默认 `SameSite=Lax`，跨站配套网页可设 `MANAGEMENT_COOKIE_SAME_SITE=none`。首次离线签发管理登录码前先用 `server db migrate` 初始化数据；`server db status` 不创建缺失目录或数据库。

## 对战容量

根目录 `.env.example` 提供四个可配置项：`ARCADIA_MAX_CONCURRENT_BATTLES=32`、`ARCADIA_MAX_IDLE_WORKERS=4`、`ARCADIA_MAX_QUEUED_BATTLES=64`、`ARCADIA_BATTLE_QUEUE_TIMEOUT_MS=5000`。修改 `.env` 后重启服务；Docker Compose 会将这四项传入容器，修改后重新创建服务容器。每局独占一个 Effect Worker；满载后有界排队，空闲 Worker 按需保留最多 4 个，不在启动时预创建。等待到期或队列满会返回明确错误；离开、断线及停机会取消待启动对战。

Node 宿主可向 `createSingleProcessApp` 传入 `maxConcurrentBattles`、`maxIdleWorkers`、`maxQueuedBattles`、`battleQueueTimeoutMs`。房间数量上限与对战执行容量分别管理。完整参数含义、浏览器配置和运行统计见 [Effect 宿主容量配置](./effect-sandbox.md#容量与空闲保留配置)。

## 生命周期

### 普通匹配

大厅的“普通匹配”支持选择服务器开放的固定环境和本地队伍，然后排队、取消和自动开局。默认按同一环境内的入队顺序配对，服务器权威执行；每回合 30 秒，总计 1500 秒，保持隐藏队伍信息。它与房间码约战共用席位、动作校验及断线重连流程。结束后释放自动创建的房间，结算画面保留“重新匹配”入口。

队列以服务器席位去重，同一席位的多个连接共享排队状态。取消会通知该席位的所有连接；最后一个连接断开、凭证撤销或到期、切服和停机会清理排队。配对与取消竞争时，成功取消后不再开局；配对已提交则返回 `MATCH_ALREADY_STARTED`。房间容量不足或初始化失败会回滚，客户端可重试。等待与进行中的对局都固定原环境，不因更新而自动换版本。

`joinMatchmaking` 接受 `{ playerSchema, environmentId, environment }`；`environment` 是客户端实际取得目录并校验展示资源后生成的 `ServerEnvironmentAcceptance`。默认官方内容仍兼容直接传玩家资料及旧 `{ playerSchema, ruleSetId: 'standard' }`，非默认旧规则 ID 明确拒绝，不把旧规则字段当作新的评分授权。公开玩家 ID 或客户端提交的分数不参与身份授权。

### 可选匹配策略与评分域

Node 宿主可向 `createSingleProcessApp` 注入 `matchmakingPolicy: MatchmakingPolicy`。`findMatch(candidates, context)` 接收服务端确认的 `principal`、席位、入队时间，以及固定环境、当前时间和取消信号；返回两个候选席位或 `null`。服务端仍独立保证环境相同、席位不同且有效，以及取消／断线／容量检查。定时清理周期会重新考虑等待中的玩家，支持未来按等待时间扩大 ELO 匹配范围。调用默认 3000ms 超时，可用 `matchmakingPolicyTimeoutMs` 调整；策略应遵守 `context.signal`，停止后不能发布迟到配对。

策略可提供 `ratingScope(environment)`，返回稳定的 `{ namespace, ruleId? }`：仅 namespace 可表示该内容域的总体评分，附带 ruleId 可表示细分规则评分。它由服务器配置解析，不从秘密队伍推导，也不能使用每次部署／准备会变化的环境 ID 代替长期评分域。该接口用于后续可信评分查询和选人策略；默认策略为 FIFO，不读取或更新 ELO。

持久评分还需要服务器范围内的账号身份、可信战斗结果与幂等结算，继续归 #233；旧 ELO 查询／榜单 HTTP 路由和数据库实现没有重新启用。这里保留接入边界，不宣称评分、排行榜或历史数据迁移已经完成。

### 房间与进程

- 一个进程拥有所有房间、游戏席位、对战和信令转发。停机、崩溃、升级后这些临时状态全部丢弃；G3 账号登录凭据独立保存到 SQL 存储。
- 页面刷新或临时断线可以凭原会话重连仍存活的房间，并重新取得该席位可见的状态。
- 重启后游客凭证和旧席位失效。G3 账号凭据默认有效期 7 天（固定期限，重启不续期），服务端仅保存摘要、账号、资料及到期时间；客户端通过 `/session` 自动恢复账号并领取新席位，原房间不恢复。退出登录删除持久凭据；恢复时检查账号仍启用。客户端仍使用标签页 sessionStorage，关闭标签页后的记住登录不在此机制内。上线前签发的旧凭据没有持久记录，需要重新登录一次。
- 房间有容量、闲置期限与最大存活时间；离开、结束、超时和关闭必须释放内核、订阅与计时器。
- P2P 由房间选定的玩家担任权威宿主。`auto` 使用服务器 WebSocket 中继传输；也可显式选择 WebRTC 直连，但需要客户端网络允许 ICE 建连。宿主离开后不迁移运行中的战斗。
- 核心等待点快照仍供 CLI/本地保存使用，在线服务不写快照、动作日志或恢复描述。

## 身份和权限

| 身份                   | 用途                           | 是否能授权                         |
| ---------------------- | ------------------------------ | ---------------------------------- |
| 本地 profile.id / UID  | 本地资料、昵称及用户可见身份   | 否                                 |
| accountId              | 可选、限定于该服务器的持久账号 | 由账号提供商验证 proof 后使用      |
| sessionId              | 公开的会话关联标识             | 否                                 |
| session token          | 服务端随机签发的会话凭证       | 是，校验存活及期限                 |
| seatId / 在线 playerId | 当前会话获得的对战席位         | 必须同时持有有效会话及房间成员资格 |

相同 UID 可以建立不同游客会话，双方在同一场战斗也会有不同的 Player.id。客户端提交的 UID、playerId 或 sessionId 都不能覆盖服务器分配的席位。登录、退出及网络失败不修改本地 UID。

游客游戏会话不写数据库；管理配置、授权、任务和环境绑定独立持久化。G3 启用后，邮箱一次性验证码和 GitHub App 适配器只验证外部身份，`SQLAccountDirectory` 经统一 Kysely 存储负责本服 accountId 与外部身份的唯一映射，本进程会话注册表签发临时 token 和席位；详见[账号提供商设计](account-provider-design.md)。公开 UID、玩家登录和桌面客户端身份都不能自动取得管理员权限。

Better Auth 1.7.12 在验证层运行：真实 `emailOTP` 插件负责验证码生成、尝试数及一次性核销，并调用自定义摘要钩子，以进程随机密钥计算 HMAC 后保存；GitHub 公共 provider/OAuth API 负责授权请求及授权码交换的通用步骤。邮箱插件为每个挑战创建仅存内存的验证专用身份；不挂载 Better Auth 公共路由，不签发其 session/cookie，也不新增持久账号库。显式绑定多个邮箱、冲突处理和停用由同一个 `SQLAccountDirectory` 决定，`PgAccountDirectory` 保留为旧调用方的兼容入口。统一存储升级需要显式数据库迁移，验证器与 GitHub App 权限和 `/account` 回调保持原合同。

服务端持久保存服务器身份/设置、管理主体/授权、任务和环境绑定；环境文档与固定材料保存在工作区文件中。启用 G3 后增加服务器范围内的账号、状态和经验证的外部身份绑定。邮箱验证码及 GitHub 授权挑战留在内存，进程重启后需重新发起验证。游客游戏凭证、席位、房间、运行中的战斗和断线宽限也留在内存。停用账号保留已绑定的身份键，阻止用同一身份重新注册；管理员权限按目标 server/workspace 与动作单独检查。

## G3 账号配置

默认 `ACCOUNT_MODE=guest`（或不设置）只开放游客。部署者主动设为 `ACCOUNT_MODE=g3` 时，必须持久保存稳定的服务器身份、配置可用的 SQLite 或 PostgreSQL 存储，并提供 `SMTP_HOST`、`SMTP_FROM`、`GITHUB_APP_CLIENT_ID`、`GITHUB_APP_CLIENT_SECRET`、逗号分隔的 `GITHUB_APP_REDIRECT_URIS` 和明确的 `CORS_ORIGIN`；不得使用 `*`。每个回调 URL 必须是对应网页 origin 的精确 `/account` 地址，且网页回调 origin 集合必须与 `CORS_ORIGIN` 中的 HTTP(S) origins 完全相同（固定桌面来源 `arcadia-client://app` 除外），避免客户端显示 GitHub 登录却没有可用回调。单一回调部署可暂时使用旧的 `GITHUB_APP_REDIRECT_URI`，但不得与复数变量同时设置。GitHub App 的 **Client ID 不是 App ID**；Client Secret 仅保存在服务端部署环境。旧的 `OIDC_*` 变量不再用于 G3，混用时启动失败。按邮件服务要求可设置 `SMTP_PORT`（默认 587）及成对的 `SMTP_USER`/`SMTP_PASSWORD`。这些凭据不写进仓库。

当前官方网页仅使用一个 origin：

```env
CORS_ORIGIN=https://battle.yuuinih.com
GITHUB_APP_REDIRECT_URIS=https://battle.yuuinih.com/account
```

GitHub App 最多登记 10 条回调；服务端同样拒绝超过 10 条或重复的回调 origin。若以后增加网页 origin，必须同时把它加入 `CORS_ORIGIN`、`GITHUB_APP_REDIRECT_URIS` 和 GitHub App 登记页；G3 要求这两个 origin 集合完全一致。

在 GitHub App 注册页配置**每一个**用户授权回调 URL，与 `GITHUB_APP_REDIRECT_URIS` 中每项精确一致；每个 origin 都必须列入 `CORS_ORIGIN`。不要开启回调 URL 通配匹配。授权入口只接受浏览器的已允许 `Origin`，并选择该 origin 对应的 `/account` 回调；完成交换时仍使用同一条回调，浏览器不能自行提交回调地址。[GitHub 的回调说明](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-user-authorization-callback-url)区分了用户授权回调与安装后的 setup URL。账号登录只需用户授权，不要求玩家安装 App；不申请仓库权限，不开启安装时自动请求用户授权。当前适配器只调用 [`GET /user`](https://docs.github.com/en/rest/users/users#get-the-authenticated-user)读取稳定数字 `id`，此接口使用 GitHub App 用户访问令牌时无需额外的细粒度权限；**无需 Email addresses 权限**，也不发送 OAuth App 的 `user:email` scope。若以后确需读取经验证的 GitHub 邮箱，再申请 **Email addresses: Read-only** 并使用 [`GET /user/emails`](https://docs.github.com/en/rest/users/emails#list-email-addresses-for-the-authenticated-user)，但不得按邮箱自动合并账号。GitHub App 在授权 URL 中使用 `state`、S256 PKCE 和明确的 `redirect_uri`，不申请通用 OAuth scopes；服务端仅短暂使用交换来的 token，不持久保存。参见 [GitHub App 用户授权流程](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)。

存储默认采用 `STORAGE_DRIVER=sqlite`，数据库文件默认位于 `data-dir/server.sqlite`。使用 PostgreSQL 时设为 `STORAGE_DRIVER=postgres` 并提供 `DATABASE_URL`；未指定 driver 而已有 `DATABASE_URL` 的配置兼容选用 PostgreSQL。同时配置 SQLite 路径与 PG 连接会失败。现有 Supabase 项目可继续作为普通 PostgreSQL 托管商，使用标准数据库连接；运行时不依赖 Supabase SDK、Data API、Auth 或浏览器/service-role key。已有 `arcadia_auth` 账户通过受控迁移保留，不自动导入旧 `public.players` 或 Supabase Auth 用户。

空数据库首次启动可初始化。已有数据库先运行 `server db status`，安排停写和备份，再显式执行 `server db migrate`；服务启动只检查已安装 schema，不在接受流量时升级表。G3 还会检查 SMTP 可用性和 GitHub App 配置；配置或数据库不兼容时不开放监听。GitHub 授权及用户 API 在实际登录时调用，启动检查不代表真实外网登录已经验证。

邮箱发送及核销限流目前按进程计数，重启会清零；G4 官方服公开上线前还需邮件服务商配额或持久限流。网页端提供邮箱和 GitHub 两条路径；打包 Electron 的 GitHub 系统浏览器回跳仍需独立验收。重新认证恢复同一 accountId，但会得到新游戏 token 和席位，不恢复旧房间。

## 默认接口

- `GET /api/v1/server-info`：服务身份、启动身份、协议与能力。
- `POST /api/v1/sessions`：默认以 `{ profile: { id, name } }` 创建游客会话。G3 登录使用下方明确的提供商流程，不接受自称的 accountId 或 UID 作为证明。
- `GET /api/v1/session`：使用 Bearer token 校验及恢复会话。
- `DELETE /api/v1/session`：撤销会话和原席位权限。
- `POST /api/v1/auth/email/challenges` 与 `POST /api/v1/auth/email/complete`：发送并一次性核销邮箱验证码，完成登录或绑定。
- `POST /api/v1/auth/github/authorizations` 与 `POST /api/v1/auth/github/complete`：以 GitHub App 授权码、S256 PKCE、`state` 及发起标签页保存的秘密完成 GitHub 登录或绑定；服务端读取 GitHub 数字用户 ID，而非等待 OIDC ID Token。
- `GET /api/v1/account/identities`、`DELETE /api/v1/account/identities`、`DELETE /api/v1/account`：列出已验证身份、解绑非最后一条找回路径、停用账号并撤销当前会话及房间权限。
- Socket.IO 只接受 `auth.token`，每个受保护动作再次校验会话和成员资格。
- `GET /health`：进程健康检查。

旧集群、数据库 guest、邮件继承、排行榜、ELO、规则服务及恢复接口已经退出默认服务端。基础队伍合法性与显式房间选项由在线宿主负责。

`packages/database` 已改为服务端统一持久层，旧 Supabase SDK、旧战报/玩家 repositories 与运行脚本退出产品依赖；历史 SQL 保留用于数据盘点。代码退役不会删除生产表或将旧玩家记录自动认领为新服务器账号。历史 #195 已关闭；用户旧资料/录像的导出与处置继续由 #221/#272 跟踪。

## 平台边界

本入口面向常驻 Node 容器，可部署在 Fly.io、Railway、Render、Zeabur 或 CloudBase 容器型云托管。部署时必须保持一个运行实例，关闭空闲休眠。平台可提供进程、TLS、WebSocket 入口、日志和健康检查；房间归属、会话权限、战斗裁决、计时、断线宽限和内存清理仍由本服务负责。静态网站托管只承载网页资源。

Sites 的 Workers 支持 HTTP 和 WebSocket，但不能直接运行此常驻 Node 入口。其 D1/R2 能保存结构化记录和文件，并不能恢复这里约定为停机即解散的内存房间；若以后以 Sites 运行权威对战，需要另做运行时适配和验收。参见 [Sites 能力](https://learn.chatgpt.com/docs/sites)与 [CloudBase 云托管能力](https://docs.cloudbase.net/run/introduction)。

SQLite 和 PostgreSQL 共用同一业务接口、账号/绑定合同和迁移流程。工作区保持单 owner；采用 PG 不等于支持多个 Node 节点同时写共享工作区。边缘/Worker 宿主仍需要单独的运行时适配，不能仅换数据库就运行当前 Node 服务。跨数据库迁移要使用停写的一致性导出/导入并验证身份与引用；更改连接串不会搬迁数据。

## 验证

```sh
pnpm --filter @arcadia-eternity/database test:run
pnpm test:server
pnpm typecheck:server
pnpm lint:server
pnpm --filter @arcadia-eternity/web-ui exec vitest run src/services/__tests__/serverSession.test.ts
```

统一存储的 SQLite 合同默认运行，PostgreSQL 合同在提供 `TEST_DATABASE_URL` 时运行；CI 的 `native-server-entry` 已配置真实 PG，并运行数据库与完整服务端套件。缺少测试数据库导致跳过 PG 测试时，不能据此声称双库验收通过。邮箱测试运行真实 Better Auth OTP 插件并使用捕获式邮件发送器；GitHub App 测试运行真实 Better Auth 授权/OAuth API，以替代 HTTP 上游验证授权码交换和 `/user.id`。这些测试不能替代实际 SMTP 投递和 GitHub App 回调的预生产验证。客户端/网页及真实浏览器验收见相应测试目录。`server-native` 命令保留为新验证入口的别名。

## 生产配置

`fly.toml` 和生产部署工作流按单实例运行时调整。**生产中若仍有多个 Machine，必须先安排维护窗口调整规模**。本地实现完成不代表生产部署完成。

仓库配置不证明 Fly 实际运行状态。生产上线需核对持久卷或 PG、稳定身份、TLS、SMTP 和 GitHub App 配置，并单独完成 G3/G4 对应验收；本地测试与文档更新不构成生产部署证据。Fly 是否作为长期官方宿主留待 [#219](https://github.com/arcadia-eternity/arcadia-eternity/issues/219) 实测决定，下一次部署前还要核对现有 Machine 地域及 `primary_region='hkg'` 的可用性。

以下为仓库中的部署配置，实际 Machine 状态仍需部署时核对：

1. `fly.toml` 删除 Redis、邮件、gRPC 和集群环境变量；配置稳定 `SERVER_ID=arcadia-official`。
2. 仅保留 `/health` 健康检查，移除旧 `/metrics` 检查；设置 `auto_stop_machines='off'`、`min_machines_running=1`、`kill_signal='SIGTERM'`。
3. 使用 `rolling` 替换单个 Machine，允许该实例在更新时不可用。每次部署按约定丢弃房间。
4. 部署工作流在发现多个存量 Machine 时失败，由管理员安排维护窗口调整规模；加 `--ha=false` 避免创建备用实例。不会通过修改配置自动删除已有机器。

依据：[Fly 配置说明](https://fly.io/docs/reference/configuration/)与[部署参数](https://fly.io/docs/flyctl/deploy/)。仓库配置本身不证明已经部署或验证生产环境。

## 配套网页发行

默认服务器发行物现在携带 `dist/web`，启动时验证兼容清单。纯 API 宿主请显式使用 `--headless`。浏览器固定绑定部署者配置的单一后端；独立网页、CORS 和升级方式见 [配套网页部署](./paired-web-deployment.md)。

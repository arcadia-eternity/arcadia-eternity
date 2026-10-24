# 单进程房间与身份

本轮落实 #200 的服务端基础重构。服务端分支 `codex/single-process-server` 须达到 G3 并通过 #220 的验收后才能合并；UGC 不在本轮范围内。

## 合并与上线门槛

- **分支合并：G3。** 启用账号时必须有邮箱验证码和 GitHub App 用户授权两条可实际登录、跨重启恢复本服账号的路径；GitHub 是唯一第三方登录提供商。还要能显式绑定多个经验证的身份、处理冲突、拒绝解绑最后一种恢复方式，以及停用账号并撤销会话和房间权限。默认社区部署仍可只提供游客身份，不要求数据库。
- **官方维护服务器对外上线：G4。** 服务端权威战绩、积分及榜单见 [#233](https://github.com/arcadia-eternity/arcadia-eternity/issues/233)，持久在线录像见 [#234](https://github.com/arcadia-eternity/arcadia-eternity/issues/234)。这两项在后期实施，不阻塞 G3 分支合并；合并也不代表官方服达到上线门槛。
- 现存旧玩家 UID、旧邮箱记录不自动认领新账号。G3 的恢复只恢复本服务器真正保存的账号身份，不等于恢复浏览器中的宠物、队伍和设置。

## 启动

```sh
pnpm install
pnpm build:prod
pnpm cli server --port 8102 --server-id arcadia-local
pnpm web:dev
```

也可以用 `docker compose up --build` 启动一个服务容器。默认游客模式无需 Redis、数据库、邮件、JWT 或 gRPC 配置。

`SERVER_ID` 是部署的稳定名称，同一个服务升级时保持不变。每次启动会生成新的 `bootId`。浏览器凭证按服务器地址及 serverId 隔离，存入当前标签页的 sessionStorage；本地 UID 独立保存在本地资料中。

## 生命周期

- 一个进程拥有所有房间、会话、对战和信令转发。停机、崩溃、升级后全部丢弃。
- 页面刷新或临时断线可以凭原会话重连仍存活的房间，并重新取得该席位可见的状态。
- 重启后旧凭证失效，客户端提示原房间已失效。新的游客会话获得新的席位。
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

游客不写数据库。G3 启用后，邮箱一次性验证码和 GitHub App 适配器只验证外部身份，PostgreSQL 账号目录负责本服 accountId 与外部身份的唯一映射，本进程会话注册表签发临时 token 和席位；详见[账号提供商设计](account-provider-design.md)。旧 `AccountProvider.verify(proof)` 仅作兼容接口，不是默认入口的 G3 登录方式。公开 UID 不能用于认领账号。

默认服务端不创建数据库记录。启用 G3 时，只持久保存服务器范围内的账号、状态和经验证的外部身份绑定；邮箱验证码及 GitHub 授权挑战留在内存，进程重启后需重新发起验证。游客凭证、席位、房间、运行中的战斗和断线宽限也留在内存，不落库。停用账号保留已绑定的身份键，阻止用同一身份重新注册；恢复或删除停用账号需要单独的管理员流程。UGC 内容及发布记录属于后续独立能力。

## G3 账号配置

默认 `ACCOUNT_MODE=guest`（或不设置）只开放游客。部署者主动设为 `ACCOUNT_MODE=g3` 时，必须提供稳定的 `SERVER_ID`、`DATABASE_URL`、`SMTP_HOST`、`SMTP_FROM`、`GITHUB_APP_CLIENT_ID`、`GITHUB_APP_CLIENT_SECRET`、逗号分隔的 `GITHUB_APP_REDIRECT_URIS` 和明确的 `CORS_ORIGIN`；不得使用 `*`。每个回调 URL 必须是对应网页 origin 的精确 `/account` 地址，且回调 origin 集合必须与 `CORS_ORIGIN` 完全相同，避免客户端显示 GitHub 登录却没有可用回调。单一回调部署可暂时使用旧的 `GITHUB_APP_REDIRECT_URI`，但不得与复数变量同时设置。GitHub App 的 **Client ID 不是 App ID**；Client Secret 仅保存在服务端部署环境。旧的 `OIDC_*` 变量不再用于 G3，混用时启动失败。按邮件服务要求可设置 `SMTP_PORT`（默认 587）及成对的 `SMTP_USER`/`SMTP_PASSWORD`。这些凭据不写进仓库。

当前官方网页仅使用一个 origin：

```env
CORS_ORIGIN=https://battle.yuuinih.com
GITHUB_APP_REDIRECT_URIS=https://battle.yuuinih.com/account
```

GitHub App 最多登记 10 条回调；服务端同样拒绝超过 10 条或重复的回调 origin。若以后增加网页 origin，必须同时把它加入 `CORS_ORIGIN`、`GITHUB_APP_REDIRECT_URIS` 和 GitHub App 登记页；G3 要求这两个 origin 集合完全一致。

在 GitHub App 注册页配置**每一个**用户授权回调 URL，与 `GITHUB_APP_REDIRECT_URIS` 中每项精确一致；每个 origin 都必须列入 `CORS_ORIGIN`。不要开启回调 URL 通配匹配。授权入口只接受浏览器的已允许 `Origin`，并选择该 origin 对应的 `/account` 回调；完成交换时仍使用同一条回调，浏览器不能自行提交回调地址。[GitHub 的回调说明](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-user-authorization-callback-url)区分了用户授权回调与安装后的 setup URL。账号登录只需用户授权，不要求玩家安装 App；不申请仓库权限，不开启安装时自动请求用户授权。当前适配器只调用 [`GET /user`](https://docs.github.com/en/rest/users/users#get-the-authenticated-user)读取稳定数字 `id`，此接口使用 GitHub App 用户访问令牌时无需额外的细粒度权限；**无需 Email addresses 权限**，也不发送 OAuth App 的 `user:email` scope。若以后确需读取经验证的 GitHub 邮箱，再申请 **Email addresses: Read-only** 并使用 [`GET /user/emails`](https://docs.github.com/en/rest/users/emails#list-email-addresses-for-the-authenticated-user)，但不得按邮箱自动合并账号。GitHub App 在授权 URL 中使用 `state`、S256 PKCE 和明确的 `redirect_uri`，不申请通用 OAuth scopes；服务端仅短暂使用交换来的 token，不持久保存。参见 [GitHub App 用户授权流程](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)。

官方服继续使用现有 Supabase 项目的 **PostgreSQL 数据库**：`DATABASE_URL` 是只供服务端使用的 Postgres 连接串，新账号表位于同库的私有 `arcadia_auth` schema，不新建 Supabase 项目，也不将 `public.players` 或 Supabase Auth 用户自动认领为本服账号。`SUPABASE_URL`、浏览器 publishable/anon key 和 service-role key 都不是此连接串。2026-10-24 只读检查时，现有正式与开发项目尚无 `arcadia_auth` 表；本轮没有改动线上数据库。常驻容器优先使用 Supabase [直连或 IPv4 环境中的 session pooler](https://supabase.com/docs/guides/database/connecting-to-postgres)，按项目连接信息启用 TLS；transaction pooler 主要面向短命连接，且不支持 prepared statements。`arcadia_auth` 不加入 [Data API 的 exposed schemas](https://supabase.com/docs/guides/api/using-custom-schemas)，不向 `anon`、`authenticated` 或浏览器授予账号表权限。

启用账号时，启动会检查 PostgreSQL 表结构、SMTP 可用性和 GitHub App 配置；前两者不可用或配置无效则不开放监听。GitHub 的授权及用户 API 在实际登录时调用，不把启动配置检查误认为外网联通性测试。G3 实现目前在启动时用数据库连接角色执行 `CREATE SCHEMA/TABLE IF NOT EXISTS`，因此首次启用需要该角色具备 DDL 权限；正式上线前应将建表改为受控迁移，让常驻服务只持有私有 schema 的最小读写权限。账号目录不复用旧 `players.id`、旧验证码或旧 RLS。邮箱发送及核销限流目前按进程计数，重启会清零；G4 官方服公开上线前还需邮件服务商配额或持久限流，避免通过反复重启绕过发送限制。网页端提供邮箱和 GitHub 两条路径；打包 Electron 首版提供邮箱路径，GitHub 的系统浏览器回跳需要后续独立适配，不在桌面版伪装为可用。登录可在重启后重新取得同一 accountId，但会得到新 token 和席位，不恢复旧房间。

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

旧数据库资产暂时保留在 `packages/database`：`players`、`player_stats`、`player_elo_ratings`、`battle_records`、`email_verification_codes` 的 SQL、仓库代码和迁移脚本仍可审计；本轮不运行迁移、不删除生产表或已有数据，也不将旧玩家记录自动认领为新服务器账号。旧 RLS 风险与历史数据处置继续由 #195 单独评估。

## 平台边界

本入口面向常驻 Node 容器，可部署在 Fly.io、Railway、Render、Zeabur 或 CloudBase 容器型云托管。部署时必须保持一个运行实例，关闭空闲休眠。平台可提供进程、TLS、WebSocket 入口、日志和健康检查；房间归属、会话权限、战斗裁决、计时、断线宽限和内存清理仍由本服务负责。静态网站托管只承载网页资源。

Sites 的 Workers 支持 HTTP 和 WebSocket，但不能直接运行此常驻 Node 入口。其 D1/R2 能保存结构化记录和文件，并不能恢复这里约定为停机即解散的内存房间；若以后以 Sites 运行权威对战，需要另做运行时适配和验收。参见 [Sites 能力](https://learn.chatgpt.com/docs/sites)与 [CloudBase 云托管能力](https://docs.cloudbase.net/run/introduction)。

账号存储取决于是否启用 G3：游客专用社区服无需数据库；能访问外部 PostgreSQL 的常驻 Node 部署可使用当前 `DATABASE_URL` 账号目录，官方服沿用现有 Supabase PostgreSQL。对不能运行本入口或不能使用当前账号目录的边缘、Worker 等宿主，未来须通过独立账号服务 API 接入，或另做 `AccountDirectory` 存储适配器。无论后端选什么，都必须原子保证每服外部身份唯一归属、绑定冲突、最后一种恢复方式不可解绑，以及停用后保留身份键并拒绝重新登录；不能直接以任意 KV 替换 PostgreSQL。本轮只实现 PostgreSQL 目录和常驻 Node 入口，不包含这些账号 API、存储适配器或 Worker 对战运行时。

## 验证

```sh
pnpm test:server-standalone
pnpm typecheck:server-standalone
pnpm lint:server-standalone
pnpm --filter @arcadia-eternity/web-ui exec vitest run src/services/__tests__/serverSession.test.ts
```

账号目录的 PostgreSQL 并发与持久化测试在提供 `TEST_DATABASE_URL` 时运行；CI 的 `native-server-entry` 已配置测试数据库。邮箱测试使用捕获式邮件发送器，GitHub App 测试替代本地 HTTP 上游验证授权码交换和 `/user.id`；正式上线前还需在实际 SMTP 和 GitHub App 配置下完成预生产验证。客户端/网页及真实浏览器验收见相应测试目录。`server-native` 命令保留为新验证入口的别名。

## 生产配置

`fly.toml` 和生产部署工作流按单实例运行时调整。**生产中若仍有多个 Machine，必须先安排维护窗口调整规模**。本地实现完成不代表生产部署完成。

当前 Fly 配置尚未启用 `ACCOUNT_MODE=g3`，也未配置 PostgreSQL、SMTP 和 GitHub App 凭据；它不能因此宣称已经达到 G3 账号验收或 G4 官方服上线条件。Fly 是否作为长期官方宿主留待 [#219](https://github.com/arcadia-eternity/arcadia-eternity/issues/219) 实测决定，下一次部署前还要核对现有 Machine 地域及 `primary_region='hkg'` 的可用性。

以下变更仅修改仓库配置，不执行部署：

1. `fly.toml` 删除 Redis、邮件、gRPC 和集群环境变量；配置稳定 `SERVER_ID=arcadia-official`。
2. 仅保留 `/health` 健康检查，移除旧 `/metrics` 检查；设置 `auto_stop_machines='off'`、`min_machines_running=1`、`kill_signal='SIGTERM'`。
3. 使用 `rolling` 替换单个 Machine，允许该实例在更新时不可用。每次部署按约定丢弃房间。
4. 部署工作流在发现多个存量 Machine 时失败，由管理员安排维护窗口调整规模；加 `--ha=false` 避免创建备用实例。不会通过修改配置自动删除已有机器。

依据：[Fly 配置说明](https://fly.io/docs/reference/configuration/)与[部署参数](https://fly.io/docs/flyctl/deploy/)。本轮仅修改配置文件，尚未部署或验证生产环境。

# 单进程房间与身份

本轮落实 #200 的服务端基础重构，UGC 与具体账号提供商另行接入。

## 启动

```sh
pnpm install
pnpm build:prod
pnpm cli server --port 8102 --server-id arcadia-local
pnpm web:dev
```

也可以用 `docker compose up --build` 启动一个服务容器。无需 Redis、数据库、邮件、JWT 或 gRPC 配置。

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

游客不写数据库。可选 `AccountProvider.verify(proof)` 只负责验证外部证明并返回该服务器的 accountId；之后共用同一 Session/Seat 流程。账号、绑定身份及权限可由提供商持久化，不能从 UID 自动认领。当前默认启动入口只开放游客模式，未接入具体 OAuth、密码、邮箱恢复或账号数据库。

默认服务端不创建任何数据库记录。将来启用服务器账号时，才按需保存服务器范围内的 accountId、经验证的外部身份绑定及恢复方式；公开 UID 只是资料字段，不能成为账号归属证明。游客凭证、席位、房间、运行中的战斗和断线宽限都留在内存，不落库。UGC 内容及发布记录属于后续独立能力。

## 默认接口

- `GET /api/v1/server-info`：服务身份、启动身份、协议与能力。
- `POST /api/v1/sessions`：以 `{ profile: { id, name }, accountProof? }` 创建会话。
- `GET /api/v1/session`：使用 Bearer token 校验及恢复会话。
- `DELETE /api/v1/session`：撤销会话和原席位权限。
- Socket.IO 只接受 `auth.token`，每个受保护动作再次校验会话和成员资格。
- `GET /health`：进程健康检查。

旧集群、数据库 guest、邮件继承、排行榜、ELO、规则服务及恢复接口已经退出默认服务端。基础队伍合法性与显式房间选项由在线宿主负责。

旧数据库资产暂时保留在 `packages/database`：`players`、`player_stats`、`player_elo_ratings`、`battle_records`、`email_verification_codes` 的 SQL、仓库代码和迁移脚本仍可审计；本轮不运行迁移、不删除生产表或已有数据，也不将旧玩家记录自动认领为新服务器账号。旧 RLS 风险与历史数据处置继续由 #195 单独评估。

## 平台边界

本入口面向常驻 Node 容器，可部署在 Fly.io、Railway、Render、Zeabur 或 CloudBase 容器型云托管。部署时必须保持一个运行实例，关闭空闲休眠。平台可提供进程、TLS、WebSocket 入口、日志和健康检查；房间归属、会话权限、战斗裁决、计时、断线宽限和内存清理仍由本服务负责。静态网站托管只承载网页资源。

Sites 的 Workers 支持 HTTP 和 WebSocket，但不能直接运行此常驻 Node 入口。其 D1/R2 能保存结构化记录和文件，并不能恢复这里约定为停机即解散的内存房间；若以后以 Sites 运行权威对战，需要另做运行时适配和验收。参见 [Sites 能力](https://learn.chatgpt.com/docs/sites)与 [CloudBase 云托管能力](https://docs.cloudbase.net/run/introduction)。

## 验证

```sh
pnpm test:server-standalone
pnpm typecheck:server-standalone
pnpm lint:server-standalone
```

客户端/网页及真实浏览器验收见相应测试目录。`server-native` 命令保留为新验证入口的别名。

## 生产配置

`fly.toml` 和生产部署工作流按单实例运行时调整。**生产中若仍有多个 Machine，必须先安排维护窗口调整规模**。本地实现完成不代表生产部署完成。

以下变更仅修改仓库配置，不执行部署：

1. `fly.toml` 删除 Redis、邮件、gRPC 和集群环境变量；配置稳定 `SERVER_ID=arcadia-official`。
2. 仅保留 `/health` 健康检查，移除旧 `/metrics` 检查；设置 `auto_stop_machines='off'`、`min_machines_running=1`、`kill_signal='SIGTERM'`。
3. 使用 `rolling` 替换单个 Machine，允许该实例在更新时不可用。每次部署按约定丢弃房间。
4. 部署工作流在发现多个存量 Machine 时失败，由管理员安排维护窗口调整规模；加 `--ha=false` 避免创建备用实例。不会通过修改配置自动删除已有机器。

依据：[Fly 配置说明](https://fly.io/docs/reference/configuration/)与[部署参数](https://fly.io/docs/flyctl/deploy/)。本轮仅修改配置文件，尚未部署或验证生产环境。

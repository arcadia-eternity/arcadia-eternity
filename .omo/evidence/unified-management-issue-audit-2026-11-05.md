# Unified management issue audit — 2026-11-05

Publication follow-up: root approved this edit set, and all 21 existing issues were updated and independently reread on 2026-11-05. Exact verification and URLs are in `unified-management-issue-publication-2026-11-05.json`. The proposal text below records the pre-publication audit; no code-complete or new acceptance-pass claim was added.

This is a proposed issue-body edit set, not a GitHub mutation or acceptance report. Live bodies were read through the GitHub connector. The implementation checkout is `codex/unified-server-management` at base `8580fcf0` with ongoing uncommitted changes. No issue state, checkbox, label, priority, milestone or assignee should change.

## Current evidence supersedes this audit snapshot

Personal Challenge, online backup, desktop registered sources and durable import recovery were implemented after this audit. Final local tests and production-browser evidence are recorded in `unified-management-requirements.json` and `../../docs/v4/validation/unified-management-2026-11-05.md`. The old proposal and gap wording below are historical; live issues await the final commit/PR evidence refresh.

## Editing strategy

Update the existing `ae-unified-management-design-2026-11-04:<issue>` block in place. Add a short `### 实施合同补充（2026-11-05）` subsection there only where needed. For #273/#274 update their existing current-status paragraph and insert the compact subsection below. Keep historical evidence and already-accepted slices. Do not append another master architecture section to every issue.

Do not publish test counts from this draft without the root's final evidence reconciliation. Source presence means implementation exists; independent agent reports and local smoke evidence do not establish installed-platform, real-provider, remote CI, release or deployment acceptance.

Final handoff caveat from root: implementation agents stopped during integration. The desktop prepareProject call currently refers to a missing method, and durable import journaling/private Challenge have not landed. All proposed working-tree statements below mean partial work in progress, not a buildable or accepted whole. Keep these concrete gaps open and do not publish a new code-complete claim.

## Findings / direction map

| Direction                                              | Owning issue     | Acceptance       | Current audit                                                                                                                                                                                        |
| ------------------------------------------------------ | ---------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared SQL storage, account preservation, SDK removal  | #273, #220, #221 | #261, #272       | Implemented in working tree; existing issue still says SDK is current and all design is unimplemented. Real SQLite/PG contract reports exist; production migration/provider evidence pending.        |
| Owner workspace and immutable environment schema       | #214, #243       | #258, #266       | v2 schema, core, source adapters, author prebuilt packaging exist. Desktop nonempty sources integration still active at audit time.                                                                  |
| Published bindings, operations, runtime reconciliation | #244, #274       | #268, #264       | Core and tests exist; same-runtime rule changes need full matchmaking partition verification.                                                                                                        |
| Desktop own server / standalone deployment             | #209             | #259, #260, #262 | Shared owner/child path and network work active. Native platform workflow added; actual full installed-platform matrix remains pending.                                                              |
| Shared UI / immutable target contexts                  | #222, #274       | #259, #260       | Integrated; real paired production browser 9-flow smoke reported, extended QA active. Private arbitrary Challenge is separate.                                                                       |
| Environment transfer / original recovery / clone       | #217             | #258, #266, #262 | Environment transfers and offline server backup implemented; online maintenance backup still lacks API. Full dependency/media/machine matrix remains pending.                                        |
| Private Challenge / public peer matchmaking            | #224             | #264             | Published peer catalog path exists; unpublished personal environment Challenge still absent at audit. Public queue lane does not yet explicitly include all captured binding/version/rules identity. |

### Source evidence checked

- `packages/database/src/storage.ts`: Kysely; SQLite/PG; account relational tables plus versioned document collections; public-qualified PG management tables.
- `bin/server-config.ts`, `bin/server-persistence.ts`, `bin/server-admin-cli.ts`: persistent identity and driver config, readonly status, migration and ownership modes.
- `packages/content-dev/src/debug-environments.mjs`, `content-workspace.d.mts`, `managed-projects.mjs`, `managed-sources.mjs`: shared v2 schema, version/material/lease API, registered sources.
- `packages/protocol/src/management.ts`, `packages/server/src/standalone/management/{service,auth,operations,http,transfers}.ts`: actual wire contract, scope actions, sessions, retry/commit and transfer API.
- `bin/server-backup-cli.ts`, `bin/server-backup.ts`, `docs/v4/server-backup.md`: offline-only CLI, logical snapshots, identity/clone and PG-publication recovery.
- `packages/server/src/standalone/rooms.ts`: queue lane around line 693 currently descriptor ID + execution policy.
- UI owner reports `/private/tmp/ae-management-ui-artifacts-v3/result.json` contains 9 real production paired browser checks; extended checks ongoing. Not independently rerun in this audit.

## Exact proposed text

### #200 — replace first bold status sentence in its existing management block

**统一建服与管理正在实施，尚未完成整体验收。** Kysely 双库、内容工作区、共享管理 API/页面、持久绑定及离线备份已进入当前工作树；本轮仍在整合桌面来源获取、私人 Challenge、完整联机与故障矩阵。已有 Effect 逻辑复用、实体状态隔离、官方服务不执行第三方维护代码等决策保持。提交/CI/发行/部署状态分别按实际证据记录，不从工作树或局部测试推定完成。

Append two bullets to the same block:

- 补充两个独立策略：允许取得第三方内容不等于允许服务端执行；官方宿主只接收合规预构建产物并可公布 peer 环境，社区服显式允许后才可静态编译/权威执行。作者打包端生成封闭 Effect 产物，安装不运行作者脚本。
- #224/#264 继续区分“服务器已发布的 peer 环境”和“玩家未发布的私人 Challenge”；后者需要独立的房间引用与客户端准备协议。#217 的离线备份已有实现，在线维护窗口备份与完整恢复故障验收仍开放。

### #273 — replace stale current-source paragraph

当前工作树已用 Kysely + pg/better-sqlite3 实现共享存储，G3 迁入 SQLAccountDirectory；PgAccountDirectory 仅保留兼容入口。旧 Supabase SDK、旧 repository 和 Web 数据库类型依赖已在本轮移除。下方未完成清单保留：真实旧库处置、故障矩阵、正式桌面 native module、提供商与部署验收不能由代码替换直接勾选。

Add:

### 实施合同补充（2026-11-05）

- 账户/外部身份保留关系表；管理资源使用统一的 id/scope/revision/版本化 JSON 集合，业务服务在同一短事务中验证引用、权限并记录审计。revision 条件写入是两库共享并发边界；不把 JSON 内的关系误称为已有数据库外键。
- 部署身份保存在 data-dir/identity.json，并与 DB 服务器记录校验；重启保持，克隆重建。db status 为真正只读检查，不创建目录、库、identity 或租约；db migrate 才初始化/升级，拒绝无关或不兼容 schema。
- 单 owner 与维护锁按跨进程实现：正常服务期间可签发管理登录码，迁移/离线备份要求独占；身份不符必须在迁移前失败。PG search_path 不能改写管理表或迁移账本归属。
- 统一逻辑快照保留 ID/引用；PG 导入已提交而文件发布失败必须返回可恢复状态并保留 staging/intent，不能报成功或自动删库。真实双库合同与跨库往返已有局部证据，磁盘满、升级、真实生产旧数据验收继续开放。

### #274 — replace bold status sentence

**本单正在实施：共享协议、HTTP/IPC 服务、作用域授权、任务、绑定、账户管理及环境传输已进入工作树；完整产品和跨宿主验收继续开放。** 下方设计是当前合同，不把仍未交付的能力改写为已完成。

Add:

### 实施合同补充（2026-11-05）

- 公共 DTO 统一放 packages/protocol/src/management.ts；ManagementClient 捕获不可变目标，UI 同时使用目标代次与刷新次序丢弃迟到结果。capabilities 分开给出功能、权限和资源限制，不以 isAdmin/客户端形态决定权限。
- HTTP 前缀 /api/management/v1；管理登录为 session/bootstrap 或已授权本服账户的 session/account。浏览器使用独立 cookie + Origin/CSRF；自动化 bearer 仅接受可撤销的 service credential。CLI 登录码要求已初始化数据目录，正常 daemon 运行时仍可签发。
- 远程 TLS 由直接加密连接或明确登记的代理 IP + HTTPS publicOrigin + forwarded proto 共同确认；不信任客户端自报代理头。秘密只在明确签发时一次展示，不持久化到页面状态。
- 任务另含 committed、retryOf、rootOperationId 和 attempt；提交持久变更与应用运行映射之间保持 running，应用失败保留已提交事实。取消不撤销已提交效果；重试限于已定义、仍授权且版本匹配的操作。
- 环境 import/export/download/references 与服务器整体备份是不同合同。普通 JSON 请求、环境导入和下载有独立大小上限，导出文件有到期/下载租约；下载与回收竞争、含糊提交结果后的文件保留需验收。在线整体备份/维护排他仍开放。
- 已有共享页面和真实配套网页主流程的局部验证；正式桌面、真实登录提供商、私人 Challenge 与完整故障矩阵仍按关联 issue 推进，不据此关单。

### #214 — replace bold new-design status sentence, append 3 bullets

**共享工作区核心正在实施；下述目标及未勾选验收继续有效。**

### 实施合同补充（2026-11-05）

- ContentWorkspace 统一负责 draft/version、acquire/release、持久 retention、引用查询、对账和导入导出；桌面 owner 与独立服调用同一核心。固定材料只读，运行租约不跨重启恢复为活动对局。
- 服务端来源由宿主注册包名到 archive/directory/HTTPS URL/固定 Git commit，远程 API 只选择登记标识。桌面已有安装材料与 ManagedProjects 来源链路需落到同一个客户端 projects/workspace，不增加服务器包库副本。
- 当前桌面非空 sources 的获取/注册整合仍在进行；完整外部编辑、owner/child 异常、备份与 GC 竞争由 #266/#268 验收。

### #243 — replace bold unimplemented status sentence, append 3 bullets

**共享环境 schema 与准备管线正在实施，完整跨机/离线/兼容验收仍待完成。**

### 实施合同补充（2026-11-05）

- 环境文档定为 schemaVersion=2：id/name/packages/sources/rules/requires；v1 只读归一，不静默改写旧文件。rules v1 先支持 species/skills/marks 的 allow/deny、队伍数量与物种唯一性；未知能力/字段明确拒绝，不能只记录而不生效。
- 作者 pack 通过可信编译器生成 dist/arcadia-effects.json 并在暂存清单声明 arcadia.effectArtifact，源项目不被改写。官方接收路径采用 prebuilt-only，验证产物格式、包身份与封闭导入，不回退源码编译/模块求值；社区显式策略可选择静态编译。
- 标准 npm lock 记录实际解析组合；来源获取与执行授权分离。Git 固定提交、HTTPS 归档、ZIP/TGZ 和本地已构建目录进入同一校验链；来源/私有 registry 秘密不进入可移植环境。完整离线还需依赖与必要资源齐备，不能凭一个 tgz 或元数据准备成功判定。

### #244 — replace first bold new-design status sentence, append 3 bullets

**持久绑定、发布与恢复正在实施；下方已交付的 Worker 逻辑复用继续有效，完整生命周期验收仍开放。**

### 实施合同补充（2026-11-05）

- executionPolicy 明确为 server 或 peer，并独立于 visibility/default/matchmaking；peer 发布只提供固定材料与信令/中继，不启动服务端第三方 Effect Worker。
- binding 发布保留 desired/effective、候选 retention 与 durable intent。DB 提交后 runtime apply 才结束任务；重启核对当前材料和执行政策，缺失候选保留旧有效版本并报告 degraded，不把旧运行句柄/会话带回。
- 队列隔离键必须覆盖捕获的 binding、固定版本、rules 和执行策略；不能只用底层内容运行句柄。特别补充“仅规则变化、底层包不变”的更新测试：旧队列不得与新规则条目拼局，已有房间继续原合同。

### #224 — append within existing current management/admission block

### 私人 Challenge 的具体合同（2026-11-05，继续实施）

服务器发布的 peer 环境、公共匹配目录与私人 Challenge 是三条不同路径。前两者已有工作树实现；当前 createPrivateRoom 仍依赖服务器已登记环境，不能据此宣布私人自选环境完成。

- 私人房间引用固定的环境 offer/ref、兼容要求与执行策略；房间权限只授予该邀请/席位的使用，不创建服务器 public/default/matchmaking binding，不授予工作区管理权。
- 固定引用须与 publishedBinding 明确区分，复用既有 lock/准备身份，不新增逐文件哈希门槛；选择或宿主变化时清除旧 Ready 确认，重新协商后才能开局。
- 邀请者与加入者分别在客户端准备同一固定材料，并在 Ready/Start 提交接受的环境/执行材料修订。客户端来源获取走既有校验链，房间消息只携带引用/版本/能力信息，不传归档、作者脚本或安装命令；信令服不据玩家 URL 下载/安装。
- 首期私人 UGC 使用玩家沙箱宿主；不支持材料或沙箱时明确拒绝开局，不回退官方服务器执行。离房/重连/宿主断线遵循已定义生命周期，不能暗中换宿主或换新环境。
- #264 补真实两客户端私人未发布环境、不同合法队伍、缺包/版本差异、网络重载与服务器无作者执行证据；公共队列仍只接受发布目录。

### #209 — replace new-design status sentence, append 3 bullets

**本机托管与持久配置正在实施，正式发行和真实 LAN 场景继续待验收。**

### 实施合同补充（2026-11-05）

- 桌面父进程持有唯一内容 owner，子进程通过私有通道借用固定材料；稳定 serverId/配置与 bootId/实际监听端口分开。启动返回 ready 前不得把 DB 配置显示为在线。
- 监听配置与能力由可信桌面 owner 控制；独立服仍由外部 supervisor 启停。设置保存后明确区分立即生效与待重启字段，保持可信 renderer 所需 origin，不因扩大监听范围暴露私有 IPC。
- 新增非发布的 native/packaging CI 覆盖 macOS arm64/x64、Linux x64、Windows x64；工作流存在和本机运行均不能替代其成功运行、实际安装、跨版本升级与数据保留证据。

### #217 — replace new-design status sentence, append 4 bullets

**环境传输及离线服务器备份/恢复/克隆已进入工作树；在线一致性维护及完整交付验收继续开放。**

### 实施合同补充（2026-11-05）

- 环境交付采用 arcadia.environment-export/1；源草稿备份、工作区 snapshot 和服务器备份继续分离。环境 import/export 为有权限、可查询/取消/重试的操作，下载产物有期限，不能通过文件句柄绕过撤权。
- server backup create/inspect/restore/clone 当前为离线 CLI；create 取得 owner/维护排他，restore/clone 只向不存在的目标目录暂存并发布。原服恢复保留身份与账户/授权，但旧会话/凭证全部失效；克隆重建身份并排除账户/授权/历史。
- 恢复按当前宿主 prebuilt-only 政策重新验证，备份里的执行政策不能提升当前主机权限。PG 数据已提交而目录发布失败时保留恢复目录/intent，明确人工恢复路径；不自动回滚到删库。
- 原设计的在线短维护窗口仍须实现：排除账户/config/prepare/publish/GC 写入后捕获一致视图。现有环境导出 API 或离线备份不算此项完成。

### #220 — replace first bold new-design status sentence, append 2 bullets

**统一存储和管理授权适配正在实施；已有 G3 证据保留，真实提供商验收仍未完成。**

### 实施合同补充（2026-11-05）

- SQLAccountDirectory 对两库使用同一身份/绑定/停用规则；管理账户列表按 serverId 分页，停用与审计原子提交，并撤销游戏会话和关联管理会话。失败的房间清理可重试，不重新激活账户。
- G3 账号兑换管理会话前仍须显式 scope 授权；guest owner、服务 token 和玩家账户不混用。SQLite/PG、重启/迁移/克隆的身份语义保留，真实 SMTP/GitHub 登录、恢复与回调仍归 #261。

### #222 — replace new-design status sentence, append 2 bullets

**共享管理页面已进入工作树并完成部分真实配套网页验证；桌面和完整目标/权限场景继续验收。**

### 实施合同补充（2026-11-05）

- 复用 EnvironmentWorkspace/ServerSettingsForm，管理页展示环境草稿/固定版本、desired/effective binding、任务、引用、账户/授权及一次性服务凭证。导入先预览确认，权限或资源限制解释与操作结果同源。
- 管理 context 捕获 endpoint/server/workspace/credential 身份；目标切换清空待导入文件和一次性秘密，迟到响应不能覆盖当前视图。当前刷新策略为活动任务约 1 秒、空闲约 4 秒、隐藏页退避；不会取消已提交后台任务。
- 服务器公开 peer 环境入口不等于私人 Challenge 入口；后者与服务器邀请、公共匹配分别显示，依 #224 完成后再验收。

### #221 — append 2 bullets to existing retirement block

- 当前工作树已清理旧 Supabase SDK/repositories/部署 service key 指引、Web 数据库类型依赖，并更新 CLAUDE.md 的 V4/工作区/构建测试说明；保留历史 SQL 的明确用途，不把删除旧模块等同于迁移了用户数据。
- CI 复用既有 PostgreSQL job 验证双库及管理/CLI，浏览器 job 因真实 server runtime 间接依赖数据库仍被相关改动触发。新增桌面 native/packaging 工作流不发布；CI 配置检查与实际 CI/正式发行结果分开记录，用户数据验收 #272 保持开放。

## Acceptance issue targeted additions (all unchecked)

Insert these into the existing 2026-11-04 checklist, not a second matrix.

### #258

- [ ] 作者真实 tgz 的封闭 Effect 产物在无源码/无开发依赖机器通过 prebuilt-only；无产物或导入不封闭时拒绝，且没有安装脚本/作者模块执行。
- [ ] 桌面与独立服使用同一 registered-source/lock 合同；来源变更产生新版本，离线缓存缺依赖、媒体为外链、签名 URL 失效分别给出可定位结果。

### #259

- [ ] 新 desktop-runtime-validation 工作流四个平台组合实际成功后，继续验证安装、首次运行、跨版本升级及原数据保留；仅打包/运行 smoke 不替代安装升级。
- [ ] 打包内 SQLite native module 与 Electron ABI 匹配；真实桌面来源获取、同 workspace 开服、监听变更重启及远程窗口 IPC 隔离完整通过。

### #260

- [ ] 干净宿主复现 db migrate → admin login-code → 配套网页一次性登录 → 来源准备 → 发布/default → 普通玩家对战；分别记录 SQLite/PG 和原始发行物身份。
- [ ] 区分目前本机 production paired-site smoke 与实际干净机器/模板部署；公开 peer 环境与私人 Challenge 按各自能力验收，不以一条路径代替另一条。

### #261

- [ ] 在真实 SMTP/GitHub 提供商下验证账户停用导致游戏/管理会话同时失效；恢复后 accountId 不变，最后凭据保护和 scope 授权仍有效。
- [ ] 数据库/provider fixture、UI mock 与一次性 owner bootstrap 通过不代替真实供应商回调、邮件投递及重启恢复。

### #262

- [ ] 非回环管理请求的直接 TLS、登记代理 TLS、伪造 X-Forwarded-Proto、错误 publicOrigin/CORS 分别验证；只有明确代理地址可信。
- [ ] 在线备份维护窗口必须确实暂停所有相关写入；离线 CLI 已有逻辑备份不勾选在线能力。PG import commit 后发布目录失败保留可恢复材料，并能按操作指引完成恢复。
- [ ] db status 对空/已有 SQLite 目录字节无副作用；身份不符、无关 schema、另一个活 owner 时，迁移/启动/备份按各自模式拒绝。

### #264

Replace the current generic private Challenge checklist item with:

- [ ] 两个真实客户端用未发布到服务器目录的私人环境约战：各自完成固定材料准备、不同合法队伍 Ready/Start；缺包/能力不符/版本差异明确阻止，无服务端第三方代码执行，也不能借此进入公共匹配。

Add:

- [ ] 同 binding 仅 rules 改变且底层包/运行句柄不变时，旧/新队列仍分开；已有房间、再开局和重连使用捕获版本，不被更新悄悄替换。
- [ ] 服务器已发布 peer 环境的两浏览器对战与私人 Challenge 分别记录；沙箱材料加载/宿主中断/离房取消的失败不能遗留悬挂队列或跳转旧目标。
- [ ] 分别记录房间 WebSocket 协商消息与房间外静态材料 HTTP 获取：前者不传代码/归档，后者按既定政策提供固定材料；不能混淆网络口径。

The old bottom phrase “不扩展为浏览器 P2P UGC” is superseded by the current top decisions. Replace its current prerequisite sentence with: “私人自由 Challenge 尚待 #224 的独立环境引用与准备协议；已发布 peer 环境可先验收。” Preserve the old implementation evidence.

### #266

- [ ] 已提交但响应不明的环境导出操作仍可找回完整产物；下载 lease 与到期 GC 竞争不能删正在使用的文件；到期以公开 expiresAt 一致判定。
- [ ] 原服 restore 与 clone 的引用映射完整；PG commit/目录 publish 中间失败保留恢复 intent，源数据和已有目标均不被破坏。
- [ ] 桌面 author 已安装材料复用与 registered sources 准备共享单 owner，外部编辑/进程死亡不会让旧产物失去引用保护。

### #268

- [ ] binding.publish 在 DB commit 与 runtime apply 间中断/失败：操作保留 committed 事实，取消不伪装回滚；重启按 durable intent 收敛有效映射与候选保留根。
- [ ] 仅规则变化、follow-ready 乱序完成、权限撤销和运行材料缺失覆盖队列/现有房间/新房间三种观察结果，不能只验证底层 contentRevision。

### #272

- [ ] 检查实际发布产物及部署文档没有 Supabase SDK/service key 与浏览器 DB 入口；本地源码删除或 lockfile 更新不替代产物扫描。
- [ ] 数据保留说明分别覆盖历史公开 players/录像与现行 arcadia_auth；旧模块删除不自动认领历史账号，生产真实数据的只读导出/处置须有独立记录。

## Publication handoff

No GitHub writes performed. Recommended first mutation batch: #200/#273/#274/#224, then owning direction blocks, then only the targeted acceptance checklist deltas. Immediately before mutation reread live bodies and replace by marker/current paragraph to preserve concurrent edits. Keep all states and checkboxes unchanged; root may add final commit/test links only after their existence is verified.

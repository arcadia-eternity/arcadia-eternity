# 可选账号提供商设计

状态：G3 设计及实施依据。两条登录／恢复路径为**邮箱一次性验证码 + GitHub App 用户授权**；GitHub 是唯一第三方登录提供商，原通用 OIDC 不在运行配置中。[#235](https://github.com/arcadia-eternity/arcadia-eternity/pull/235) 已合并 G3 基础实现，本轮按 [#237](https://github.com/arcadia-eternity/arcadia-eternity/issues/237) 接入 Better Auth 1.7.12 验证层。真实 SMTP 和 GitHub 登录仍未验收；维护者于 2026-10-24 免除了它们对 #235 合并的阻塞，并非验证通过。本文保留提交 `c09d044d` 的旧账号实现调查；只读核对过现有 Supabase 项目的表清单，没有读取玩家记录、执行迁移或部署。G4 排位及战绩、在线录像分别留在 [#233](https://github.com/arcadia-eternity/arcadia-eternity/issues/233) 和 [#234](https://github.com/arcadia-eternity/arcadia-eternity/issues/234) 后期实施；UGC 不在本轮范围内。

## 旧系统实际提供了什么

旧系统没有通用账号提供商，也没有 OAuth/OIDC。`players.id` 同时充当本地玩家 UID 和数据库主键；每个游客在 `players` 中建一行，但不取得能证明该 ID 归属的凭据。邮箱验证码可把一行 `players` 标记为已注册，之后按该邮箱找回玩家 ID 并签发自有 JWT。Supabase 在这里主要是 PostgreSQL 数据库，而非登录提供商。

- [旧游客接口](https://github.com/arcadia-eternity/arcadia-eternity/blob/c09d044d45b45160a16bc8e13609435496f28b31/packages/server/src/app/routes/authRoutes.ts#L94-L125)创建数据库玩家，但[旧 `smartAuth`](https://github.com/arcadia-eternity/arcadia-eternity/blob/c09d044d45b45160a16bc8e13609435496f28b31/packages/server/src/app/middlewares/smartAuthMiddleware.ts#L28-L83)对未注册玩家直接接受请求中的 `playerId`；不能继承“报出 UID 即有权操作”的判断。
- [旧邮箱路由](https://github.com/arcadia-eternity/arcadia-eternity/blob/c09d044d45b45160a16bc8e13609435496f28b31/packages/server/src/app/routes/emailInheritanceRoutes.ts#L443-L596)负责邮箱验证码绑定与恢复，[旧 `AuthService`](https://github.com/arcadia-eternity/arcadia-eternity/blob/c09d044d45b45160a16bc8e13609435496f28b31/packages/server/src/domain/auth/services/authService.ts)签发 JWT。可保留“凭独立证明恢复”的产品语义，凭证实现必须重做。
- [`players.email`](../../packages/database/sql/01_create_tables.sql)唯一且与 `is_registered` 绑定，没有外部身份表；邮箱不应继续占据通用账号模型的中心。
- [旧 `petStorage.ts`](https://github.com/arcadia-eternity/arcadia-eternity/blob/c09d044d45b45160a16bc8e13609435496f28b31/packages/web-ui/src/stores/petStorage.ts#L165-L279)把宠物队伍保存在浏览器 `localStorage`；旧“找回玩家 ID”并不等于恢复本地宠物或队伍。

旧验证码由 `Math.random()` 生成并以明文保存，使用过程是先查询、后标记；旧 JWT 撤销使用进程内集合。仓库中的旧 RLS 策略还包含 `auth.uid() IS NULL` 放行写入的条件，[#195](https://github.com/arcadia-eternity/arcadia-eternity/issues/195)也提出了相关疑问。这是源码风险，不能据此断言生产数据库已经部署了同样的策略。旧 SQL、旧 JWT 和旧验证码实现均不能直接接回新服务端。

## 官方数据库与不接 OAuth 的登录

官方服务器沿用现有 **Supabase PostgreSQL**，新账号目录只在同一数据库增加私有 `arcadia_auth` schema。Supabase 在此首先是数据库托管方；G3 当前的邮箱验证码由服务端发送和核销，GitHub App 用户授权由服务端交换授权码并读取 GitHub 用户 ID，尚未把 Supabase Auth 当作登录提供商。旧 `public.players`、旧邮箱验证码和 `auth.users` 都不会自动转换成 `arcadia_auth.accounts`。`DATABASE_URL` 只给服务端，不能用浏览器 key 或 service-role key 代替；账号表不对 [Supabase Data API](https://supabase.com/docs/guides/api/using-custom-schemas) 暴露。常驻服务可使用 [Postgres 直连或 session pooler](https://supabase.com/docs/guides/database/connecting-to-postgres)，取决于宿主是否支持 IPv6。

不接外部 OAuth 也可以提供完整的注册、登录和找回流程。成熟系统采用的形式不同，但都把凭证与公开用户编号分开：

| 参考系统                                                                                              | 无外部 OAuth 时的做法                                                                                                                                                                                             | 对本项目的启示                                                     |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [Supabase Auth](https://supabase.com/docs/guides/auth/auth-email-passwordless)                        | 邮箱 OTP 或 Magic Link；首次验证可自动注册，也可用 `shouldCreateUser=false` 限制为既有用户                                                                                                                        | 邮箱控制权可以同时承担注册和登录，但“能收到邮件”不等于持有本地 UID |
| [Keycloak](https://www.keycloak.org/docs/latest/server_admin/index.html)                              | 本地账号可自助注册或由管理员创建；邮箱确认、密码及忘记密码流程分别配置                                                                                                                                            | 私服可以关闭开放注册，采用邀请或管理员准入，不必另造 OAuth 提供商  |
| [GitLab Self-Managed](https://docs.gitlab.com/administration/settings/sign_up_restrictions/)          | 本地密码账号可限制注册、要求审批，并提供[密码重置](https://docs.gitlab.com/user/profile/user_passwords/)；其[恢复代码](https://docs.gitlab.com/user/profile/account/two_factor_authentication/)只用于恢复第二因素 | 公开注册必须考虑滥用与密码找回；第二因素恢复代码不是独立登录方式   |
| [Synapse](https://element-hq.github.io/synapse/develop/usage/configuration/config_documentation.html) | 可关闭公开注册；开放时建议邮箱验证、CAPTCHA 或注册令牌，并对注册限流                                                                                                                                              | “任何人填一个用户名就注册”不足以承担可找回的持久账号               |

Arcadia 的无 OAuth 注册可复用当前邮箱流程：玩家提交邮箱，服务端发送短时一次性验证码；验证通过后，账号目录按 `(serverId, providerId='email', issuer='mailto', subject=address)` 找到账号或原子创建新账号。以后用同一邮箱验证码登录。注册与登录可以共用“继续使用邮箱”入口，避免预先暴露某个邮箱是否已有账号；开放注册时还需要邮件发送配额、跨重启限流或准入控制。当前 G3 的邮箱限流只在内存中，故官方服公开上线前还要补强。

**只有邮箱一条路径不能满足本分支选定的 G3 双路径验收。** 当前第二条为 GitHub App；如果以后完全不接外部 OAuth，可将第二条做成 WebAuthn 通行密钥或独立密码凭据，并实现注册、绑定、丢失设备后的恢复和停用撤权。一次性恢复代码可以辅助找回，但不能直接把 GitLab 的第二因素恢复代码算成独立登录方式，也不能把“管理员临时帮忙找回”伪称为已经可用的第二条玩家登录路径。直接采用 Supabase Auth 的邮箱/密码功能也是备选，但属于新的验证器适配：服务端要核验其令牌，把 Supabase 用户 ID 映射为外部身份，仍由 Arcadia 账号目录决定本服 `accountId`。尤其要审查 Supabase Auth 的[同邮箱自动关联身份](https://supabase.com/docs/guides/auth/auth-identity-linking)行为，不能让它绕过 Arcadia 的显式绑定和冲突规则。

GitHub App 的用户授权是 OAuth 授权码流程，**不返回可当作身份凭证的 OIDC ID Token**。服务端使用 GitHub App 的 Client ID 和 Client Secret 交换授权码，仅以短期用户访问令牌调用 [`GET /user`](https://docs.github.com/en/rest/users/users#get-the-authenticated-user)，将响应中的稳定数字 `id` 转为 subject；`login`、昵称及邮箱都不能当作账号键。GitHub App 用户访问令牌读取 `/user` 不需要额外的细粒度权限，因此当前实现**不申请 Email addresses 权限，也不请求 `user:email` OAuth App scope**。若将来产品确实需要读取 GitHub 邮箱，应在 GitHub App 中申请 **Email addresses: Read-only** 并调用 [`GET /user/emails`](https://docs.github.com/en/rest/users/emails#list-email-addresses-for-the-authenticated-user)，但仍不能凭相同邮箱自动合并 Arcadia 账号。GitHub App 的权限在应用登记时设定，授权请求通常不带 OAuth App 的 scopes；[GitHub App 授权文档](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)仅允许特殊的 `offline_access` scope。本轮不需要它，也不保存 GitHub token 或接入仓库安装权限。

## 拟定的身份模型

| 名称             | 含义与权限                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| 本地资料 UID     | 客户端创建、应支持备份导出的公开资料标识。知道或导入 UID 不构成所有权证明。                                    |
| 外部身份         | 提供商验证后得到的 `(provider, issuer, subject)`；昵称和邮箱展示值均不能代替稳定 subject。                     |
| 服务器账号       | 某个 `serverId` 范围内的持久 `accountId`，可绑定多个经验证的外部身份。                                         |
| 账号登录凭据     | 提供商证明或账号服务签发的设备凭据，用于取得新的服务器会话。它与房间席位凭据分离。                             |
| 服务器会话与席位 | 当前 `bootId` 下的短期 token、sessionId 和 seatId。只有有效 token 加房间成员资格才能操作对战；重启后全部失效。 |

网页、Electron、静态托管页面和 CLI 是运行宿主，不各自拥有一套账号。某个宿主若能提供服务端可验证的身份票据，可以增加相应提供商适配器；没有该能力时仍可使用游客模式或其他登录方式。

提供商只验证凭据并返回外部身份，不能自行决定本服务器的 `accountId`。账号目录原子地将外部身份映射到服务器账号。账号认证服务负责编排两者；`SessionRegistry` 只接收内部已经确认的 principal，签发本次进程的 token 和席位。当前的 `AccountProvider.verify(proof) -> accountId` 把验证、落库和会话接入混在一起，适合占位，不适合作为最终多提供商接口。

```
本地 UID（展示、导入导出） ─────────────────────────────┐
游客 ──────────────────────────────────────────────┤
提供商证明 → 验证 issuer + subject → 本服 accountId ──┤→ 本次会话 token → 房间 seatId
```

服务器能力查询应公布可用提供商及登录方式；发起/完成邮箱验证码、GitHub App 授权回调或以后新增的平台票据交换由具体适配器实现。适配器按各自协议完成验证与防重放，`issuer` 由服务端固定为受信提供商标识，而不是接受客户端自报。当前 GitHub 身份键为 `(providerId='github', issuer='https://github.com', subject=<GitHub 数字用户 ID>)`；邮箱验证码适配器把规范化后的、**当前可接收邮件的地址**作为 subject，这种控制权可能随邮箱回收而转移。客户端不能直接提交 `accountId`、自称的 `issuer` 或 UID 来登录。提供商返回的昵称只能作为资料建议，不能悄悄覆盖本地档案。

## 适配器与编排边界

接口以职责表达；具体请求类型由各提供商定义，不强迫邮箱、GitHub App 和宿主平台共用一种原始 proof 格式。只有服务器内部能构造 `VerifiedIdentity`；外部请求中的同名字段一律不可信。

```ts
type AuthIntent = { kind: 'login' } | { kind: 'link'; accountId: string; sessionId: string } // 由当前有效会话生成

interface VerifiedIdentity {
  issuer: string // 适配器按服务端配置核验或给出
  subject: string // 按该提供商契约识别身份；邮箱仅代表当前邮箱控制权
  verifiedAt: number
}

interface VerifiedIdentityKey extends VerifiedIdentity {
  providerId: string // 认证服务从已配置的适配器取得
}

interface IdentityVerifier {
  readonly providerId: string
  begin?(intent: AuthIntent): Promise<unknown> // 邮箱、GitHub App 等多步流程
  verify(proof: unknown, intent: AuthIntent): Promise<VerifiedIdentity>
}

interface AccountDirectory {
  resolveOrCreate(serverId: string, identity: VerifiedIdentityKey): Promise<{ accountId: string }>
  link(serverId: string, accountId: string, identity: VerifiedIdentityKey): Promise<void>
}
```

`VerifiedIdentityKey` 是认证服务从**已配置的** `providerId`、**已核验的** `issuer`、`subject` 构造的内部值。认证服务提供 `login(providerId, proof)` 和 `link(currentSession, providerId, proof)`；它先调用适配器，再调用账号目录。`SessionRegistry` 不查询提供商或账号库，只保留 `createGuest(profile)` 和仅供内部调用的 `createAuthenticated(profile, accountId)`。对外登录接口从当前的裸 `accountProof` 改为明确的提供商选择和该提供商的交换流程；服务器能力查询也从 `authModes` 扩充为提供商与流程清单。账号模式启用时必须显式配置稳定的 `SERVER_ID`，不能依赖按监听地址生成的默认值。

验证器的界限是“证明玩家此刻控制该外部身份”。GitHub App 按[用户授权码流程](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)携带随机 `state` 和 S256 PKCE；授权入口要求浏览器的 `Origin` 位于服务端允许列表，再由服务端将它确定性映射为该网页的精确 `/account` 回调。回调地址必须同时在 `GITHUB_APP_REDIRECT_URIS` 和 GitHub App 登记页中，浏览器既不能提交任意回调地址，也不能在交换授权码时换用另一个地址。授权码回到网页 `/account` 后，由发起登录的同一标签页提交回调码、`state` 和仅该标签页保存的挑战秘密，服务端核对用途、挑战、有效期并一次性消费，再以同一回调地址交换授权码和调用 GitHub `/user`。它**不验证不存在的 ID Token，也不把 GitHub access token 发给浏览器或保存到账号库**。邮箱流程需要密码学随机验证码、固定邮箱规范化规则、限流和一次性核销。绑定身份比普通登录多一个要求：验证流程必须由当前账号会话发起，挑战或回调状态绑定 `link` 用途与该 `accountId`，完成时再次核对会话；不能把一次登录证明拿来绑定别的账号。无法提供新鲜、用途绑定证明的适配器暂不开放绑定功能。

验证**可能写状态**，但只能写其自身的短期挑战记录：验证码尝试数与消费状态、GitHub `state`/PKCE verifier 等。它不能写 `accounts`、`external_identities`，也不能返回自己指定的 `accountId`。认证服务负责把验证结果交给账号目录；验证失败或账号库不可用均不得自动降级为游客。

### Better Auth 验证层接入（1.7.12）

Better Auth 已作为运行时依赖承担外部身份验证中的通用步骤，账号归属和对战权限仍由 Arcadia 管理：

| 层                 | 实现与职责                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 邮箱证明           | [`betterAuthEmail.ts`](../../packages/server/src/standalone/providers/betterAuthEmail.ts) 在服务端内部调用真实 `emailOTP` 插件的 `createVerificationOTP`、`verifyEmailOTP`；Better Auth 负责生成、尝试次数及一次性核销，并通过自定义存储摘要钩子使用进程随机密钥计算 HMAC。每个挑战使用仅存内存的验证专用身份，不是玩家账号。                               |
| 验证用途和邮件投递 | [`email.ts`](../../packages/server/src/standalone/providers/email.ts) 维护真实收件人与挑战的映射、邮箱规范化、登录／绑定用途、限流、清理及同一挑战的串行核销。                                                                                                                                                                                              |
| GitHub 证明        | [`github.ts`](../../packages/server/src/standalone/providers/github.ts) 使用 `better-auth/social-providers` 的 `github().createAuthorizationURL()` 生成 S256 授权请求，并使用 `better-auth/oauth2` 的 `authorizationCodeRequest`、`getOAuth2Tokens` 构造和解析授权码交换。Arcadia 保留超时、拒绝重定向、上游限流退避、仅读取 `/user.id` 和短期 token 撤销。 |
| 持久账号           | [`PgAccountDirectory`](../../packages/server/src/standalone/accounts/directory.ts) 是唯一账号目录，在 `serverId` 范围内处理外部身份唯一归属、多个邮箱的显式绑定、冲突、最后一种恢复方式保护和停用。                                                                                                                                                         |
| 游戏会话           | [`SessionRegistry`](../../packages/server/src/standalone/session.ts) 签发当前 `bootId` 下的 token 和席位；重启后全部失效。                                                                                                                                                                                                                                  |

不挂载 Better Auth 的完整社交登录、邮箱登录或 `/api/auth/*` 路由，不签发其 session/cookie，也不建立第二套持久用户表。邮箱证明使用验证接口，不使用会创建用户会话的 `signInEmailOTP`。因此 GitHub 展示的邮箱不会成为隐式恢复入口，多个邮箱也不受 Better Auth 单个 `user.email` 的限制。浏览器仍通过既有 `/api/v1/auth/*` 流程取得 Arcadia 会话。

此次接入不要求新的部署密钥、schema、数据库迁移、GitHub App 权限或回调变更；官方回调仍为 `https://battle.yuuinih.com/account`。内置 GitHub 完整用户流程涉及邮箱读取和注册语义，因此这里只复用其授权与 OAuth 公共 API，继续不申请 `user:email` 或 Email addresses 权限。源码依据及原配置草稿的替代说明见[接入记录](../../design/better-auth-github/README.md)。真实 SMTP、GitHub 回调联调和官方部署仍待后续验收。

## 落库操作及一致性

账号目录是唯一改动账号归属的模块。完整账号模式必须持久保存前两张表；第三张是验证器按所选证明方式使用的短期状态：

| 表                        | 必要字段                                                                      | 数据库约束                                                                |
| ------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `accounts`                | `server_id`, `account_id`, `status`, `created_at`                             | 主键 `(server_id, account_id)`                                            |
| `external_identities`     | `server_id`, `provider_id`, `issuer`, `subject`, `account_id`, `linked_at`    | 唯一 `(server_id, provider_id, issuer, subject)`；复合外键指向 `accounts` |
| `auth_challenges`（可选） | `server_id`, `challenge_id`, `provider_id`, `purpose`, 过期、次数、消费等字段 | 短期验证状态；由验证层管理，和账号归属表分开                              |

`subject` 及 `issuer` 都不得为空，长度、编码和提供商配置必须校验。单实例首版可把短期挑战放内存，随 `bootId` 失效；这要求重启后重新申请验证码。若要跨重启保留挑战、持续限流或扩展多实例，才把 `auth_challenges` 放入数据库或支持原子操作的共享存储。无论用哪种存储，都要记录用途及绑定账号/会话、到期时间、尝试数、消费时间；低熵邮箱验证码不能明文保存，也不能仅用无密钥的普通哈希，应保存带服务器密钥的摘要并原子限制尝试和消费。挑战不是账号所有权记录；邮件发送频率还需跨重启限流或依赖邮件服务的配额。若使用 Supabase/Postgres，账号表应在不向浏览器直开的私有访问边界；若确实暴露到 Data API，必须同时配置最小权限和匹配所有权语义的 RLS，不能复用旧匿名写入策略。

一次**首次登录**按此顺序执行：验证证明并消费一次性挑战；以复合外部身份查找账号；不存在时在**同一短事务**中新建 `accounts` 行和身份映射；检查账号仍启用；提交成功后才签发内存会话。两个首次登录并发时由数据库唯一约束仲裁：输的一方整体回滚新账号，再读取胜方映射；不能只插账号而留下孤儿。已有身份通常只读查询，不必每次登录都写 `last_login`。网络上的提供商验证和邮件发送都发生在账号事务外，以免长时间持锁。[PostgreSQL 的唯一约束](https://www.postgresql.org/docs/current/ddl-constraints.html)和 [`ON CONFLICT` 语义](https://www.postgresql.org/docs/current/sql-insert.html)可支撑这一并发边界。

一次**绑定**要有当前有效的账号会话和绑定专用的新鲜证明。账号目录在事务中检查账号状态、目标身份是否已有归属，再插入唯一映射；已属于同一账号可幂等返回，属于另一账号报冲突，不按邮箱、昵称或本地 UID 自动合并。解绑时也须在事务中保证账号至少保留一种恢复方式。停用账号先提交状态变化，再撤销该账号在当前进程中的所有会话和房间权限；并发签发与停用需要账号级串行化或版本栅栏，避免停用后又产生有效 token。

外部证明消费和账号事务无法与外部平台组成一个原子事务。若验证码已消费、随后账号库故障，用户重新请求验证码；已经消费的码不能恢复可用。账号库提交成功而会话签发失败时，新账号可以存在，但下次凭相同外部身份登录必须解析到它。无效证明返回认证失败、已有其他账号绑定返回冲突、限流和基础设施故障各有明确错误；当前把所有 provider 异常压成 401 的处理不应延续。账号登录失败绝不悄悄变为游客登录。

## 两条路径与恢复

1. **游客**：本地 UID 加服务器临时会话。默认自托管服务无需数据库。两个客户端即使报告相同 UID，也获得不同的 guest principal、token 和 seat。没有备份、没有账号、也没有其他控制权证明时，丢失本地资料无法安全地由服务器找回。
2. **账号**：服务端验证提供商证明，解析或新建本服账号，再签发当前进程的会话与席位。服务器重启会解散房间，但持久账号和外部身份仍在；玩家重新认证后取得**新**席位，不继承旧房间。
3. **游客升级**：必须由玩家明确发起，并同时拥有当前会话和新的提供商证明。登录账号不自动把正在对战的席位转移给新会话；首版可要求结束或退出房间后切换。公开 UID 不能用来认领既有服务器资产。
4. **绑定第二个提供商**：要求已认证的账号会话和新提供商的新鲜证明。`(serverId, provider, issuer, subject)` 只能属于一个账号；同邮箱、同昵称不自动合并。若已属于别的账号，拒绝并走单独的冲突处理。
5. **跨设备恢复**：提供商登录可恢复该服务器确实保存的账号资料。若产品要帮助用户找回本地 UID，可在用户明确启用备份时把 UID/昵称作为账号下的资料副本；这只是该账号保存过的资料，不是全球 UID 归属证明。宠物/队伍目前仍为本地数据，需文件备份或将来的独立云同步才能恢复。

对外展示应区分“自报 UID”和“本服务器已验证账号”，避免盗用公开 UID 造成社交冒认。默认不允许解绑最后一个可恢复身份，也不自动合并账号。停用账号时应立即阻止新登录，并撤销本进程中该账号已有的会话；这要求会话注册表能按 `accountId` 查找或检查账号状态。

## 仅在启用账号时持久化

- `accounts`：`serverId`、内部 `accountId`、状态和创建时间。
- `external_identities`：`serverId`、`providerId`、由服务端确定的 `issuer`、稳定 `subject`、`accountId`、验证时间；唯一约束防止双重绑定。
- 可选的提供商挑战记录。单实例可以内存保存；若持久化，邮箱验证码只存带服务器密钥的摘要、用途、过期时间、尝试次数和一次性消费状态，并原子消费；同时限制目标地址和来源的发送/验证次数。
- 若需要跨重启免重复登录，可另存经哈希和轮换的设备凭据或使用提供商自身的续期能力。它不能充当房间 token。
- 用户选择启用的账号资料备份，以及将来确实需要归属的内容引用；不能从 UID 自动推导归属。

游客会话、席位、房间、对战运行状态、断线宽限和快照仍不落库。若坚持无数据库又要稳定账号，可以由单个已验证外部身份和服务器持久密钥派生 ID，但这种模式不能可靠支持多提供商绑定、撤销、账号合并或资料备份，不应宣传为完整账号系统。

## 旧数据处置与实施顺序

旧数据库资产先保持只读、备份并盘点。旧未注册 `players.id` 没有可靠所有权证明，不能按 UID 自动迁移。已绑定邮箱的旧记录，也必须在**重新验证邮箱**且审查重复/异常记录后，才考虑以一次性迁移别名关联新 `accountId`；旧玩家 ID 不直接充当新账号 ID。旧 RLS 的生产实际状态需要单独核查。排位、ELO、旧战报不进入本轮新账号数据库，也不在本设计中删除历史数据。

建议按以下顺序实现：

1. 定义提供商验证结果、账号目录和显式绑定/冲突语义；默认部署继续 guest-only。
2. 实现邮箱验证码和 GitHub App 两条路径。旧流程可参考“邮箱一次性证明”，但验证码、频率限制和原子消费必须重写；GitHub App 按固定的服务端适配器进入同一账号目录，不在运行时接受任意 OAuth/OIDC 提供商配置。
3. 建立服务器账号持久化、停用/撤销和客户端登录流程，验证重启后账号仍可登录而房间不可恢复。
4. 单独审计生产旧库后，决定是否提供已验证邮箱用户的有限迁移。未做数据盘点前不运行旧 SQL 或自动迁移。

G3 首版先完成**本服账号身份恢复**，不把本地 UID、宠物、队伍或设置自动上传到账号库。玩家仍需另外备份这些本地资料；现有仓库导出功能不能被当作已验证的完整账号资料备份。以后若增加可选 UID/昵称备份，应明确标为“该账号保存的资料副本”，不能宣称全球 UID 归属，也不能承诺恢复从未上传的内容。同一账号能否在同一房间占多个席位仍待产品确认；它影响房间规则，不能从旧代码推断。

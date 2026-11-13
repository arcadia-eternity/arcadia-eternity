# 离线个人资料与跨宿主恢复设计（#212）

状态：已按本设计实现；源码回归与跨平台安装版验收分别记录。设计基线为 `22a0782d`，2026-11-12；实现与验证记录见[执行记录](../guides/validation/local-profile-recovery-results.md)。

2026-11-13 更新：更换 UID 必须先断开游戏服务器连接，保存后使用新资料重新连接。

关联：[实现 #212](https://github.com/arcadia-eternity/arcadia-eternity/issues/212)、[验收 #263](https://github.com/arcadia-eternity/arcadia-eternity/issues/263)、[验收方案](../guides/validation/local-profile-recovery-plan.md)。

## 1. 交付范围和决策

Web、Electron、CLI 使用同一份可离线保存、导出、检查和恢复的个人资料。每个存储位置只有一份当前资料；首版不增加多角色切换、云同步、自动跨设备合并或账号绑定 UID。

- UID 是公开的本地资料标识，复制资料可以复制 UID，但不能证明服务器账号所有权。
- 个人资料包含昵称、仓库、队伍和明确支持的个人设置。账号登录、管理授权、环境安装仍走各自现有流程。
- 资料恢复是完整快照替换。首版不提供字段合并；现有“仓库导入”继续作为独立的数据追加入口。
- 每次恢复保留替换前的恢复点，先持久化再发布新状态。失败不能留下新 UID 配旧队伍。
- 更换 UID 不允许在连接中直接生效；统一执行校验、断开、保存、重连。账号凭据与本地资料分别管理。
- 导入只解析数据，不联网、不安装内容、不运行作者代码。缺失引用保留，使用时按当前环境重新验证。
- #212 负责实现和自动化回归；#263 独立记录真实平台、双服和换设备证据。两个 issue 不互相复制验收状态。

## 2. 当前实现与缺口

| 位置                                                        | 已有行为                                                  | 本次变化                                               |
| ----------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| `packages/protocol/src/session.ts`                          | `LocalProfile { id, name }`，与 account/session/seat 分离 | 保持服务器协议轻量，不向服务器上传整个备份             |
| `packages/web-ui/src/stores/player.ts`                      | `player-data` 和 `player` 两个保存路径，离线生成 nanoid   | 迁入统一资料存储，消除双写，返回真实保存状态           |
| `packages/web-ui/src/stores/petStorage.ts`                  | 仓库、队伍、规则集、当前队伍；坏数据可触发默认值覆盖      | 数据损坏进入恢复流程，保留原始数据                     |
| `packages/web-ui/src/stores/gameSetting.ts`                 | 多个 `gameSetting.*` 键，延迟保存                         | 改为统一资料更新，导出前等待保存队列                   |
| `packages/web-ui/src/composition/useStorageImportExport.ts` | 仅仓库格式，重新生成精灵 ID，部分无效条目被跳过           | 不用于资料恢复；恢复必须全量校验、保留 ID 和规则集     |
| `packages/web-ui/src/services/localStorage.ts`              | 存储错误警告，可继续使用内存数据                          | 区分未保存、损坏、拒绝访问，不能将读取失败当作首次启动 |
| `packages/web-ui/electron/remote-play.mjs`                  | 每次访问新建临时 partition，关闭时清空                    | 主进程持有稳定资料，远程窗口获得受限快照               |
| `packages/cli/src/commands/register.ts`                     | 对战与内容命令，无个人资料命令                            | 增加 profile 命令和可选的本地对战资料入口              |

本设计基于源码检查；已有测试和历史 issue 证据不能替代本次验收。

## 3. 身份及存储边界

| 对象                                  | 所有者和寿命             | 备份处理                 |
| ------------------------------------- | ------------------------ | ------------------------ |
| `profile.id` / UID                    | 客户端，离线稳定，可复制 | 保留                     |
| `accountId`                           | 单台服务器的账号目录     | 不导出；重新向该服认证   |
| session token、seatId、bootId         | 服务器会话、进程或房间   | 不导出，不通过 UID 推导  |
| management principal / grant / cookie | 受信本地桥或远程管理认证 | 不导出，不随资料恢复授予 |
| 内容环境、包和代码执行许可            | 内容工作区及宿主策略     | 不导出，仅保留资料内引用 |

服务器凭据继续按规范化的精确 API endpoint 和 serverId 隔离，不能退化成仅以 serverId 或 UID 为键。相同地址上 serverId 变化时沿用现有失效规则。昵称修改不改 UID，环境切换和资料恢复不改数据库 accountId。

恢复操作只允许在无进行中对局、无房间成员关系、无匹配请求时提交。UI 给出退出对应活动的动作；不自动丢弃对局。管理身份不参与资料事务，也不因导入被修改。新设备始终没有源设备的任何凭据。

### 3.1 更换 UID 的断开重连规则

以下规则覆盖导入不同 UID 的资料、恢复上一份导致 UID 变化，以及重新生成 UID 的入口，不允许绕过统一流程直接修改 player store。

1. 先完成数据校验和差异预览。当前已连接时提示“更换 UID 需要重新连接”；取消预览不写资料，也不断开连接。
2. 用户确认且已退出房间、匹配或对局后，暂停自动重连和新的连接请求，断开使用该资料的游戏连接。确认连接关闭后才允许保存；断开失败则不更换 UID。
3. 原子保存目标资料。保存成功后才发布新 UID；保存失败保留旧资料，后续连接只能使用旧资料。不得在旧连接仍活动时先更新本地 UID。
4. 原先已连接的宿主使用最终保存的资料重新连接原服务器；原先离线则保持离线。重连失败保留已保存的新资料并显示未连接，允许重试，不自动回滚资料。
5. 重连必须建立与新 `profile.id` 一致的游戏会话，不能直接恢复含旧 profile 的会话或沿用旧席位。现有 `AccountLoginSessions.resume` 会恢复记录中的旧 profile，实现时必须补齐经服务器认证的会话更新/重新签发路径，不能仅重开 socket 就宣称完成 UID 切换。
6. 账号凭据不因更换 UID 被一律清除；是否可继续使用仍由目标服务器验证。更换 UID 不改变 accountId，不允许用客户端提交的 accountId 认领账号。游客重新建立游客会话；账号凭据失效时进入正常登录流程。

恢复同 UID 的队伍或设置不因本规则强制退出账号或断开连接，但仍受上面的活动限制及正常数据同步规则约束。共享同一份持久资料的多个窗口必须在提交前协调断开并阻止自动重连；无法确认全部使用者已进入切换状态时返回 `PROFILE_BUSY`。桌面远程窗口持有独立快照，主窗口的 UID 变化不得热更新到其活动连接；采用新 UID 时同样执行本流程。

## 4. 数据模型与文件格式

新增 `packages/local-profile`，包名 `@arcadia-eternity/local-profile`。依赖现有 schema/const，提供浏览器安全主入口和独立 `/node` 文件存储入口，不依赖 Vue、Electron、服务器或内容执行器。资料 schema 使用仓库现有 schema 约定，类型从 schema 推导；`PetSchema` 直接复用。

备份文件为 UTF-8 JSON，后缀 `.arcadia-profile.json`。示意结构如下，`library` 内精灵对象遵守现有 `PetSchema`：

```ts
type ProfileBackupV1 = {
  format: 'arcadia.profile'
  version: 1
  exportedAt: string // ISO 8601，仅供展示
  appVersion: string
  data: {
    profile: { id: string; name: string }
    library: {
      storage: PetSchemaType[]
      teams: Array<{ name: string; pets: PetSchemaType[]; ruleSetId: string }>
      currentTeamIndex: number
    }
    settings: PortableSettingsV1
  }
}
```

`PortableSettingsV1` 精确包含现有 `battleRenderer`、`battleMotion`、`mute`、`musicVolume`、`musicMute`、`soundVolume`、`soundMute`、`background`、`battleMusic`、`visibleLogTypes`。音量范围 0–100，日志类型转为去重数组。CLI 不使用的设置也必须无损保存及再次导出。背景和音乐只保留选择标识，不能夹带文件或代码；当前宿主不支持时临时使用默认表现，不能回写抹掉原值。

不包括 `lastMatchingConfig`、连接偏好、服务器列表、最近登录、回放、管理配置、文件路径、环境文档、安装记录、访问令牌、cookie、OAuth 状态。导出从允许字段构建，禁止遍历 localStorage、Electron userData 或任意 Pinia 状态。

验证规则：

1. 新建 UID 使用现有 21 位 nanoid；读取已有 UID 接受 1–128 字符、无控制字符、无首尾空白的字符串，不强制转换 UUID，也不重发合法旧 UID。昵称新建/编辑为 1–30 字符；旧资料导入允许到服务端现有的 64 字符上限，不截断历史值。
2. 至少一个队伍；每队最多六只；当前索引必须存在。完整保留仓库和各队伍顺序、所有精灵字段、精灵 ID、规则集 ID。首版沿用嵌入式队伍结构，不额外迁移为实体引用。
3. 同一仓库或同一队伍内精灵 ID 不得重复；跨队伍的重复 ID 按独立队伍快照保留，对战仍使用现有实例化路径。不得在恢复时随机改 ID 来掩盖坏数据。
4. 默认上限为文件 20 MiB、仓库 10,000 只、队伍 1,000 个、字符串 2,048 字符（UID/昵称另有限制）、JSON 嵌套深度 32。读取时先限制字节；解析后限制结构。不同宿主采用同一上限，配额不足是另一个错误。
5. schema 逐层拒绝未知字段，不做静默裁剪；不支持的版本返回 `UNSUPPORTED_VERSION`，源文件不变。新增便携字段须版本迁移，不靠某宿主忽略字段实现兼容。
6. 结构损坏整份拒绝，返回精确字段路径；内容引用无法解析属于可恢复数据，不属于结构损坏。导入不能调用会静默跳过精灵的旧仓库验证器。

本地保存外壳另外记录单调递增 `revision`、资料内容摘要和最近恢复点，不写入便携数据。摘要对 schema 规范化后的 data 计算 SHA-256：对象键排序，数组保持顺序；导出时间不参与比较。摘要用于重复检测和意外损坏检查，不代表真实性或所有权证明。

## 5. 统一模块接口

宿主通过同一个 ProfileRepository 使用资料；差异集中在浏览器和文件存储两个 adapter。主要接口：

```ts
open(): Promise<ProfileOpenResult>
create(input: { name?: string }): Promise<ProfileSnapshot>
update(input: { expectedRevision: number; data: ProfileData }): Promise<ProfileSnapshot>
exportBackup(): Promise<ProfileBackupV1>
inspectImport(bytes: Uint8Array): Promise<ImportPreview>
commitImport(input: {
  planId: string
  expectedRevision: number | null
  decision: 'restore'
}): Promise<ImportResult>
recover(input: { expectedRevision: number }): Promise<ProfileSnapshot>
```

`ProfileOpenResult` 区分 `empty`、`ready`、`unavailable`、`corrupt`、`unsupported-version`，不能用 null 合并这些情况。快照包含 `revision`、数据和 `persistence: 'saved' | 'unsaved' | 'memory-only'`。成功保存表示宿主存储已提交，不保证浏览器永不清理数据。

预览计划绑定解析后的不可变 data、目标 revision 和摘要；保存在当前模块实例内，重启失效。提交不能再读取可能已被替换的源文件。另一窗口或进程修改目标后返回 `REVISION_CONFLICT`，必须重新预览，不自动覆盖。重复内容返回 `unchanged`，不递增 revision、不制造恢复点。

所有普通编辑也经过 revision 检查，不能只有“导入”受保护而其他 store 仍直接落盘。导出会等待当前编辑队列；尚有无法持久化的编辑时允许明确导出当前内存快照，显示“未保存”，不能悄悄导出旧磁盘版本。

统一错误码包括 `STORAGE_DENIED`、`STORAGE_FULL`、`PROFILE_CORRUPT`、`INVALID_BACKUP`、`BACKUP_TOO_LARGE`、`UNSUPPORTED_VERSION`、`REVISION_CONFLICT`、`PROFILE_BUSY`、`RECOVERY_UNAVAILABLE`。错误含可显示的字段路径和重试动作，不输出整份资料或任何凭据。

## 6. 保存、恢复和故障规则

### 6.1 Web

使用当前 origin 的 IndexedDB `arcadia-profile`，单个 readwrite transaction 同时更新当前快照、revision 和最近恢复点。revision 比较和写入必须在同一事务内，BroadcastChannel 只用于通知刷新，不承担互斥。不同 origin 的网站通过备份文件迁移，不共享数据或认证。

首次打开先完成存储读取，再决定是否创建 UID。事务完成后才显示已保存；请求浏览器持久存储可改善保留能力，但请求被拒不能当作写入失败，反之获得许可也不替代备份。

### 6.2 Electron 与 CLI

Electron 主进程是个人资料文件的唯一写 owner，保存于 `app.getPath('userData')/profile/`，与服务器数据库和内容工作区分开。渲染进程通过校验来源的窄接口操作；不暴露任意文件路径或通用 IPC。

CLI 默认目录为 `~/.arcadia/profile/`；优先级为显式 `--profile-dir`、`ARCADIA_PROFILE_DIR`、默认目录。与 Electron 默认不共用目录，交换通过备份；显式指定同一路径时仍必须遵守 owner 锁。CLI 不因为运行环境命令或服务器命令而自动新建玩家 UID。

文件 adapter 使用目录 owner 锁，并在同一文件系统写临时 envelope，刷新文件，原子替换当前文件；envelope 同时包含新快照和旧恢复点。必要时刷新目录；目标平台不支持的持久性能力必须记录并做进程终止实测，不能宣称跨平台掉电保证。POSIX 文件权限 0600；Windows 继承当前用户目录 ACL。锁由活 owner 持有时报告忙，不因超时强行抢占；遗留锁须确认原 owner 已结束才可恢复。

### 6.3 共同状态转换

| 起点/事件             | 结果                                                               |
| --------------------- | ------------------------------------------------------------------ |
| 空目录/空库、可写     | 创建一次 UID 并提交；后续启动读取同一 UID                          |
| 存储不可读            | 显示读取失败，可重试；用户可选择临时资料，但不得覆盖未知旧资料     |
| 首次写失败            | 继续使用同一内存 UID，标记未保存；重试仍保存该 UID                 |
| 已有资料修改失败      | 保留持久旧版和内存编辑；允许重试、导出当前编辑                     |
| 当前资料损坏          | 保留原始字节，提供下载原始数据、恢复上一份或从文件恢复；不自动重置 |
| 导入预览取消          | 零写入                                                             |
| 导入提交前崩溃/写失败 | 旧版完整可读                                                       |
| 导入事务完成后崩溃    | 新版完整可读，旧版恢复点可用                                       |
| 新版正常编辑          | 不覆盖最近一次导入/迁移前的恢复点                                  |
| 恢复上一份            | 原子交换当前快照和恢复点，revision 继续递增，可以反向恢复          |

每个位置保留一个恢复点；下一次不同内容的导入会替换它，预览中提示此结果。普通编辑不产生无限历史。配额不足以同时保留当前与恢复点时导入失败，不通过删除旧资料腾空间。损坏的 envelope 无法解析时，完整原始文件另行隔离保存成功后才允许恢复写入；浏览器需用户完成原始数据导出或明确放弃后才能替换损坏记录。

## 7. 导入体验和内容缺失

入口放在独立的“个人资料”区域，与服务器登录区分开；展示昵称、可复制 UID、保存状态，以及“导出资料”“导入资料”“恢复上一份”。不增加介绍段落。

预览列出源/目标昵称与 UID、仓库数、队伍数、设置变化和缺失引用。不同 UID 使用“替换当前资料”，相同 UID 不同数据使用“恢复此版本”；确认中说明当前资料将被保留为恢复点。UID 相同不能作为自动覆盖理由。

不同 UID 且当前已连接时，预览额外显示“更换 UID 需要重新连接”，确认动作使用“替换并重连”。重连失败提供“重新连接”，不能把已保存的资料显示为恢复失败。

缺失引用按 species、skill、ability、emblem、ruleSetId 列表展示；没有活动内容目录时标记“内容未检查”，不报告“全部可用”。结构合法即可恢复；缺失精灵显示占位名称和原 ID，不过滤掉、不生成默认精灵、不改写技能。选择对应队伍进入对战前再次校验，失败定位到缺失项。切换至含所需内容的环境后重新解析，无需重新导入。

个人资料导入不运行内容安装。用户要补内容时进入现有内容管理流程，遵守获取、准备、执行授权的分离规则。账号页面保留必要提示“账号登录不会恢复本地队伍”；导出预览标识“不含登录凭据”。

## 8. 桌面远程窗口

现有 remote-play 窗口加载打包 UI，但 partition 为临时且权限独立。首版采用以下明确行为：

1. 主窗口打开远程游戏前等待本地编辑保存，通过既有 boot config 交给该窗口不可变的 `ProfileData` 快照及来源 revision；不夹带恢复点、路径、令牌或管理配置。远程管理窗口不需要这份资料。
2. 远程游戏使用这个 UID、队伍和设置。窗口内编辑是会话内副本；显示“仅本次窗口”，不假称已写入桌面资料。
3. 增加唯一的 `requestProfileSave` 请求，将副本作为待审变更交回主窗口。主进程验证真实 owning main frame、快照结构和体积，只建立待处理请求，不写文件。主窗口展示差异，用户确认后通过同一导入事务提交；来源 revision 已过期则重新预览冲突。
4. 有未保存编辑时关闭窗口提供“保存到个人资料”“放弃修改”“取消”；保存须等主窗口确认及事务成功。主窗口不可用时阻止以“已保存”关闭，允许明确放弃。应用强制终止仍可能丢失临时编辑，不能作为持久性通过证据。
5. 任意远程 HTTP iframe、未登记窗口、伪造来源和其他 partition 均不能读取或提交资料。远程窗口仍没有文件、包、进程或管理能力；不复用主窗口 cookie/storage。

这是有意识的显式保存模式，避免临时隔离窗口自动覆盖持久资料。普通 Web 在自身 origin 直接持久化，二者的 UI 保存状态必须准确区分。

## 9. CLI 产品接口

构建后可通过 `node dist/cli.js` 使用以下命令：

```sh
arcadia profile init --name 玩家 --profile-dir ./player-home
arcadia profile show --profile-dir ./player-home --json
arcadia profile set-name 新名字 --profile-dir ./player-home
arcadia profile export --profile-dir ./player-home --out ./backup.arcadia-profile.json
arcadia profile inspect ./backup.arcadia-profile.json --profile-dir ./target --json
arcadia profile import ./backup.arcadia-profile.json --profile-dir ./target --expect-empty
arcadia profile import ./backup.arcadia-profile.json --profile-dir ./target --replace --expect-revision 7
arcadia profile recover --profile-dir ./target --expect-revision 8
arcadia profile repair ./backup.arcadia-profile.json --profile-dir ./target --raw-out ./corrupt-original.json
arcadia profile unlock --profile-dir ./target
```

`init` 对已有资料报已存在，不重新生成；`show` 对空目录报未初始化，不写文件。`inspect` 输出来源/目标摘要、差异和目标 revision。`import` 在同一进程内重新读取并固定输入、校验目标，再提交；目标为空需 `--expect-empty`，非空需 `--replace --expect-revision`。不提供绕过 revision 或 schema 的 `--force`。重复内容导入成功且 `changed:false`。输出文件已存在时拒绝覆盖。

退出码：成功/重复导入 0，输入或版本不合法 2，冲突/忙 3，存储失败 4；JSON 错误沿用 CLI 的 `diagnostics` 数组，其中每项为 `{code, message, source?}`（source 可指向无效字段）。重定向输出不包含整份资料，只有显式 export 写备份。`repair` 先以排他创建方式保存损坏原文，再按原文比较交换恢复；未知版本不允许 repair。`unlock` 只清理已确认进程不存在的 owner，活进程或无法确认的 PID 均拒绝；恢复门使用唯一文件名，恢复操作中断后的死门可安全清理。

本地交互对战增加 `--use-profile --team <index>`，首版 index 使用从 1 开始的展示序号；该选项为 player1 提供昵称和队伍，与 `--player1` 互斥，player2 仍显式提供。`--profile-dir` 单独出现不改变对战输入。UID 只作为宿主资料元数据，不替换 Battle Player/Seat ID，不进入随机种子或影响重放。批量 simulate/replay 保持显式输入且不创建资料。

## 10. 当前用户数据迁移

只迁移当前源码中实际存在的存储键，不恢复已退役 V2 业务模型。所有宿主先查新资料；存在时不再从旧键覆盖。

1. Web 首次迁移读取 `player-data`、`player`、`petStorage`、上述 `gameSetting.*`。两个身份键内容一致时直接采用；一个有效时采用有效项并报告另一项问题；两个有效但不同则让用户选择，展示 UID 和昵称，不猜哪个更晚。
2. 读取旧库的阶段必须禁止 Pinia 自动保存、默认队伍生成后的写回及设置 watcher。结构损坏阻止自动迁移，提供原始数据导出；缺失字段才补明确定义的默认值。无旧资料才走新建。
3. 迁移成功一次性写入新快照及迁移标记，保留旧键原样作为回退材料，但禁用其写入路径。迁移失败不删除旧键、不保存半份新资料。旧键不能长期作为第二写源。
4. Electron 在可信主窗口读取旧 renderer 数据，交给主进程完成同一迁移；迁移完成前不开放编辑和远程游戏。若主进程已有资料则不接受自动覆盖。CLI 无旧持久资料可迁移。
5. 旧 `arcadia-storage` 文件不含 UID 和完整设置，只允许进入既有“仓库导入”，不能标成个人资料备份。导入仓库造成的变更同样须经新资料模块保存。

## 11. 实施切片与完成标准

| 顺序 | 工作与落点                                                                      | 可独立验证的结果                                               |
| ---- | ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A    | `packages/local-profile` schema、摘要、预览/冲突、恢复事务；浏览器/Node adapter | 同一 fixtures 在两 adapter 往返一致，故障不出现部分资料        |
| B    | player/petStorage/gameSetting 接入、启动迁移、资料页面、缺失内容呈现            | Web 离线创建、重启、备份和干净 origin 恢复；旧数据不被静默覆盖 |
| C    | Electron 主进程 owner、可信 preload、远程快照和待确认保存                       | 安装版跨重启持久，远程窗口无管理越权，主窗口冲突可处理         |
| D    | CLI profile 命令注册、Node adapter、本地对战入口                                | 干净目录可创建/恢复，CLI 导出可被另外两宿主接收                |
| E    | 用户指南及 #263 自动化夹具、故障注入、证据模板                                  | 可按矩阵独立复现，不把计划标成通过                             |

每个切片补行为测试；类型检查前构建相关工作区依赖。A 覆盖损坏/未知版本/限额/原子性/CAS/幂等；B 覆盖真实 Pinia 启动与 watcher；C 用真实 Electron 窗口和非法 frame；D 用构建后的 CLI 子进程。最终执行项目规定的类型、lint 和相关测试；实际运行结果以执行记录为准。

#212 可关闭条件：三个宿主能力交付，迁移和凭据排除回归通过，文档说明恢复边界，#263 每项已有可执行用例。#263 的真实平台通过证据仍独立决定其关闭，不由 #212 代替。

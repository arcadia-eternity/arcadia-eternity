# npm 内容包与原生 Effect SDK

当前实现提供 Node／CLI 的 npm 包检查、显式准入、固定环境、完整战斗和原环境回放，并接入单进程权威服务器的环境目录和房间。它承接 #242／#243／#244 的一部分；基础表单工作区、桌面建服、导出与发布工具仍需继续完成。npm 内容包是这条作者流程的唯一交付格式。

## 作者入口

可运行的 TypeScript 包在 [`examples/ugc/slow`](../../examples/ugc/slow)。它包含精灵、技能、两回合减速印记和两个代码效果。重复施加刷新持续时间，印记到期清除速度贡献。

从新包开始时，可按[创作者入门](ugc-authoring-start.md)生成带真实引擎场景测试和 Agent Skill 的 TypeScript 项目。

效果模块导出 `createEffects({ sdk, marks, id })`。宿主注入与本局核心相同的 SDK 和规范印记原型；`id(localId)` 生成包的 `namespace:id`。类型从 `@arcadia-eternity/battle/v4/authoring` 导入 `CodeEffectModuleContext`。运行时代码使用注入的 `sdk`，避免包内另一个引擎副本产生不兼容的类、参数 token 或恢复工厂。

`sdk.defineCodeEffect` 支持与官方效果相同的 `triggers / when / apply` 字段，直接提供真实引擎上下文与领域类。简单定义无需 `build`；每个使用位置由宿主分配稳定编译身份。需要原有工具时，`build` 仍可返回 `defineEffect` 接受的定义，并收到 `effectId` 和可用的 `sourceMark`。API 索引、来源清理和失败语义见 [Effect SDK](effect-sdk.md)。配置复用使用普通 TS 函数；跨回合状态使用引擎实例、参数和绑定，不能放在模块全局或共享闭包中。

**运行时参数与编辑表单是两个合同。** `numberParam`、`booleanParam`、`stringParam` 仍可声明在效果的 `parameters` 中；执行时读取当前作用域的有效值，支持稳定地址、标签、其他效果的修改和来源清理。不要求为其建立编辑器表单或序列化配置 Schema。示例的减速量使用 `numberParam` 和 `follow`，其他效果修改该参数时，速度贡献随之更新。固定且不参与战斗修改的选项才适合直接使用 TS 常量。

每次使用的参数地址为 `parameterAddress(effectId, 'parameters', name)`。技能／印记的 `useId` 区分同一代码导出的多次使用；来源实例和对局持有各自的状态。文件移动和 npm 名称变化不改变 `projectId`、namespace、局部 ID 或 useId；修改 namespace 会改变运行 ID。

SDK API 兼容版本由 `arcadia.sdkApi` 声明，当前为 `2`。API 版本表示兼容合同；核心、SDK、内容元数据和依赖图仍参与环境身份，但不再逐文件摘要用户安装的代码。用户自行管理本地改动；相同环境元数据不能证明代码文件未变，恢复和回放仍需用户提供匹配的代码。

随机数使用 `sdk.values.randomInt`、`conditions.chance` 或本局 RNG。生命周期、捕获／跟随、操作和预算合同见[效果编写](effect-authoring.md)。快照范围仍为现有等待点，见[快照](v1-snapshots.md)。

## npm 元信息

```json
{
  "name": "@your-scope/slow",
  "version": "1.0.0",
  "type": "module",
  "files": ["content.json", "src", "dist"],
  "arcadia": {
    "formatVersion": 1,
    "projectId": "my-slow-pack",
    "namespace": "my-slow",
    "content": "content.json",
    "effects": "dist/effects.js",
    "sdkApi": 2
  }
}
```

`content.json` 使用现有草稿数据结构；可以仅提供 `data` 和 `assets`，项目身份由元信息补齐，也可以显式保存完整草稿。显式身份必须匹配包声明。被内容引用的代码效果由宿主生成内部行为定义，作者无需再写效果元数据或参数 Schema。对象中的引用继续使用 `$ref { projectId, kind, id }`，官方内容直接使用其现有 ID。

数据包可以省略 `effects` 和 `sdkApi`。代码包声明 SDK API 版本，效果定义由 `createEffects` 返回。技能和印记直接引用所需效果，不再维护 `arcadia.exports`；加载器据引用生成内部注册信息，并检查实际效果的适用对象。未被引用的效果不注册。所有包都有 `content`，代码包可提供空内容集合。元数据检查不会导入效果模块。

推荐用 `arcadia.presentation: "dist/presentation.json"` 接入工具生成的资源／语言索引，源文件与 `presentation` 用途声明见[内容展示合同](content-presentation.md)。包内文件从固定环境的包目录流式提供；HTTP/HTTPS 资源只公布地址，不在构建／环境准备时下载。不建立服务器或客户端资源缓存，资源响应和客户端主动请求使用 `no-store`。远程 URL 固定的是引用，不保证源站字节不变。

现有 `arcadia.assets` 提供 `sha256 → 包内相对文件` 映射，与草稿 `assets` 声明对应。即使在无界面运行时也检查声明的资源字节，以确保客户端取得对应展示资源。源码、构建产物和 source map 不做安装文件摘要或本地防篡改检查。

## 标准依赖与固定安装

依赖范围、解析、peer 校验和下载完整性由 npm 负责。服务器项目持有 `package.json` 和标准 `package-lock.json` 或 `npm-shrinkwrap.json`；支持 lockfile v3。普通 npm 包中的 `package-lock.json` 不作为消费者锁定承诺，服务器项目应维护自己的锁文件。

安装目录必须是完整的 production 依赖树。`content npm install` 使用 `npm ci --omit=dev --ignore-scripts`，不执行根项目或依赖生命周期脚本。需要安装脚本构建的依赖应先由管理员在获准的构建流程中准备好，再检查实际输出。不能假定 `--ignore-scripts` 后任意原生依赖都已可运行。

检查器使用 npm 的实际树，并核对锁记录与已安装 manifest；拒绝未列入检查的额外目录、缺包、软链接工作区和越界内容路径。开发源项目应先构建并 `npm pack`，再安装产物。允许普通 JS 库的嵌套多版本；内容注册中同一稳定项目或 namespace 出现多份时明确拒绝，不按顺序覆盖。跨包内容引用须有 npm 依赖链支持。

身份分别表示：

| 字段             | 含义                                                       |
| ---------------- | ---------------------------------------------------------- |
| npm `integrity`  | npm 下载／安装产物的来源完整性记录                         |
| 安装 `digest`    | 已检查依赖图和内容元数据；不含本地代码文件或绝对安装位置   |
| `lockfileDigest` | 标准 npm 锁文件审计记录，包含其来源信息                    |
| Release `digest` | 规范化源载荷和运行要求；未声称按有效默认值合并语义等价写法 |
| 环境 `revision`  | 核心、Base、内容元数据、依赖图和策略的身份                 |

省略默认值与显式填写默认值当前可以产生不同摘要。项目准入不再绑定摘要；本地修改代码或内容无需重新批准。npm tarball integrity 仍由 npm 用于下载／安装校验，不用来检查安装后的用户改动。

## CLI 流程

在本仓库先构建依赖和 CLI，再构建示例：

```sh
pnpm build:package
pnpm build:cli
pnpm exec tsc -p examples/ugc/slow/tsconfig.json
npm pack ./examples/ugc/slow --ignore-scripts
```

示例是私有测试包，不会自动发布 npm。当前仓库内的 SDK 类型通过工作区依赖解析；独立创作项目需要安装与宿主匹配的 SDK 发行产物，不能把本仓库声明的版本号当作已经公开发布的证据。

在新的服务器项目目录中，以标准 npm 依赖指向该 tgz，并由 npm 生成锁文件：

```sh
npm install --package-lock-only --ignore-scripts --omit=dev /absolute/path/arcadia-example-slow-1.0.0.tgz
```

然后从仓库运行以下命令。每个命令均支持 `--json`：

```sh
node dist/cli.js content npm install /path/to/server-project
node dist/cli.js content npm inspect /path/to/server-project --json
node dist/cli.js content npm approve /path/to/server-project \
  --profile local-development
node dist/cli.js content validate --npm-project /path/to/server-project --json
node dist/cli.js battle simulate --npm-project /path/to/server-project \
  -1 /path/to/team-a.json -2 /path/to/team-b.json --seed example --replay-out replay.json
node dist/cli.js battle replay replay.json --npm-project /path/to/server-project --json
```

默认准入文件是项目根目录的 `arcadia-admission.json`；`--approval` 可指定另一个文件。准入记录使用版本 2，只记录管理员选择的 profile。准入命令默认不会覆盖已有批准。安装命令拒绝覆盖已有 `node_modules`，升级应准备新的项目目录。`--offline` 仅使用 npm 已有缓存和本地产物，缺失依赖会失败。

## 权威服务器与房间

服务器管理员可以在启动前准备一个或多个已经安装并批准的 npm 项目：

```sh
node dist/cli.js server --npm-project /path/to/approved-project
```

服务器检查批准文件与实际依赖树，再准备私有固定环境；安装、代码准入和房间选择是独立步骤。`GET /api/v1/environments` 列出当前可选环境和公开的包、版本、协议与资源摘要。每个环境提供只含展示与组队字段的 `/api/v1/environments/{id}/content`，素材通过描述符中的固定版本 HTTP 地址获取。浏览器无需取得或执行效果代码。

房间只能选择服务器预先准备的环境；UGC 房间由服务器执行，不支持浏览器 P2P 宿主。Ready／Start 提交所选环境、协议版本和展示资源准备状态，服务器分别检查协议、资源声明与队伍合法性。这是客户端对展示准备的确认，不是代码准入证明。活动房间持有原环境；管理员准备新版本后可供新房间使用，退役的旧环境会等所有房间和显式保留引用释放后回收。

服务器的程序接口 `app.environments.prepareNpm(...)` 用于准备候选环境，`retire(id)` 停止其被新房间选择；候选准备失败不替换已发布环境。每次准备得到独立的服务器环境 ID，即使元数据未变也会加载当前代码，不按文件摘要复用旧候选。当前单进程服务重启会丢弃房间，持久检查点引用和跨进程恢复尚未接入。服务器不能根据客户端提交的环境 ID 自动下载或授权包。

## 导出可移植项目

管理员可以导出当前已准入的服务器内容项目：

```sh
node dist/cli.js content project export /path/to/server-project /path/to/new-export
```

默认仅接受可匿名访问的公共 npm registry 固定来源。若要包含源项目内部的本地 `.tgz`，须显式添加 `--include-local-artifacts`，并由执行者确认有权再分发包内内容。导出前工具在隔离目录使用无凭据、无生命周期脚本的 npm 安装重建项目，并核对依赖图和内容元数据；无法重建时不会发布完成的项目。导出使用锁定产物，不收集或校验 node_modules 中自行修改的代码；要分享这些修改，应先重新打包。目标目录必须不存在；如果写入过程被中断，未完成目录需要人工检查并删除或另选位置。

在另一台受支持的主机中，按导出目录的 README 安装依赖、检查并重新准入，然后运行 `content project verify <directory>` 验证原环境。当前验证保守要求相同 Node 版本、操作系统和架构以及 npm 9 或以上。项目不包含准入文件、账号、服务器身份、私人队伍或战斗存档；公开 registry 依赖仍需网络或已有缓存，因此它不是完整离线备份。

profile 是管理员对该环境的策略记录，支持 `local-development`、`self-hosted` 和 `official`；填写 `official` 不授予官方服务器资格或工坊凭证。准入不是发布、工坊收录或用户登录。回放只保存环境身份和战斗所需数据，不保存本机路径、准入文件或可执行 npm 包；执行回放仍需管理员提供原安装环境。

## 环境生命周期

`prepareNpmProject(directory, host, approval)` 将依赖输入复制到该环境私有的临时目录，再检查 npm 依赖树和内容合同，不比较安装代码文件摘要。模块从该副本导入；源码目录或安装目录后续修改不会使已有环境的延迟加载读到新版文件。新版本通过新副本准备，不使用全局 clear/reload；用户应在本地修改完成后准备环境。

返回对象持有冻结内容目录和 `dispose()`。宿主应在该环境的所有活动对局及保留恢复引用释放后调用 dispose；当前 CLI 每次执行运行在独立进程中，退出时清理临时副本。Node 模块本身不能从缓存卸载，长期预览服务应结合独立进程回收模块内存。

准入后的 TS／JS 是获准代码，拥有 Node 进程权限。固定副本覆盖已检查的 npm 安装树，并不阻止代码读取绝对路径、环境变量、网络或其他未声明输入；作者必须避免让战斗规则依赖这些可变输入。执行预算约束引擎的递归派发和已计费计算，不能抢占任意 JS 无限循环。真正不可信的代码需要宿主进程、系统权限和资源边界；本接口不提供沙箱承诺。

旧 `.arcadia` 和 WorkRelease 加载继续保留，不在导入时自动改写任意代码引用。显式迁移、持久恢复、桌面安装包和创作 UI 仍分别由 #214／#217、#244／#224、#209、#215／#216 接入。

## 验证入口

```sh
pnpm --filter @arcadia-eternity/pack-loader test:run
pnpm test:cli
pnpm typecheck:battle-v4
pnpm test:battle-v4
```

npm 测试实际打包、离线安装与 `npm ci` 重建；验证原生效果、重复刷新、参数修改、来源清理、等待点恢复、自然到期、普通库多版本、内容冲突、额外依赖拒绝和旧环境保留。CLI 测试编译示例 TS、打包、安装、准入，完成真实战斗并在另一进程按原环境回放。

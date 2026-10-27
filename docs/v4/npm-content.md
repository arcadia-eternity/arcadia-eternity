# npm 内容包与原生 Effect SDK

当前实现提供 Node／CLI 的 npm 包检查、显式准入、固定环境、完整战斗和原环境回放。它承接 #242／#243 的第一条执行链路；服务器环境目录、网页预览、基础表单工作区、桌面建服和发布工具由后续宿主接入继续完成。已有浏览器 creator／`.arcadia` 流程属于兼容实现，不代表这些新宿主入口已完成。

## 作者入口

可运行的 TypeScript 包在 [`examples/ugc/slow`](../../examples/ugc/slow)。它包含精灵、技能、两回合减速印记和两个代码效果。重复施加刷新持续时间，印记到期清除速度贡献。

效果模块导出 `createEffects({ sdk, marks, id })`。宿主注入与本局核心相同的 SDK 和规范印记原型；`id(localId)` 生成包的 `namespace:id`。类型可从 `@arcadia-eternity/pack-loader/node` 导入 `NpmEffectModuleContext`。运行时代码使用注入的 `sdk`，避免包内另一个引擎副本产生不兼容的类、参数 token 或恢复工厂。

`sdk.defineCodeEffect` 导出代码工厂，每个使用位置分别编译，工厂收到稳定 `effectId` 和可用的 `sourceMark`。其 `build` 返回 `defineEffect` 所接受的类型化定义。配置复用使用普通 TS 函数；跨回合状态使用引擎实例、参数和绑定，不能放在模块全局或共享闭包中。

**运行时参数与编辑表单是两个合同。** `numberParam`、`booleanParam`、`stringParam` 仍可声明在效果的 `parameters` 中；执行时读取当前作用域的有效值，支持稳定地址、标签、其他效果的修改和来源清理。不要求为其建立编辑器表单或序列化配置 Schema。示例的减速量使用 `numberParam` 和 `follow`，其他效果修改该参数时，速度贡献随之更新。固定且不参与战斗修改的选项才适合直接使用 TS 常量。

每次使用的参数地址为 `parameterAddress(effectId, 'parameters', name)`。技能／印记的 `useId` 区分同一代码导出的多次使用；来源实例和对局持有各自的状态。文件移动和 npm 名称变化不改变 `projectId`、namespace、局部 ID 或 useId；修改 namespace 会改变运行 ID。

SDK API 兼容版本由 `arcadia.sdkApi` 声明，当前为 `1`。API 版本表示兼容合同；实际核心、SDK 实现、包代码和传递依赖仍进入构建摘要，不能仅凭 API 版本或相同导出名复用快照。

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
    "sdkApi": 1,
    "exports": [
      { "id": "apply-slow", "sourceKind": "skill" },
      { "id": "speed-penalty", "sourceKind": "petMark" }
    ]
  }
}
```

`content.json` 使用现有草稿数据结构；可以仅提供 `data` 和 `assets`，项目身份由元信息补齐，也可以显式保存完整草稿。显式身份必须匹配包声明。`data.behaviors` 可继续保留旧原生模板引用；声明的代码导出由宿主生成行为定义，作者无需复制一份参数 Schema。对象中的引用继续使用 `$ref { projectId, kind, id }`，官方旧 ID 保持兼容。

数据包可以省略 `effects`、`sdkApi` 和 `exports`。代码包必须声明 SDK API 版本，并返回与 `exports` 完全一致的导出。所有包都有 `content`，代码包可提供空内容集合。元数据检查不会导入效果模块。

资源通过 `arcadia.assets` 提供 `sha256 → 包内相对文件` 映射，与草稿 `assets` 声明对应。即使在无界面运行时也检查声明的资源字节。完整包文件，包括源码、构建产物和 source map，都进入安装文件摘要；这不等于对任意作者构建过程作了可复现构建认证。

## 标准依赖与固定安装

依赖范围、解析、peer 校验和下载完整性由 npm 负责。服务器项目持有 `package.json` 和标准 `package-lock.json` 或 `npm-shrinkwrap.json`；支持 lockfile v2／v3。普通 npm 包中的 `package-lock.json` 不作为消费者锁定承诺，服务器项目应维护自己的锁文件。

安装目录必须是完整的 production 依赖树。`content npm install` 使用 `npm ci --omit=dev --ignore-scripts`，不执行根项目或依赖生命周期脚本。需要安装脚本构建的依赖应先由管理员在获准的构建流程中准备好，再检查实际输出。不能假定 `--ignore-scripts` 后任意原生依赖都已可运行。

检查器使用 npm 的实际树，并核对锁记录与已安装 manifest；拒绝未列入检查的额外目录、缺包、软链接工作区和越界内容路径。开发源项目应先构建并 `npm pack`，再安装产物。允许普通 JS 库的嵌套多版本；内容注册中同一稳定项目或 namespace 出现多份时明确拒绝，不按顺序覆盖。跨包内容引用须有 npm 依赖链支持。

身份分别表示：

| 字段             | 含义                                                       |
| ---------------- | ---------------------------------------------------------- |
| npm `integrity`  | npm 下载／安装产物的来源完整性记录                         |
| `filesDigest`    | 当前安装包内实际文件字节                                   |
| 安装 `digest`    | 已检查依赖图、包内容和实际文件；不含绝对安装位置           |
| `lockfileDigest` | 标准 npm 锁文件审计记录，包含其来源信息                    |
| Release `digest` | 规范化源载荷和运行要求；未声称按有效默认值合并语义等价写法 |
| 环境 `revision`  | 核心、实际代码闭包、Base、内容版本和策略的固定身份         |

省略默认值与显式填写默认值当前可以产生不同摘要。改变代码、依赖或构建产物必须重新检查和准入；不能沿用 npm tarball integrity 声称改后的产物仍是原始包。

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

然后从仓库运行以下命令。每个命令均支持 `--json`，示例中的摘要取自实际检查结果：

```sh
node dist/cli.js content npm install /path/to/server-project
node dist/cli.js content npm inspect /path/to/server-project --json
node dist/cli.js content npm approve /path/to/server-project \
  --digest <installation-digest> --profile local-development
node dist/cli.js content validate --npm-project /path/to/server-project --json
node dist/cli.js battle simulate --npm-project /path/to/server-project \
  -1 /path/to/team-a.json -2 /path/to/team-b.json --seed example --replay-out replay.json
node dist/cli.js battle replay replay.json --npm-project /path/to/server-project --json
```

默认准入文件是项目根目录的 `arcadia-admission.json`；`--approval` 可指定另一个文件。准入命令绑定完整安装摘要，默认不会覆盖已有批准。安装命令拒绝覆盖已有 `node_modules`，升级应准备新的项目目录。`--offline` 仅使用 npm 已有缓存和本地产物，缺失依赖会失败。

profile 是管理员对该环境的策略记录，支持 `local-development`、`self-hosted` 和 `official`；填写 `official` 不授予官方服务器资格或工坊凭证。准入不是发布、工坊收录或用户登录。回放只保存环境身份和战斗所需数据，不保存本机路径、准入文件或可执行 npm 包；执行回放仍需管理员提供原安装环境。

## 环境生命周期

`prepareNpmProject(directory, host, approval)` 在调用任何包代码前验证摘要，将依赖输入复制到该环境私有的临时目录，并再次验证复制结果。模块从该副本导入；源码目录或安装目录后续修改不会使已有环境的延迟加载读到新版文件。新版本通过新副本准备，不使用全局 clear/reload。

返回对象持有冻结内容目录和 `dispose()`。宿主应在该环境的所有活动对局及保留恢复引用释放后调用 dispose；当前 CLI 每次执行运行在独立进程中，退出时清理临时副本。Node 模块本身不能从缓存卸载，长期预览服务应结合独立进程回收模块内存。

准入后的 TS／JS 是获准代码，拥有 Node 进程权限。执行预算约束引擎的递归派发和已计费计算，不能抢占任意 JS 无限循环。真正不可信的代码需要宿主进程、系统权限和资源边界；本接口不提供沙箱承诺。

旧 `.arcadia` 和 WorkRelease 加载继续保留，不在导入时自动改写任意代码引用。显式迁移、服务器目录／HTTP 资源、网页 Ready/Start、桌面安装包和创作 UI 仍分别由 #214／#217、#244／#224、#209、#215／#216 接入。

## 验证入口

```sh
pnpm --filter @arcadia-eternity/pack-loader test:run
pnpm test:cli
pnpm typecheck:battle-v4
pnpm test:battle-v4
```

npm 测试实际打包、离线安装与 `npm ci` 重建；验证原生效果、重复刷新、参数修改、来源清理、等待点恢复、自然到期、普通库多版本、内容冲突、额外依赖拒绝和旧环境保留。CLI 测试编译示例 TS、打包、安装、准入，完成真实战斗并在另一进程按原环境回放。

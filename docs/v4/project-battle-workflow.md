# 项目队伍与对战环境

项目队伍、本机草稿和当前对局分别持久化。个人编队继续使用个人存储；作者窗口只使用绑定当前项目的队伍接口，不获得通用文件访问能力。客户端全局只保留一个试玩宿主和窗口。

## 项目文件和本机状态

每个 `debug/teams/<id>.yaml` 保存一套队伍，字段为：

```yaml
schemaVersion: 1
id: blue
name: 蓝队
team: []
```

`team` 使用普通精灵配置并保留排列，排第一只为首发。文件不含精灵／玩家运行编号。空队伍可保存用于编辑，但不能开局。队伍标识匹配 `[a-z0-9][a-z0-9_-]{0,79}`，文件名与标识一致；重命名只改名称，复制会生成新的稳定标识。文件随项目进入 Git，默认不进入 npm 内容包。当前模板的 npm `files` 已排除 `debug`；准备器拒绝将调试文件打入运行包。

调试窗口共享同一队伍库，双方可以选同一套。编辑器通过 `TeamEditorDelegate` 获取精灵列表和操作，选择器通过 `TeamLibraryDelegate` 获取库与选择。修改立即自动暂存到 Electron userData 的项目草稿文件，保存按钮才写项目 YAML。个人入口的委托使用个人编队数据；作者窗口不会初始化个人仓库。

草稿记录原文件版本、修改值、双方选择和训练师名称。窗口关闭、应用重启及候选更换不清空草稿。已选择的命名环境也独立记在客户端项目状态，内容更新或客户端重启后的重新准备沿用这个选择。保存／删除核对文件哈希，外部编辑或 Git 更新后拒绝旧版本写入并保留草稿。作者可明确重新载入项目文件，或复制草稿为新队伍保存。未修改的队伍在重开窗口时读取最新项目文件。删除被自动用例引用的队伍后，用例明确报 `TEAM_MISSING`，需同步调整用例。

开局时复制双方配置，再生成互不冲突的运行编号。之后编辑队伍不改变当前对局。替换试玩释放旧窗口、宿主和候选 Session，保留项目文件与本机草稿；失败替换也保留队伍资料。

## 命名环境

默认环境 `default` 为当前包与正式 npm 依赖。其他环境保存为 `debug/environments/<id>.json`：

```json
{
  "schemaVersion": 1,
  "id": "interaction",
  "name": "双包交互",
  "packages": { "@example/other-pack": "1.0.0" },
  "sources": []
}
```

`packages` 使用注册表包名与版本约束。`sources` 使用本机协作源码包的 npm 名称；界面的“添加本机源码包”将名称到真实目录的映射写入项目 `.arcadia/debug-sources.json`，此文件不进入 Git。源码先复制并核对版本，再构建、打包，最终安装到真实 npm 环境，不直接执行可变源码或 node_modules 链接。

npm 自己解析依赖、生成 `debug/environments/<id>.package-lock.json`；当前源码归档使用相对于临时安装根的 `file:candidates/<shasum>.tgz`，共享锁不包含本机绝对路径。归档由源项目重新构建，安装产物和运行副本留在临时目录。环境准备通过原文件版本检查写回锁，外部锁修改不会被静默覆盖。锁和环境配置随项目提交，Git 提交由作者控制。命名试玩允许 npm 下载尚未缓存的依赖；自动测试默认离线，也可显式指定 `offline: false`。

A 的内容／效果引用 B 时，A 必须声明正式依赖。只测试 A 与 B 的共存机制时，把两者加入环境即可，不制造假依赖。npm 树、内容 projectId／namespace 重复、版本不兼容或缺失引用沿用现有检查并明确失败，不按加载顺序覆盖。换环境不会自动修改队伍或正式依赖。

内容候选的版本排除 `debug/teams`，因此编辑队伍只需重新开局。完整源版本仍包含队伍，自动用例和文件保存仍检测变更。环境配置和锁变化会使内容候选过期；准备任务只接受自己本次生成、版本核对成功且其他源码未变的锁更新。

## 自动测试与手动试玩

`prepareBattleEnvironment(root, options)` 提供统一安装和内容环境。`prepareContentPack` 继续提供已有包测试接口，在同一环境上增加默认队伍和 `createBattle`，现有行为断言保留。包自身测试默认不读取额外环境，避免漏声明依赖被组合环境掩盖。

模板的 `arcadia.config.mjs` 使用唯一队伍来源：

```js
export default { teams: ['blue', 'orange'] }
```

旧项目的 `players({ namespace, manifest })` 继续兼容。迁移时设置 `teams` 并移除旧函数；同时存在时 `teams` 优先。自动用例可以明确指定其他项目队伍：

```js
const prepared = await prepareContentPack(root, {
  environmentId: 'interaction',
  sources: { '@example/other-pack': otherSourceDirectory },
})
try {
  const players = prepared.loadTeams(['blue', 'orange'])
  const battle = prepared.createBattle('fixed-case-seed', { players })
  // 在这里断言机制和结果；prepared.teamVersions 提供所加载队伍的文件版本。
} finally {
  await prepared.dispose()
}
```

自动用例指定环境、队伍、种子和预期结果，不读取手动窗口的最近选择或本机草稿。真实双包机制、同种子结果、缺失引用、重复身份、锁复用及作者任务候选版本由 `packages/content-dev/test/environments.test.mjs` 验证。

玩家的本地人机页保留无需打开源码的快捷入口，使用已准备的个人环境与个人队伍；作者从源码工作区进入调试窗口，返回原编辑位置。两者共用队伍选择和对战参数组件、AI 和战斗画面。旧草稿试战票据及组合工作台到玩家页的隐式配置入口已移除。浏览器继续消费受支持的内容和战斗接口，不执行原生 UGC。

CLI 可用 `arcadia-content workspace <目录> preview --execute --environment interaction`，MCP `preview_start` 接受可选的 `environmentId`。这两个入口仍使用相同候选任务与本机源码映射。

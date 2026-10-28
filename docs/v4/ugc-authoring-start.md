# 创建并测试 TypeScript 内容包

这个入口创建一个标准 npm 包：包含精灵、技能、减速印记、TypeScript 效果、场景测试和供编码助手使用的 Agent Skill。首个示例命中后减速两回合，重复命中刷新持续时间而不叠加幅度；可以在此基础上修改内容。它不会安装、批准、发布或部署内容。

## 从独立模板开始

在独立仓库开发时，使用组织下的 [content-pack-template](https://github.com/arcadia-eternity/content-pack-template)，点击 **Use this template** 创建自己的包，然后运行 `npm run setup`、`npm test` 和 `npm run demo`。

模板按 `data/species`、`data/skills`、`data/marks` 分文件维护 JSON/YAML，效果放在 `src/effects.ts`，演示队伍放在 `arcadia.config.mjs`。通用构建、校验、重命名、安装和演示由本仓库的 [`@arcadia-eternity/content-dev`](../../packages/content-dev/README.md) 提供，模板通过 `arcadia-content` 命令调用。通用工具和它的测试都留在主仓库，作者只维护本包内容与行为测试。

SDK 和工具尚未正式发布到 npm；模板首次安装从 `arcadia-sdk.json` 指定的主仓库提交载入安装器，并构建、安装本地开发物料。后续使用本地工具命令。工具物料用 `node scripts/stage-author-sdk.mjs /new/sdk-dir` 生成，包含工具和 SDK 的完整依赖。

## 本地 SDK 与验证

如需使用已经构建好的本地 SDK，先在主仓库运行：

```sh
pnpm --filter @arcadia-eternity/content-dev... run build
node scripts/stage-author-sdk.mjs /path/to/new-sdk-directory
```

再在自己的模板项目运行：

```sh
npm run setup -- --sdk-dir /path/to/new-sdk-directory
npm test
npm run demo
```

效果只在 TypeScript 中定义，并由技能或印记的数据引用；不再在 `package.json` 重复维护 `arcadia.exports`。文件可以分别放置，也可以在一个 JSON/YAML 数组中维护多条记录，引用依靠稳定的内容 ID。

模板测试会打包并安装真实 npm 产物，覆盖命中、未命中、刷新、来源清理、自然到期、参数修改和等待点恢复。通用测试工具保留在主仓库，模板只维护自己的行为断言。

SDK 尚未正式发布到 npm。创建项目、安装依赖和通过测试不替代服务器管理员的准入决定。安装、战斗和回放流程见 [npm 内容包](npm-content.md)。

# 创建并测试 TypeScript 内容包

这个入口创建一个标准 npm 包：包含精灵、技能、减速印记、TypeScript 效果、场景测试和供编码助手使用的 Agent Skill。首个示例命中后减速两回合，重复命中刷新持续时间而不叠加幅度；可以在此基础上修改内容。它不会安装、批准、发布或部署内容。

## 在本仓库试用

先按 [npm 内容包](npm-content.md) 中的说明构建仓库依赖与 CLI。选择一个**不存在**的目录，在仓库根目录运行：

```sh
node examples/ugc/create-content-pack.mjs ./my-first-pack \
  --name @your-scope/my-first-pack \
  --project-id my-first-pack \
  --namespace my-first-pack
cd my-first-pack
npm test
```

生成器不会覆盖已有目录。`--json` 输出结构化结果，错误写入标准错误并返回非零退出码。项目 ID 与 namespace 是游戏内容身份，应在发布后保持稳定；npm 名称是安装身份，可以与它们不同。

生成的测试会编译 TS，将实际 npm 包安装进临时项目，加载真实引擎，并检查未命中、命中、重复刷新、来源移除、自然到期和现有选招等待点的保存恢复。它使用合成测试宿主身份，不授予生产服务器准入。故意修改减速量后重新运行 `npm test`，测试应指出速度贡献不符。仓库里的 `packages/pack-loader/test/npm-project.test.ts` 还覆盖运行时参数修改等引擎合同。

生成项目附带 `.agents/skills/arcadia-content-authoring/SKILL.md`，能被支持该位置的编码助手发现；其他工具可直接读取此文件。它说明 SDK 的作用域、参数和生命周期，以及构建、测试、预览的边界。参数仍可由其他效果修改，不需要为每个参数建立编辑表单。

## 独立项目和服务器

在本仓库下创建项目时，依赖可由上级工作区提供；生成包的 `devDependencies` 只记录目标版本，并不表示 SDK 已经公开发布。将项目移到独立目录时，需要先从可信的 SDK 发行来源取得与宿主匹配的依赖，再运行测试。

修改源码后需要重新构建、打包并检查实际安装产物。服务器管理员单独决定是否准入；创建项目、通过测试或安装均不自动授权代码执行。仓库当前 CLI 的安装、检查、准入、战斗和回放步骤见 [npm 内容包](npm-content.md)。预览入口和开发服务器的完整作者体验仍由 #223／#244 跟踪。

# 创建并测试 TypeScript 内容包

这个入口创建一个标准 npm 包：包含精灵、技能、减速印记、TypeScript 效果、场景测试和供编码助手使用的 Agent Skill。首个示例命中后减速两回合，重复命中刷新持续时间而不叠加幅度；可以在此基础上修改内容。它不会安装、批准、发布或部署内容。

## 从独立模板开始

桌面端的内容工作台默认打开内容库。可以从一个技能、一枚印记、一只精灵或若干对象开始；特性和纹章是带对应标签的印记。跨分类勾选后可集中编辑多语言名称与描述，或准备外部 AI 的协作上下文。精灵的关联列表支持选择已有内容，也支持“新建并关联”。

顶部只保留项目、语言和有草稿时的保存操作；点击项目名展开切换项目与外部工具。打开基础包源目录（本仓库的 `packs/base`）时，工作台按它原有的 `pack.json` 文件清单只读浏览内容和语言，不修改基础包布局。基础包不能在工作台内修改、导入资源、连接开发 SDK 或运行生成文件的任务；复制出的 MCP 配置也只提供读取。自己的内容包仍按原来的草稿、保存与外部冲突流程编辑。

新建时只需选择类型和名称，稳定标识与建议位置折叠在“对象标识与保存位置”中。定义默认保存到对应 `data` 目录内的新文件，可调整子目录；已有文件的整理、合并与移动仍使用外部工具。新建对象和关联先进入草稿，“查看并保存”核对后才写入磁盘。文件移动后会按 ID 重新定位，但未保存草稿必须先核对新来源；路径或 ID 被占用不会覆盖原文件。多个文件逐个保存，部分成功时保留其余草稿。YAML 的共享字段保持只读。

“资源”支持导入本地图片、音频和 SWF，并独立预览、查看使用位置。导入立即复制到项目的 `assets/imports`，资源定义和表现关联分别进入草稿保存。效果代码和文件组织使用外部编辑器。

“AI 协作”展示本次允许修改和仅供参考的内容，可选择是否包含未保存草稿。复制上下文给外部 AI 后，导入返回的 JSON 建议，逐项采用到草稿，再通过相同的保存核对写入。工作台不直接调用模型；素材也不会随上下文上传。“工具接入”中的 MCP 配置可访问整个源项目，协作页的对象选择不限制 MCP 的文件权限。外部工具改动文件时，继续走原有的刷新和冲突核对。

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

### 资源与表现

“形象与声音”保存到独立表现定义；资源 ID 与素材路径分开维护。资源页可查看使用者并修复位置，外部文件变动沿用草稿核对。详见 [表现格式 v2](content-presentation.md)。

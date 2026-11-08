# 内容包源项目

在 Arcadia 创作页编辑精灵、技能、印记和素材；代码、语言文件和测试通过外部编辑器维护。桌面创建时连接随应用提供的开发 SDK，不下载依赖。移到其他电脑后，通过 Arcadia 打开并连接该机器的 SDK，或使用独立 SDK 安装流程。

此模板基于 arcadia-eternity/content-pack-template 的 MIT 示例；保留 LICENSE。

## Agent 提示与 skill

SDK 构建模板携带 `skills/arcadia-content-authoring/SKILL.md` 和 `skills/seer2-recreate-pet/SKILL.md`。通用内容创作使用前者；按提供的资料复刻精灵使用后者，其中包含文件组织、机制取舍和测试规范，不附带外部数据或获取地址。可让 Agent 直接读取相应文件，无需主仓库。已有项目也可读取安装的 `@arcadia-eternity/content-sdk/dist/template/skills/` 目录；SDK 更新不会自动覆盖项目中的 skill 副本。

## 分离的表现与资源（v2）

表现关联位于 `data/presentations/main.yaml`，资源定义位于 `data/resources/main.yaml`。规则只描述游戏内容，表现通过对象 ID 关联，图片与声音使用稳定资源 ID。移动素材时只更新资源定义的 `source`。见 [表现说明](docs/presentation.md)。

## 依赖内容包

复用其他包的技能、印记或资源时，将其声明为 `package.json` 的运行依赖（`dependencies`），并使用已安装版本支持的引用格式。`npm test` 使用标准助手，通过 npm 安装候选及其依赖，再由共享加载器组装环境；不需要另写依赖加载器。官方 base 同样必须是运行依赖，且使用包含静态适配产物的构建版本。不要把开发目录中的 `file:../sdk/*.tgz` 当成可分发的依赖地址。

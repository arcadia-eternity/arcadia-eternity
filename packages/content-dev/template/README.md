# 内容包源项目

在 Arcadia 创作页编辑精灵、技能、印记和素材；代码、语言文件和测试通过外部编辑器维护。桌面创建时连接随应用提供的开发 SDK，不下载依赖。移到其他电脑后，通过 Arcadia 打开并连接该机器的 SDK，或使用独立 SDK 安装流程。

此模板基于 arcadia-eternity/content-pack-template 的 MIT 示例；保留 LICENSE。

## Agent 提示与 skill

让助手按任务读取项目中的技能。

| 任务                     | 文件                                        |
| ------------------------ | ------------------------------------------- |
| 创作内容、编写效果和测试 | `skills/arcadia-content-authoring/SKILL.md` |
| 根据资料复刻精灵         | `skills/seer2-recreate-pet/SKILL.md`        |
| 提交或同步源码           | `skills/arcadia-content-git/SKILL.md`       |
| 检查发行归档、发布版本   | `skills/arcadia-content-release/SKILL.md`   |

已有项目可通过新版 MCP 的 `author_reference` 读取 `git` 或 `release` 主题，也可直接读取已安装 SDK 的 `dist/template/skills/` 目录。

## 分离的表现与资源（v2）

表现关联位于 `data/presentations/main.yaml`，资源定义位于 `data/resources/main.yaml`。规则只描述游戏内容，表现通过对象 ID 关联，图片与声音使用稳定资源 ID。移动素材时只更新资源定义的 `source`。见 [表现说明](docs/presentation.md)。

`data/`、`locales/` 和 `src/` 只用于源项目创作。发行检查生成的归档包含预构建内容、效果、声明的素材及包元数据；安装后的包为只读，修改内容需要回到本项目重新构建并发布新版本。

## 依赖内容包

复用其他包的技能、印记或资源时，将其声明为 `package.json` 的运行依赖（`dependencies`），并使用已安装版本支持的引用格式。`npm test` 使用标准助手，通过 npm 安装候选及其依赖，再由共享加载器组装环境；不需要另写依赖加载器。官方 base 同样必须是运行依赖，且使用包含静态适配产物的构建版本。不要把开发目录中的 `file:../sdk/*.tgz` 当成可分发的依赖地址。

## 发行

在 Arcadia 工作台选择「检查并生成发行包」，也可以用支持发行检查的 SDK 执行 `arcadia-content workspace . release --execute`。源项目保留 `private: true`。提交版本和锁文件后创建 `v<版本>` 标签。在 GitHub Actions 手动选择该标签运行 **Release content pack**。可选的 npm Trusted Publishing 与 GitHub Release 分发同一份经测试的归档。模板的发行脚本可使用锁定的公开 SDK 4.6.0 运行。桌面启动工作流时会核对本地归档的 SHA-512。

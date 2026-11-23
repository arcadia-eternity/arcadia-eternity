# 版本与发行工作流

本页记录仓库中的工作流配置。`main` 是集成和发行分支。代码合入、CI 通过和正式发行分别记录。生产部署、SDK/npm 公开发行、签名安装版与升级验收继续由 #217／#219／#221／#242 跟踪。

| 工作流                                                      | 配置职责                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------- |
| [战斗检查](../.github/workflows/battle-baseline.yml)        | 对 `main` 的 PR 和 push 按路径选择内核、服务端、网页、CLI 检查        |
| [Release Please](../.github/workflows/release-please.yml)   | 基于 `main` 管理版本与发行，创建正式发行后触发 npm 发布及生产分支部署 |
| [生产镜像](../.github/workflows/build-production-image.yml) | 构建和推送生产 Docker 镜像                                            |
| [桌面发行](../.github/workflows/release.yaml)               | 构建 macOS、Windows、Linux 安装包和客户端差分更新清单                 |
| [包发布](../.github/workflows/publish-packages.yaml)        | 由 Release Please 调用，按标签向 npm 发布创作 SDK 或三个官方内容包    |
| [开发镜像](../.github/workflows/build-docker.yaml)          | 开发 Docker 镜像构建                                                  |
| [开发通知](../.github/workflows/deploy-development.yml)     | 镜像就绪通知与手动部署提示                                            |
| [Fly.io 部署](../.github/workflows/deploy-flyio.yaml)       | Fly.io 镜像部署配置；运行方式见[单进程部署](guides/server-runtime.md) |

## 客户端和官方内容发版

Release Please 根据改动路径维护一个发行 PR，客户端和官方内容分别计算版本。只有一方有待发改动时，合并 PR 只发布这一方。两边都有待发改动时，合并一次就会在同一提交上创建两个标签，工作流先发布 SDK，再发布三个内容包，随后构建桌面客户端和生产镜像。[发行版本清单](../.release-please-manifest.json)

| 要发布的内容 | 触发发行 PR 的例子                                                        | 合并发行 PR 后                                                                                                  |
| ------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 客户端       | 在桌面端提交 `fix(desktop): 修复退出时更新`                               | 创建 `arcadia-eternity-vX.Y.Z`，发布桌面安装包、差分清单、同版 SDK 和生产镜像                                   |
| 官方基础包   | 在 `packs/base/` 提交 `fix(base): 修正技能威力` 或 `feat(base): 添加精灵` | 更新基础包版本和 changelog，创建 `data-pack-base-vX.Y.Z` 并发布 `@arcadia-eternity/data-pack-base@X.Y.Z` 到 npm |

默认环境 `@arcadia-eternity/environment-default` 和 120 资质环境 `@arcadia-eternity/environment-training-120` 与基础包共用一个版本、发行 PR 和 `data-pack-base-vX.Y.Z` 标签。只改环境规则也走这条发行线。一个任务校验三份归档，按基础包、环境包的顺序发布。每个环境包的 npm 依赖精确指定同版基础包，`engines.arcadia` 来自该版基础包。

创作 SDK、基础包和两个环境包在 npm 上都信任 `arcadia-eternity/arcadia-eternity` 的 `release-please.yml`。自动发布和手动重试均从这个工作流进入。客户端单独发版时使用清单里已发布的内容标签。[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)

GitHub 为基础包保留发行草稿，玩家通过 npm 收到稳定版，GitHub 的公开桌面更新入口继续指向客户端。如果部分包已发布，优先在原 Actions run 中重跑失败任务。手动重试时，在 “Release Please” 的 `npm_tag` 填相同标签和首轮归档所在的 `verified_run_id`。工作流校验来源仓库、发行工作流、标签提交和归档哈希，再补发缺失的包。

桌面和生产服务端构建从该次提交的版本清单选择基础包标签，将该标签下的基础包和两个环境包作为离线初始内容。切换到独立环境包布局时，先发布包含三个目录的数据标签，再构建正式客户端或服务端。日常开发仍使用工作区源码。

只有内容开始使用新的宿主机制时，才需要提高 `packs/base/package.json` 的 `engines.arcadia`。例如，首次使用客户端 4.17.0 提供的战斗接口时，将范围改为 `^4.17.0`。如果所需客户端也在本次发行中，按发行 PR 中算出的客户端版本修改这一行，合并前核对最终 diff。打包检查会验证客户端版本落在声明范围内。

正式版桌面客户端会在后台下载兼容的官方基础包并更新两个官方预设，玩家也可以在内容包详情手动检查。独立服也会自动检查并热更新官方预设，固定版本和回滚见[服务端运行指南](guides/server-runtime.md#独立更新官方基础包)。

桌面当前使用 Electron。开发预览可使用网页包的 `build:desktop:preview`；正式发布入口要求完整 notices，详见[桌面宿主](guides/desktop-ugc-host.md)。本地开发物料和未签名预览分别记录验收结果。

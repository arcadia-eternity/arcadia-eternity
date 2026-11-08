# 版本与发行工作流

本页记录仓库中的工作流配置。`main` 是集成和发行分支。代码合入、CI 通过和正式发行分别记录。生产部署、SDK/npm 公开发行、签名安装版与升级验收继续由 #217／#219／#221／#242 跟踪。

| 工作流                                                      | 配置职责                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------- |
| [战斗检查](../.github/workflows/battle-baseline.yml)        | 对 `main` 的 PR 和 push 按路径选择内核、服务端、网页、CLI 检查        |
| [Release Please](../.github/workflows/release-please.yml)   | 基于 `main` 管理版本与发行，创建正式发行后触发 npm 发布及生产分支部署 |
| [生产镜像](../.github/workflows/build-production-image.yml) | 构建和推送生产 Docker 镜像                                            |
| [桌面发行](../.github/workflows/release.yaml)               | Electron macOS／Windows 构建与发布配置                                |
| [包发布](../.github/workflows/publish-packages.yaml)        | 从正式 tag 构建、验证和发布 UGC SDK 到 npmjs.org                      |
| [开发镜像](../.github/workflows/build-docker.yaml)          | 开发 Docker 镜像构建                                                  |
| [开发通知](../.github/workflows/deploy-development.yml)     | 镜像就绪通知与手动部署提示                                            |
| [Fly.io 部署](../.github/workflows/deploy-flyio.yaml)       | Fly.io 镜像部署配置；运行方式见[单进程部署](guides/server-runtime.md) |

版本配置位于根 `package.json`、[release-please 配置](../.github/release-please-config.json)和[版本清单](../.release-please-manifest.json)。工作流存在只说明配置已入库，实际发布结果需检查对应运行和产物。

桌面当前使用 Electron。开发预览可使用网页包的 `build:desktop:preview`；正式发布入口要求完整 notices，详见[桌面宿主](guides/desktop-ugc-host.md)。本地开发物料和未签名预览分别记录验收结果。

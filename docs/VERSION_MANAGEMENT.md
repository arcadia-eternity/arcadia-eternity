# 版本与发行工作流

本页记录仓库中的工作流配置。`main` 是集成和发行分支。代码合入、CI 通过和正式发行分别记录。生产部署、SDK/npm 公开发行、签名安装版与升级验收继续由 #217／#219／#221／#242 跟踪。

| 工作流                                                      | 配置职责                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------- |
| [战斗检查](../.github/workflows/battle-baseline.yml)        | 对 `main` 的 PR 和 push 按路径选择内核、服务端、网页、CLI 检查        |
| [Release Please](../.github/workflows/release-please.yml)   | 基于 `main` 管理版本与发行，创建正式发行后触发 npm 发布及生产分支部署 |
| [生产镜像](../.github/workflows/build-production-image.yml) | 构建和推送生产 Docker 镜像                                            |
| [桌面发行](../.github/workflows/release.yaml)               | 构建 macOS、Windows、Linux 安装包和客户端差分更新清单                 |
| [包发布](../.github/workflows/publish-packages.yaml)        | 按标签分别验证并发布创作 SDK 或官方基础包到 npm                       |
| [开发镜像](../.github/workflows/build-docker.yaml)          | 开发 Docker 镜像构建                                                  |
| [开发通知](../.github/workflows/deploy-development.yml)     | 镜像就绪通知与手动部署提示                                            |
| [Fly.io 部署](../.github/workflows/deploy-flyio.yaml)       | Fly.io 镜像部署配置；运行方式见[单进程部署](guides/server-runtime.md) |

## 单独发布客户端或基础包

Release Please 按改动路径维护两个发行 PR。两边都有改动时，可以分别合并。常规发版不用手改版本号或推送标签。

| 要发布的内容 | 触发发行 PR 的例子                                                        | 合并对应发行 PR 后                                                                                              |
| ------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 客户端       | 在桌面端提交 `fix(desktop): 修复退出时更新`                               | 创建 `arcadia-eternity-vX.Y.Z`，发布桌面安装包、差分清单、同版 SDK 和生产镜像                                   |
| 官方基础包   | 在 `packs/base/` 提交 `fix(base): 修正技能威力` 或 `feat(base): 添加精灵` | 更新基础包版本和 changelog，创建 `data-pack-base-vX.Y.Z` 并发布 `@arcadia-eternity/data-pack-base@X.Y.Z` 到 npm |

只改 `packs/base/**` 会进入基础包的发行 PR。GitHub 为该包保留发行草稿，玩家通过 npm 收到稳定版，GitHub 的公开桌面更新入口继续指向客户端。npm 发布失败可以在 “Publish UGC Packages” 中用同一标签重试。

桌面和生产服务端构建从该次提交的版本清单选择基础包标签，将该标签的源码作为离线初始内容。首次独立发行之前使用最后一个联合发行标签 `arcadia-eternity-v4.11.1`。日常开发仍使用工作区源码。

如果新内容需要宿主提供新能力，更新基础包的 `engines.arcadia`。旧宿主会选适合自己的最新版本。桌面玩家在内容包详情检查更新，独立服务端的更新与回滚见[服务端运行指南](guides/server-runtime.md#独立更新官方基础包)。

客户端版本配置见[发行配置](../.github/release-please-config.json)和[版本清单](../.release-please-manifest.json)。

桌面当前使用 Electron。开发预览可使用网页包的 `build:desktop:preview`；正式发布入口要求完整 notices，详见[桌面宿主](guides/desktop-ugc-host.md)。本地开发物料和未签名预览分别记录验收结果。

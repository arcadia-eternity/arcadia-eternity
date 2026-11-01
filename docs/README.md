# 文档导航

当前实现以 V4 为准，从 [V4 战斗指南](v4/direct-v1-port.md) 开始。重构进度与未完成验收统一记录在 [4.0 总览 #200](https://github.com/arcadia-eternity/arcadia-eternity/issues/200)。

| 工作                                  | 文档                                                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 选择测试与跨宿主检查                  | [测试指南](testing-guide.md)                                                                                                                 |
| 从旧版本迁移、查询已删除文档          | [V4 迁移与历史资料](v4/migration.md)                                                                                                         |
| 官方内容文件、系列归属与批量整理      | [内容结构](v4/content-structure.md)                                                                                                          |
| 创建 npm 内容包、桌面工作台与外部助手 | [作者入门](v4/ugc-authoring-start.md)、[工具链职责](v4/ugc-toolchain-design.md)                                                              |
| TypeScript 效果、参数与持续取值       | [Effect SDK](v4/effect-sdk.md)、[效果编写](v4/effect-authoring.md)                                                                           |
| 行为定义、独立使用与已有模板          | [行为使用](v4/behavior-uses.md)、[模板目录](v4/ugc-effect-catalog.md)                                                                        |
| 包安装、版本选择与源码编辑边界        | [内容管理](v4/content-management.md)、[管理界面](v4/content-manager-design.md)                                                               |
| npm 依赖、准入、环境与项目导出        | [npm 内容包](v4/npm-content.md)                                                                                                              |
| 资源、表现、语言与描述配色            | [内容表现](v4/content-presentation.md)                                                                                                       |
| 本机候选与草稿试战                    | [候选预览](v4/development-preview.md)、[试战生命周期](v4/local-trial-lifecycle.md)                                                           |
| 旧作品文件与命名空间兼容              | [作品数据](v4/ugc-works.md)                                                                                                                  |
| Node、浏览器、CLI 与服务端接入        | [宿主接入](v4/native-hosts.md)、[CLI](v4/cli.md)                                                                                             |
| 快照、内容身份与行为兼容              | [快照](v4/v1-snapshots.md)、[兼容约定](v4/compatibility.md)                                                                                  |
| 服务端运行、普通匹配与身份            | [单进程服务端](v4/server-runtime.md)、[账号提供商](v4/account-provider-design.md)                                                            |
| 配套网页、桌面选服与公开内容同步      | [客户端边界](v4/client-server-boundaries.md)、[部署](v4/paired-web-deployment.md)                                                            |
| 静态离线网页与桌面本机宿主            | [静态网页](v4/static-web.md)、[桌面宿主](v4/desktop-ugc-host.md)                                                                             |
| SWF 桌面播放器                        | [隔离与合成](v4/swf-desktop-isolation.md)                                                                                                    |
| 战斗数值显示与动画维护                | [修改器显示](MODIFIER_UI_USAGE_EXAMPLE.md)、[属性评估](ATTRIBUTE_EVALUATION_STRATEGIES.md)、[动画生命周期](animation-state-machine-audit.md) |
| 版本和发行工作流                      | [版本管理](VERSION_MANAGEMENT.md)                                                                                                            |

历史 DSL、V2 基线、Redis/gRPC 集群及旧包分发方案已退出当前文档集，追溯方式见迁移指南。测试仍使用的来源映射、candidate JSON 与验证记录保留在 [validation](v4/validation/README.md)；当次测试和 CI 才能说明当前验证结果。

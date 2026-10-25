# 文档导航

V4 的入口、内容维护和恢复约定从 [V4 指南](v4/direct-v1-port.md) 开始阅读。

| 主题                               | 入口                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 内容文件、系列归属与批量整理       | [内容结构](v4/content-structure.md)                                                                                          |
| TypeScript 效果、参数与持续取值    | [效果编写](v4/effect-authoring.md)                                                                                           |
| 统一作品、三级 UGC、分享与工坊设计 | [UGC 设计](v4/ugc-design.md)、[领域词汇](v4/ugc/CONTEXT.md)                                                                  |
| Node、浏览器、CLI 与服务端接入     | [宿主接入](v4/native-hosts.md)                                                                                               |
| 快照边界、内容身份与恢复           | [快照](v4/v1-snapshots.md)                                                                                                   |
| V1 参考与显式行为修正              | [兼容约定](v4/compatibility.md)                                                                                              |
| V2 golden 的维护                   | [回归基线](v4/battle-baseline.md)                                                                                            |
| 历史 DSL 示例                      | [Config 修饰](ConfigModifierDSLExamples.md)、[阶段修饰](PhaseAwareDSLExamples.md)、[标签配置](TaggedConfigSystemExamples.md) |
| Modifier 界面                      | [使用示例](MODIFIER_UI_USAGE_EXAMPLE.md)                                                                                     |
| 通用内容包格式                     | [Pack Spec](pack-spec.md)、[lockfile](pack-lockfile-v2.md)                                                                   |
| 当前服务端运行与部署               | [单进程房间与身份](v4/server-runtime.md)                                                                                     |
| 服务端账号与持久化                 | [账号提供商设计](v4/account-provider-design.md)                                                                              |
| 测试入口                           | [测试指南](testing-guide.md)、[V4 检查命令](v4/direct-v1-port.md#验证)                                                       |

历史 DSL 示例与旧迁移计划对应其原版本；修改 V4 时，以本指南链接的当前约定及源码为准。历史提交、逐批实现过程和旧验证输出可从 Git 查询。

## 历史服务端文档

以下文档记录已退出默认服务端的集群与战报方案，仅供追溯旧实现；当前服务端部署、账号配置和停机语义以[单进程房间与身份](v4/server-runtime.md)为准。

- 旧集群：[部署指南](cluster-deployment.md)、[端口配置](cluster-port-configuration.md)、[运行失败矩阵](server-runtime-failure-matrix.md)。
- 旧战报：[战报系统](battle-report-system.md)、[故障排查](battle-reports-troubleshooting.md)。

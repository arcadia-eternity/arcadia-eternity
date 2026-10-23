# 文档导航

V4 的入口、内容维护和恢复约定从 [V4 指南](v4/direct-v1-port.md) 开始阅读。

| 主题                            | 入口                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 内容文件、系列归属与批量整理    | [内容结构](v4/content-structure.md)                                                                                          |
| TypeScript 效果、参数与持续取值 | [效果编写](v4/effect-authoring.md)                                                                                           |
| Node、浏览器、CLI 与服务端接入  | [宿主接入](v4/native-hosts.md)                                                                                               |
| 快照边界、内容身份与恢复        | [快照](v4/v1-snapshots.md)                                                                                                   |
| V1 参考与显式行为修正           | [兼容约定](v4/compatibility.md)                                                                                              |
| V2 golden 的维护                | [回归基线](v4/battle-baseline.md)                                                                                            |
| 历史 DSL 示例                   | [Config 修饰](ConfigModifierDSLExamples.md)、[阶段修饰](PhaseAwareDSLExamples.md)、[标签配置](TaggedConfigSystemExamples.md) |
| Modifier 界面                   | [使用示例](MODIFIER_UI_USAGE_EXAMPLE.md)                                                                                     |
| 通用内容包格式                  | [Pack Spec](pack-spec.md)、[lockfile](pack-lockfile-v2.md)                                                                   |
| 服务端运行失败处理              | [运行失败矩阵](server-runtime-failure-matrix.md)                                                                             |
| 集群运维                        | [部署](cluster-deployment.md)、[端口](cluster-port-configuration.md)                                                         |
| 战报运维                        | [战报系统](battle-report-system.md)、[故障排查](battle-reports-troubleshooting.md)                                           |
| 测试入口                        | [测试指南](testing-guide.md)、[V4 检查命令](v4/direct-v1-port.md#验证)                                                       |

历史 DSL 示例与旧迁移计划对应其原版本；修改 V4 时，以本指南链接的当前约定及源码为准。历史提交、逐批实现过程和旧验证输出可从 Git 查询。

以下命令使用桌面「终端命令」提供的 `arcadia-content`。在 PATH 中找不到短名称时，保留复制出的程序路径和引号，再替换参数。所有 `workspace .` 命令都以当前目录为项目。

| 任务           | 命令                                                        | 输出或后续动作                       |
| -------------- | ----------------------------------------------------------- | ------------------------------------ |
| 创建资料包     | `arcadia-content init pack frost-pack`                      | 在新目录生成精灵、技能和场景测试。   |
| 创建赛制       | `arcadia-content init environment singles-cup`              | 生成环境清单与两个测试队。           |
| 查看当前项目   | `arcadia-content workspace . describe`                      | 核对目录、源码版本和能力。           |
| 静态检查       | `arcadia-content workspace . check`                         | 根据诊断修复字段或引用。             |
| 运行资料包测试 | `arcadia-content workspace . test --execute`                | 读取场景断言和失败日志。             |
| 固定种子演示   | `arcadia-content workspace . demo --execute --seed example` | 对比同一版本、队伍和输入下的结果。   |
| 启动试玩       | `arcadia-content workspace . preview --execute`             | 保持命令运行；结束用 Ctrl+C。        |
| 检查发行归档   | `arcadia-content workspace . release --execute`             | 记录生成的文件名、版本和完整性摘要。 |

## 把命令交给外部工具

要查询当前安装版本的命令清单，用 `arcadia-content commands --json`。同一项目在工作台中打开时，命令读取已保存的源码和队伍。需要确认本地草稿时，通过桌面连接的 MCP 调用 `workspace_context`。

`arcadia` 是对战和服务端命令。查一个资料包能否构建时使用上表的创作命令；需要在已应用的玩家环境模拟对战或验证回放时，再使用 `arcadia battle`。

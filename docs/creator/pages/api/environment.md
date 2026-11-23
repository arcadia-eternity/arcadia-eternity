**独立环境项目**在根目录 `package.json` 的 `dependencies` 选择资料包版本，以 `arcadiaEnvironment` 保存赛制。**资料包内的命名调试环境**位于 `debug/environments/<id>.json`，用于验证这个包在不同组合下的行为。

| 名称         | 在创作流程中的含义                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------- |
| `id`、`name` | 环境的稳定标识和显示名称。资料包内的 `default` 是内置调试环境。                                     |
| `packages`   | 经 `environment_list` 读取的环境文档中，用包名与版本要求选择资料包；独立项目保存时与 npm 清单对应。 |
| `sources`    | 选择已建立本机映射的协作源码。共享项目文件保留包名，本机目录由本机映射解析。                        |
| `rules`      | 对局和队伍规则。`rules.team.maxSize` 限定可携带的精灵数量。                                         |
| `requires`   | 环境声明的要求。修改其他字段时保留已配置的要求。                                                    |

## 修改和应用

1. 用 `environment_list` 读取当前环境文档及版本。独立项目和资料包的调试环境都可以通过这一路径查询。
2. 在文档上修改目标规则。将完整 `document` 和原 `expectedVersion` 传给 `environment_save`。在资料包里新建命名环境时传 `null`。
3. 用 `preview_start` 准备新版本。资料包使用命名环境时传 `environmentId`。等待就绪后，以返回的任务 ID 调用 `team_validate`。

`team_validate` 返回 `valid: false` 表示该队伍未通过这版赛制的准入。换环境或换了队伍文件，要重新取得对应的校验结果。[用两支队伍验证人数上限](../make/singles-cup.md)

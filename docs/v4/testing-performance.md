# V4 战斗测试的执行与触发范围

`pnpm test:battle-v4` 使用独立进程并行运行测试文件，默认工作进程数为 `min(2, availableParallelism())`。每个文件保持隔离，单个文件内部顺序执行，避免共享的配置仓库、日志和模拟计时器互相影响。可以按机器负载覆盖并发数：

```sh
pnpm test:battle-v4 --maxWorkers=4
pnpm test:battle-v4 test/v4/port.test.ts
```

公共包入口指向 `dist`，修改运行时代码后仍需先构建相关依赖。不要直接以 `--changed` 推断源文件与测试的关系：运行时导入的是构建产物，测试还会读取 YAML 和 JSON 文件。

## 测试准备与分片

大型候选套件按文件缓存解析后的原始 YAML，再为每个候选深拷贝，保持对象独立。印记附加用例由多个文件调用共享套件注册，每个用例执行一次；各分片只加载需要的 oracle，聚合断言仍检查完整候选集合。修改分片时检查用例身份和重复次数，保留来源哈希与行为断言。

## CI 的选择规则

工作流始终创建原有检查，通过轻量 `changes` job 按改动范围决定是否运行。这样无关改动会跳过测试，原检查名称仍存在，不使用会让必需检查一直等待的工作流级 `paths` 过滤。

| 改动                                              | 运行范围                           |
| ------------------------------------------------- | ---------------------------------- |
| 普通文档、其他工作流、监控配置                    | 跳过四个战斗 job                   |
| server                                            | 服务端检查                         |
| console、packages/cli、bin                        | 服务端和离线 CLI 检查              |
| 根 rolldown.config.js                             | 离线 CLI 检查                      |
| web-ui、resource                                  | 浏览器检查                         |
| client、database、p2p-transport 等两端共用依赖    | 服务端和浏览器检查                 |
| battle、基础内容包、pack-loader、公共运行时依赖   | 全部战斗检查                       |
| V4 回归 JSON、示例、V1 来源清单、等待快照验证脚本 | 核心战斗检查                       |
| content-dev、SDK 打包脚本与 UGC 示例              | 按消费依赖覆盖服务端、浏览器和 CLI |
| 锁文件、共享根配置、运行时构建脚本或本工作流      | 全部战斗检查                       |

`headless-battle`、`native-server-entry`、`native-browser-entry`、`offline-cli` 四个 job 分别使用 `headless`、`server`、`browser`、`cli` 输出。服务端 job 的根 CLI 类型检查包含 `packages/cli` 源码，所以该包和 console 的改动会覆盖服务端与离线 CLI；server 本身不属于离线 CLI 依赖，不会触发离线测试。离线测试会构建根 CLI bundle，所以 `bin` 和根 `rolldown.config.js` 也纳入其范围。

包的传递依赖从 workspace manifests 递归推导，修改相关包内部任意文件时保守运行该包对应的检查。手动执行、缺失 Git 历史、无法确定改动范围时全部运行。PR 使用合并基点，push 使用前后提交，重命名同时考虑新旧路径。同一 PR 或分支的新提交会取消旧的未完成运行。

现有全仓 `pnpm lint` 仍在核心战斗 job 内，会与该 job 一起跳过；尚无独立的全仓 lint 门禁。

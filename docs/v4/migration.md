# V4 迁移与历史资料

V4 默认使用原生战斗内核、单进程服务器和可信 TypeScript 内容包。当前行为依据见 [V4 战斗指南](direct-v1-port.md)，剩余产品与发行验收见 [#200](https://github.com/arcadia-eternity/arcadia-eternity/issues/200) 和 [#221](https://github.com/arcadia-eternity/arcadia-eternity/issues/221)。

## 旧方案的当前入口

| 旧资料或入口                                                 | 当前做法与文档                                                                                                                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| V2 战斗、旧引擎、V2 golden 检查命令                          | 默认 battle 导出 V4；行为比较使用[兼容约定](compatibility.md)及[当前测试](../testing-guide.md)                                                 |
| Effect DSL、selector/operator 教程、Rule Graph               | 新效果使用 [Effect SDK](effect-sdk.md) 与[作者 API](effect-authoring.md)；已有行为见[行为定义](behavior-uses.md)                               |
| RxJS 属性订阅、旧自动清理示例                                | 内核使用同步响应值；持续绑定、来源释放和抑制见[效果编写](effect-authoring.md)                                                                  |
| Redis/gRPC 集群、跨实例迁移和批量消息调参                    | [单进程服务端](server-runtime.md)拥有房间与会话；重启结束房间，跨进程持久恢复归 #224／#244                                                     |
| ELO、排位、旧战报、旧邮箱继承                                | 默认普通匹配为 FIFO；[账号](account-provider-design.md)使用本服身份；G4 排位／录像分别归 #233／#234，旧资产清理归 #213                         |
| V2 pack spec、Pack Service、Tauri workspace 和浏览器缺包安装 | [npm 内容包](npm-content.md)由 Node／Electron／CLI 宿主安装；网页读取服务器公开目录并按需加载素材，见[客户端边界](client-server-boundaries.md) |
| 可写官方基础包、旧数据编辑器、fsloader 热重载                | [作者工作台](ugc-authoring-start.md)编辑自己的源项目；基础包和安装产物只读，保存后另行构建候选                                                 |
| 独立资源包与旧 assets mappings                               | [表现格式 v2](content-presentation.md)分离规则、资源定义、表现绑定和语言                                                                       |
| 旧 Fly.io 集群与 Tauri 发行步骤                              | [配套网页部署](paired-web-deployment.md)、[桌面宿主](desktop-ugc-host.md)及[现有发行工作流](../VERSION_MANAGEMENT.md)                          |

`@arcadia-eternity/battle/v4/legacy` 与测试 oracle 继续用于历史比较。固定 candidate、来源哈希、导入图和快照验证输入仍由测试读取；维护前先检查静态与动态文件引用。

## 用户数据与内容包

- 修改前导出私人队伍与作品文件，保留原文件。队伍中的缺失 ID 继续显示并允许保存草稿；开战需要目标环境的完整定义，见[缺失内容](content-management.md#队伍与缺失内容)。
- 旧 `.arcadia`／WorkRelease 的显式加载和兼容接口保留，见[旧作品数据](ugc-works.md)。它们与标准 npm 源项目、已安装版本分别维护；导入不会自动转换任意 TS 引用或启用代码。
- 旧资源声明需按表现格式 v2 转换并重新构建，不能只改格式版本号。源码保存、npm 安装和运行环境准备分别完成；活动房间继续持有原环境。
- 旧 V2 对局与快照不提供恢复兼容。当前快照只支持[文档列出的等待点](v1-snapshots.md)；在线服务重启恢复仍待实施。
- 历史数据库、战报 API/UI 和配置资产的处置继续归 #213。此次清理只删除过时说明，保留现有用户数据与数据库资产。浏览器草稿迁移、安装版升级和完整异机交付继续由 #209／#214／#217／#221 验收。

## 查询历史资料

失效的旧文档直接从当前目录删除，Git 保留完整历史。以旧集群文档为例：

```sh
git log --all -- docs/cluster-deployment.md
git show <revision>:docs/cluster-deployment.md
```

`<revision>` 应选择删除前的提交。原 V2 基线可从 `989d10f1:docs/v4/battle-baseline.md` 查询当时的命令和差异记录。当前测试继续使用的 `packages/battle/test/fixtures/official-switch.input.json` 保留。

历史验证数字只属于当时提交。保留的[验证记录](validation/README.md)用于复查证据，当前结果由实际运行和对应提交的 CI 给出。

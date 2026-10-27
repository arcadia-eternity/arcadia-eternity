# 内容结构与批量迁移

战斗引擎提供装配和执行能力，基础内容包提供官方原生效果，宿主选择安装哪个内容实现。Species、Skill、Mark 仍是可编辑的 YAML 数据，行为仍由已审阅的 TypeScript 定义。

## 目录与依赖

| 位置                                                   | 职责                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| `packages/battle/src/v4/content/definition-catalog.ts` | 分配原型、解析引用、组合原生效果与独立行为使用、冻结目录、创建与恢复对战 |
| `packs/base/src/effects/`                              | 原有官方 TS 行为；按实现机制保留共享工厂、参数目录和闭包                 |
| `packs/base/src/content.ts`                            | 基础包的装配入口                                                         |
| `packs/base/data/groups/<group>/`                      | 按已确认系列组织的种族 YAML                                              |
| `packs/base/data/skill.yaml`、`mark*.yaml`             | 技能与印记的权威编辑数据；归属未确认时保留原位置                         |
| `packs/base/content-groups.yaml`                       | 稳定系列 ID、种族成员、关系和可选显式维护归属                            |
| `packages/pack-loader`                                 | 文件或 HTTP 传输、manifest、完整性与内容修订计算                         |

V2 `PackLoader`、战斗引擎和 `@arcadia-eternity/battle/node` 入口已移除；V4 宿主使用下方原生加载器。V4 测试仍使用的历史对战输入保留在 `packages/battle/test/fixtures`，旧用户内容需要保留原始数据并按后续迁移流程处理。

依赖方向为基础内容包依赖战斗引擎，宿主依赖所选择的内容包与加载器。加载器通过构造参数接收可信内容工厂，不自行选择官方实现。引擎不导入基础包。

```ts
import { NativePackLoader } from '@arcadia-eternity/pack-loader/native'
import { createOfficialContent } from '@arcadia-eternity/data-pack-base/native'
import { nativeBuildIdentity } from '@arcadia-eternity/data-pack-base/build'

const loader = new NativePackLoader(nativeBuildIdentity, createOfficialContent)
const { content } = await loader.load('builtin:base')
```

`createContentCatalog(data, revision, trustedFactory, behaviorRegistrations)` 是通用装配入口。它先分配所有 Mark，再调用可信工厂，随后连接 Effect、Skill、Species。技能与印记通过 BehaviorUse 引用宿主注册的可信原生行为；所有参数、来源与引用先通过校验，再执行行为构建器。重复 ID、缺失引用和使用来源不匹配会在发布目录前失败。规则包与规则 registry 接口已移除。

每场对战有独立的运行状态和参数配置。内容引用允许环；动作顺序、参数地址、捕获与跟随语义沿用已有实现。宿主提供的 revision 必须覆盖全部内容输入，包括作品版本、行为参数和可信构建。基础包的构建身份覆盖核心和原生实现，编辑数据由加载器计入内容修订。

## 编辑与归属

编辑器和工具应从 `pack.json` 的文件列表读取内容，保存回记录所在文件。默认文件名仅用于新建数据，不能假设整个种类只有一个文件。文件位置变化不改变内容 ID。

基础包的 `data.effects` 为空，效果行为由已编译的 TS 提供。`loadMetadata` 读取可编辑元数据，供编辑器合并数据层和资源加载使用；`load` 或 `fromMetadata` 再完成行为装配与引用检查。旧效果 YAML 只保存在回归测试夹具中。

系列用于组织内容，不是运行时命名空间，也不决定所有被引用技能的维护归属。跨系列引用合法；同一个技能可以由一个系列维护，被多个系列使用。未引用资源仍保留，动态行为可能使用它们。

归属配置可以增加：

```yaml
owners:
  skills:
    skill_example: example_group
  marks:
    mark_example: example_group
  effects:
    effect_example: example_group
```

只有显式归属进入迁移计划。引用图产生候选，不能单凭使用者数量确定所有权。当前种族已全量分组；技能、印记与行为实现继续通过稳定 ID 装配，不需要为了目录整理重写机制。

## 批量工具

在仓库根目录执行：

```sh
node scripts/content-structure.mjs inventory
node scripts/content-structure.mjs plan --out /tmp/content-plan.json
node scripts/content-structure.mjs apply --plan /tmp/content-plan.json --root packs/base
node --test scripts/content-structure.test.mjs
```

`inventory --out <file>` 保存完整资源图与候选，终端只显示摘要。`--effects <file>` 可输入当前原生目录的 Effect ID JSON 数组，检查效果引用；未提供时会明确报告未检查。输出文件必须不存在。

`plan` 不修改内容。`apply` 检查输入是否变化、目标是否冲突、路径是否越界，先写新文件，再切换 manifest，最后清理原文件。已有迁移路径保持稳定，重复应用不会重复生成数据。

只有一个源文件的所有记录都明确归属时，工具才拆分该文件；有未确认记录的源文件保留。连续分组片段保留全局顺序，YAML 别名在需要跨文件拆分时展开，字段值和数组顺序必须相等。计划是一次操作的临时输入，不作为源码审计账本提交。

原生 TS 已是行为来源，旧 DSL 转换生成器已经移除。行为调整直接修改 TS 并运行回归测试。共享闭包和 ParameterCatalog 保持整体，进一步拆分需按依赖形态制定转换规则。

## 当前范围

基础内容包保持 `private: true`。本次提供可独立安装的代码接口和数据组织基础，未发布 npm 包，也未加入下载后自动执行代码的插件加载器。编辑器 preset、原生依赖引用槽、完整克隆流程和分发产品仍分别实现；现有任意 TS 回调中的内容 ID 不会被自动重写。

构建顺序为 battle、基础内容包和加载器、宿主。根构建命令与相关 CI、网页启动入口已包含基础包。开发监听会在代码变化后刷新相应构建身份。

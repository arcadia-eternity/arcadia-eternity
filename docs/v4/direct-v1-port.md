# V4 战斗指南

V4 从 V1 的 Battle、Player、Pet、Skill、Mark 和 Phase 领域模型直接移植，随后加入同步响应值、可恢复 RNG、可信 TypeScript 效果与宿主适配。初始来源为 `c086289812885e7a4903b181e2b8989e201452b8`；行为比较还参考后期 V1，差异见[兼容约定](compatibility.md)。

## 从哪里开始

| 工作                         | 文档                                                        | 实现入口                                    |
| ---------------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| 修改官方数据、效果及目录归属 | [内容结构](content-structure.md)                            | `packs/base/pack.json`、`packs/base/src/`   |
| 编写效果与配置参数           | [效果编写](effect-authoring.md)                             | `packages/battle/src/v4/content/authoring/` |
| 在宿主中创建对战             | [宿主接入](native-hosts.md)                                 | `packages/battle/src/v4-host/`              |
| 保存、恢复及续战             | [快照](v1-snapshots.md)                                     | `packages/battle/src/v4/snapshot.ts`        |
| 维护历史行为比较             | [兼容约定](compatibility.md)、[V2 基线](battle-baseline.md) | `packages/battle/test/v4/`                  |

公共内核入口为 `@arcadia-eternity/battle/v4`，宿主接口为 `/v4/host`，作者 API 为 `/v4/authoring`。默认 battle 包入口也导出 V4；旧 V2 引擎、旧编辑器及专属回归已移除。服务端新对战、浏览器本地/P2P 构造和 CLI 本地对战使用原生入口，具体选择与恢复规则见宿主指南。

官方行为直接维护 `packs/base/src/effects/` 中的 TypeScript，Species、Skill、Mark 元数据按 manifest 读取 YAML。旧 DSL 保留在 `/v4/legacy` 及测试夹具中，用于历史比较；离线转换生成器已移除。

## 验证

先构建 workspace 依赖；包公共入口指向 `dist`。常用检查如下，完整门禁以[战斗与宿主工作流](../../.github/workflows/battle-baseline.yml)为准。

```sh
pnpm build:package
pnpm typecheck:battle-v4
pnpm lint:battle-v4
pnpm test:battle-v4
pnpm typecheck:effect-authoring-design
pnpm test:effect-authoring-design
pnpm verify:battle-v4-source
pnpm verify:battle-v4-hosts
pnpm verify:battle-v4-native
pnpm verify:battle-v4-native-pack
```

测试并行方式、局部运行和 CI 触发范围见[战斗测试性能说明](testing-performance.md)。

`verify:battle-v4-source` 使用[核心导入图](v1-import-graph.json)、[额外来源映射](v1-extra-source-map.json)和[来源清单](v1-port-provenance.json)校验移植文件与依赖。修改映射源码后，先审查 diff，再用 `node scripts/verify-v1-port.mjs --refresh` 更新清单。历史源码可用 `git show <revision>:<path>` 查询。

验证结果由当次命令和 CI 给出。保留在 [validation](validation/README.md) 的 JSON 是固定回归输入和历史记录；数量、旧通过结果和候选覆盖率不代表全部效果已完成行为验收。

## 验收边界

原生入口已接入各宿主；逐效果的行为及依赖闭包验收、完整私房联机恢复仍需分别完成。有限 UGC 编译器、不可变环境和作者 API 各有独立合同，可信 TypeScript 回调不能作为上传代码沙箱。快照支持的等待点与实时资源恢复范围见快照指南。

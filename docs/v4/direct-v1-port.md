# V4 战斗指南

V4 以 Battle、Player、Pet、Skill、Mark 和 Phase 领域对象组织战斗，提供同步响应值、可恢复 RNG、TypeScript 效果和宿主适配。文档导航见 [docs 目录](../README.md)。

## 从哪里开始

| 工作                         | 文档                             | 实现入口                                    |
| ---------------------------- | -------------------------------- | ------------------------------------------- |
| 修改官方数据、效果及目录归属 | [内容结构](content-structure.md) | `packs/base/pack.json`、`packs/base/src/`   |
| 编写效果与配置参数           | [效果编写](effect-authoring.md)  | `packages/battle/src/v4/content/authoring/` |
| 在宿主中创建对战             | [宿主接入](native-hosts.md)      | `packages/battle/src/v4-host/`              |
| 保存、恢复及续战             | [快照](v1-snapshots.md)          | `packages/battle/src/v4/snapshot.ts`        |
| 战斗行为与回归               | [行为约定](compatibility.md)     | `packages/battle/test/v4/`                  |

公共内核入口为 `@arcadia-eternity/battle/v4`，宿主接口为 `/v4/host`，作者 API 为 `/v4/authoring`。默认 battle 包入口也导出 V4。服务端新对战、浏览器本地/P2P 构造和 CLI 本地对战使用原生入口，具体选择与恢复规则见宿主指南。

官方行为直接维护 `packs/base/src/effects/` 中的 TypeScript，Species、Skill、Mark 元数据按 manifest 读取 YAML。

## 验证

先构建 workspace 依赖；包公共入口指向 `dist`。常用检查如下，完整门禁以[战斗与宿主工作流](../../.github/workflows/battle-baseline.yml)为准。

```sh
pnpm build:package
pnpm typecheck:battle-v4
pnpm lint:battle-v4
pnpm test:battle-v4
pnpm typecheck:effect-authoring-design
pnpm test:effect-authoring-design
pnpm verify:battle-v4-hosts
pnpm verify:battle-v4-native
pnpm verify:battle-v4-native-pack
```

测试并行方式、局部运行和 CI 触发范围见[战斗测试性能说明](testing-performance.md)。

## 验收边界

原生入口已接入各宿主；逐效果的行为及依赖闭包验收、完整私房联机恢复仍需分别完成。npm 内容包、固定环境和作者 API 各有独立合同；代码在管理员批准的 Node／Electron／CLI 宿主执行，网页只消费公开目录与资源。可信 TypeScript 回调具有宿主进程权限。快照支持的等待点与实时资源恢复范围见快照指南。

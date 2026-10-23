# Effect authoring 示例与类型验证

正式实现位于 `packages/battle/src/v4/content/authoring/`，公共入口为 `@arcadia-eternity/battle/v4/authoring`。执行、参数、capture/follow 和恢复合同统一见[效果编写指南](../../../../docs/v4/effect-authoring.md)。官方行为由 `packs/base/src/effects/` 维护。

## 示例

| 文件                                              | 关注点                                                 |
| ------------------------------------------------- | ------------------------------------------------------ |
| [fantasy-defense.ts](examples/fantasy-defense.ts) | 幻想印记的条件与动作独立查询                           |
| [damage-by-hp.ts](examples/damage-by-hp.ts)       | HP 条件、惰性分支与取整                                |
| [time-rebirth.ts](examples/time-rebirth.ts)       | 数值与可写引用分开，直接赋值保留原动作                 |
| [weakness-speed.ts](examples/weakness-speed.ts)   | 固定实例与跟随层数、捕获与跟随的不同组合；`spe` 为速度 |
| [api.ts](api.ts)                                  | 转向正式实现的作者入口                                 |
| [type-tests.ts](type-tests.ts)                    | 正向类型推导及必须失败的用法                           |

历史比较输入在 `packages/battle/test/v4/fixtures/effect-regression/`。示例使用真实 V4 对象、调度与属性系统；与官方效果的对照测试和生产内容注册分别维护。

## 检查

在仓库根目录执行：

```sh
pnpm typecheck:effect-authoring-design
pnpm test:effect-authoring-design
```

`@ts-expect-error` 保护错误用法不被意外放宽，精确类型断言防止推导退化为 any。持续值与新目录 JSON 恢复另由 V4 回归套件检查，命令见 [V4 验证](../../../../docs/v4/direct-v1-port.md#验证)。

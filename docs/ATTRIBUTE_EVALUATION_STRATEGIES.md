# 属性修改的显示策略

实现位于 [modifierStyles.ts](../packages/web-ui/src/utils/modifierStyles.ts)。`analyzeModifierType(attributeInfo, attributeName?)` 读取修改器与最终值，返回显示类别；显式属性名优先，否则使用 `attributeInfo.attributeName`。

| 策略      | 属性                                         | 数值增加 | 数值减少 |
| --------- | -------------------------------------------- | -------- | -------- |
| `benefit` | 威力、命中、优先级、能力值、生命、当前怒气等 | 增益     | 减益     |
| `cost`    | 技能怒气消耗 `rage`                          | 减益     | 增益     |

未配置的属性采用 `benefit`。技能消耗 `rage` 与玩家当前怒气 `currentRage` 的含义不同，调用时传入对应字段。

没有生效修改信息或修改器列表为空时返回 `none`。其余类别按以下顺序判定：

1. 包含 clamp 类型时返回 `clamped`。
2. 同时存在正、负修正时返回 `mixed`。
3. 根据 delta／percent／override 修正与最终值变化返回 `buffed` 或 `debuffed`。
4. 其余返回 `neutral`。

绿色、红色、橙色、紫色和蓝色分别对应增益、减益、限制、混合和中性。显示使用服务端或本地内核提供的修改信息，不改变战斗数值。

修改策略时同步[样式回归](../packages/web-ui/src/utils/__tests__/modifierStyles.test.ts)。组件使用见[修改器显示](MODIFIER_UI_USAGE_EXAMPLE.md)。

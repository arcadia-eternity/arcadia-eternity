# 战斗修改器显示

[ModifiedValue](../packages/web-ui/src/components/battle/ModifiedValue.vue) 显示带修改器信息的数值，并通过 tooltip 展示基础值、当前值、修改器类型、优先级与来源。颜色由[属性评估策略](ATTRIBUTE_EVALUATION_STRATEGIES.md)决定。

```vue
<ModifiedValue :value="pet.atk" :attribute-info="atkModifierInfo" size="md" />
<ModifiedValue :value="pet.currentHp" :attribute-info="hpModifierInfo" :show-tooltip="false" inline />
```

`value` 支持 number／boolean／string，`attributeInfo` 使用相同泛型。生效时显示 `attributeInfo.currentValue`，否则显示 `value`。`format` 只影响默认文本；插槽收到的 `value` 保持原类型，供血条等组件计算：

```vue
<ModifiedValue :value="pet.currentHp" :attribute-info="hpModifierInfo">
  <template #default="{ value }">{{ Math.floor(value) }}</template>
</ModifiedValue>
```

组件使用文字颜色表示修正。样式入口为 [modifierStyles.ts](../packages/web-ui/src/utils/modifierStyles.ts)。

修改后运行相关测试：

```sh
pnpm --filter @arcadia-eternity/web-ui exec vitest run src/utils/__tests__/modifierStyles.test.ts src/components/battle/__tests__/ModifiedValue.test.ts --maxWorkers=1
```

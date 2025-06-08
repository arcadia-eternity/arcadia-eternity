# 印记叠层上下文系统

## 概述

新的叠层上下文系统解决了之前effect系统无法获取叠层详细信息的问题。现在effect可以：

1. 获取叠层前后的印记状态
2. 了解叠层的具体变化量
3. 在叠层过程中修改最终结果
4. 基于叠层阈值触发特殊效果

## 新增组件

### StackContext 类

`StackContext` 提供了叠层操作的完整上下文信息：

```typescript
export class StackContext extends Context {
  readonly type = 'stack'
  public readonly battle: Battle
  public available: boolean = true
  
  constructor(
    public readonly parent: AddMarkContext,
    public readonly existingMark: MarkInstance,      // 现有印记
    public readonly incomingMark: MarkInstance,      // 新加入的印记
    public readonly stacksBefore: number,           // 叠层前的层数
    public readonly durationBefore: number,         // 叠层前的持续时间
    public stacksAfter: number,                     // 叠层后的层数（可修改）
    public durationAfter: number,                   // 叠层后的持续时间（可修改）
    public readonly stackStrategy: StackStrategy,   // 叠层策略
  ) {
    super(parent)
    this.battle = parent.battle
  }

  // 获取叠层变化量
  get stackChange(): number {
    return this.stacksAfter - this.stacksBefore
  }

  get durationChange(): number {
    return this.durationAfter - this.durationBefore
  }

  // 更新叠层后的值（允许effect修改）
  updateStacksAfter(newStacks: number): void {
    this.stacksAfter = newStacks
  }

  updateDurationAfter(newDuration: number): void {
    this.durationAfter = newDuration
  }
}
```

### 新增触发器

#### OnStackBefore

- **触发时机**: 在叠层策略计算完成后，应用最终结果前
- **用途**: 修改叠层的最终结果，如限制最大叠层数、翻倍效果等
- **可以修改**: stacksAfter, durationAfter
- **优先级**: 通过优先级控制多个修改效果的执行顺序

#### OnStack

- **触发时机**: 在叠层结果应用后
- **用途**: 基于最终叠层结果触发副作用，如达到阈值时的特殊效果
- **不能修改**: 叠层结果已经应用，只能触发副作用

## 叠层流程

```text
1. 开始叠层 (tryStack)
2. 根据策略计算新的层数和持续时间
3. 创建 StackContext
4. 触发 OnStackBefore 效果（可修改叠层结果）
5. 应用最终的层数和持续时间
6. 触发 OnStack 效果（副作用）
7. 发送更新消息
```

## 使用场景

### 1. 阈值触发效果

当印记叠层达到特定数量时触发特殊效果：

```yaml
- id: effect_stack_threshold_trigger
  trigger: OnStack
  condition:
    type: every
    conditions:
      - type: evaluate
        target:
          base: stackContext
          chain:
            - type: selectPath
              arg: stacksAfter
        evaluator:
          type: greaterThanOrEqual
          value: 3
      - type: evaluate
        target:
          base: stackContext
          chain:
            - type: selectPath
              arg: stacksBefore
        evaluator:
          type: lessThan
          value: 3
  apply:
    type: addMark
    target: foe
    mark:
      type: entity:baseMark
      value: mark_zhongdu
```

### 2. 修改叠层结果

在最终应用前修改叠层数量：

```yaml
- id: effect_modify_final_stack_count
  trigger: OnStackBefore
  priority: 0
  apply:
    type: modifyStackResult
    target: stackContext
    newStacks:
      type: dynamic
      selector:
        base: stackContext
        chain:
          - type: selectPath
            arg: stacksAfter
          - type: multiply
            arg: 2
  condition:
    type: evaluate
    target:
      base: stackContext
      chain:
        - type: selectPath
          arg: stacksAfter
    evaluator:
      type: lessThanOrEqual
      value: 5
```

### 3. 基于变化量的效果

根据叠层变化量获得不同效果：

```yaml
- id: effect_stack_change_bonus
  trigger: OnStack
  apply:
    type: addMark
    target: self
    mark:
      type: entity:baseMark
      value: mark_shanghaizengjia
    stack:
      type: dynamic
      selector:
        base: stackContext
        chain:
          - type: selectPath
            arg: stackChange
  condition:
    type: evaluate
    target:
      base: stackContext
      chain:
        - type: selectPath
          arg: stackChange
    evaluator:
      type: greaterThan
      value: 0
```

## 可访问的属性

通过 `stackContext` 可以访问以下属性：

- `existingMark`: 现有的印记实例
- `incomingMark`: 新加入的印记实例  
- `stacksBefore`: 叠层前的层数
- `durationBefore`: 叠层前的持续时间
- `stacksAfter`: 叠层后的层数（可修改）
- `durationAfter`: 叠层后的持续时间（可修改）
- `stackStrategy`: 使用的叠层策略
- `stackChange`: 叠层变化量 (stacksAfter - stacksBefore)
- `durationChange`: 持续时间变化量 (durationAfter - durationBefore)

## 注意事项

1. **触发顺序**: OnStackBefore先触发（可修改结果），然后应用结果，最后OnStack触发（副作用）
2. **优先级**: OnStackBefore中通过优先级控制多个修改效果的执行顺序
3. **修改限制**: 只有OnStackBefore可以修改 `stacksAfter` 和 `durationAfter`
4. **策略依赖**: 不同的叠层策略会产生不同的计算结果
5. **性能考虑**: 避免在叠层effect中进行复杂计算，保持逻辑简洁

## 兼容性

这个系统完全向后兼容，现有的印记系统不需要任何修改即可继续工作。新的StackContext只是提供了额外的信息和控制能力。

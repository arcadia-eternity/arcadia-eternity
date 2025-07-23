# 性别限制规则演示

## 功能概述

性别限制规则 (`GenderRestrictionRule`) 根据精灵种族的性别比例 (`genderRatio`) 限制精灵可选择的性别。这个功能已经完全集成到 teamBuilder 中，会自动根据选中的精灵种族过滤可用的性别选项。

## 工作原理

### 1. 种族性别比例格式

种族数据中的 `genderRatio` 字段格式为 `[female_ratio, male_ratio]`：

```yaml
# 示例种族数据
species:
  pet_normal:
    genderRatio: [0.5, 0.5]  # 50% 雌性, 50% 雄性
  
  pet_male_only:
    genderRatio: [0, 1]      # 0% 雌性, 100% 雄性 (只能是雄性)
  
  pet_female_only:
    genderRatio: [1, 0]      # 100% 雌性, 0% 雄性 (只能是雌性)
  
  pet_genderless:
    genderRatio: [0, 0]      # 0% 雌性, 0% 雄性 (无性别)
```

### 2. 规则验证逻辑

- **正常种族** (`[0.5, 0.5]`): 允许雌性和雄性
- **雄性专属** (`[0, 1]`): 只允许雄性
- **雌性专属** (`[1, 0]`): 只允许雌性  
- **无性别** (`[0, 0]`): 只允许无性别

### 3. teamBuilder 集成

在 teamBuilder 中，性别选择下拉框会根据当前选中的精灵种族自动过滤选项：

```typescript
// 监听精灵种族变化
watch(
  () => selectedPet.value?.species,
  async (newSpecies) => {
    if (!newSpecies) return
    
    // 获取允许的性别
    const allowedGenders = await ClientRuleIntegration.getAllowedGendersForSpecies(newSpecies)
    allowedGendersForCurrentSpecies.value = allowedGenders
    
    // 自动修正不合法的性别选择
    if (selectedPet.value?.gender && !allowedGenders.includes(selectedPet.value.gender)) {
      selectedPet.value.gender = allowedGenders[0] as Gender
    }
  }
)

// 过滤性别选项
const genderOptions = computed(() => {
  return Object.values(Gender)
    .filter(gender => allowedGendersForCurrentSpecies.value.includes(gender))
    .map(gender => ({
      value: gender,
      label: genderChineseMap[gender as Gender],
      icon: gender === Gender.Male ? '♂' : gender === Gender.Female ? '♀' : '⚲',
    }))
})
```

## 用户体验

### 1. 动态选项过滤

- 当用户选择不同的精灵种族时，性别下拉框的选项会自动更新
- 只显示该种族允许的性别选项
- 不允许的性别选项会被隐藏

### 2. 自动修正

- 如果当前选中的性别不被新种族允许，会自动选择第一个允许的性别
- 避免用户手动修正的麻烦

### 3. 验证反馈

- 规则系统会在队伍验证时检查所有精灵的性别
- 提供详细的错误信息和修复建议
- 错误信息格式：`精灵 "名称" 的性别 "当前性别" 不被允许，可选性别：雄性、雌性`

## API 使用示例

### 获取种族允许的性别

```typescript
// 通过 ClientRuleIntegration
const allowedGenders = await ClientRuleIntegration.getAllowedGendersForSpecies('pet_xiuluosi')
// 返回: ['Male', 'Female'] 或 ['Male'] 或 ['Female'] 或 ['NoGender']

// 检查特定性别是否被允许
const isAllowed = await ClientRuleIntegration.isGenderAllowedForSpecies('pet_xiuluosi', 'Male')
// 返回: true 或 false
```

### 直接使用规则

```typescript
import { GenderRestrictionRule } from '@arcadia-eternity/rules'

const rule = new GenderRestrictionRule()
rule.setSpeciesDataProvider(speciesDataProvider)

// 获取允许的性别
const allowedGenders = rule.getAllowedGendersForSpecies('pet_xiuluosi')

// 验证精灵
const result = rule.validatePet(pet)
```

## 测试覆盖

- ✅ 基本功能测试 (10 个测试用例)
- ✅ 集成测试 (4 个测试用例)
- ✅ 各种性别比例情况测试
- ✅ teamBuilder 集成测试
- ✅ 错误处理测试

## 部署状态

- ✅ 规则已添加到默认规则注册
- ✅ 已集成到休闲和竞技规则集
- ✅ teamBuilder UI 已更新
- ✅ 所有测试通过
- ✅ 文档已更新

这个功能现在已经完全可用，用户在 teamBuilder 中选择精灵种族时，性别选项会自动根据种族的性别限制进行过滤。

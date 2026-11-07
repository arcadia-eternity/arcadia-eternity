# 数据包

## 关于命名规范

### 内容文件

精灵种族保存在 `data/groups/<group>/species.*.yaml`；技能保存在 `data/skill.yaml`，印记保存在 `data/mark*.yaml`。`pack.json` 指定读取文件及顺序，编辑器按实际来源文件保存修改。

效果行为以 `src/effects/` 中的 TypeScript 为准；技能和印记的 `effect` 字段继续通过稳定 ID 引用效果。旧效果 YAML 只作为回归测试夹具保留，不随基础内容包分发。

种族、技能和印记的命名约定如下。

### 效果以外的对象

类型[_子类型]*名称[*附加信息/派生形态]

其中名称为原对象的中文名的拼音缩写,仅使用 小写字母、数字、下划线。

```example:plaintext
pet_dilante #精灵-迪兰特
pet_ailudake_form_desert #精灵-埃鲁达克-形态-沙漠
pet_xiaoxiaokui #精灵-小小葵
pet_xiaoxiaokui_1 #精灵-笑笑葵 这俩精灵谐音就只能这样了
skill_fenlitupo #技能-奋力突破
mark_yinyueyinji #印记-银月印记
mark_status_burn #印记—不良状态-烧伤
```

### 效果

effect*关联印记/技能名\_timing*效果简述

```example:plaintext
effect_burn_damage #烧伤-造成伤害
effect_fenlitupo_addyishang #奋力突破-添加易伤印记
```

## FAQ

### 为啥用字符串？

原版的数字id到后期十分混乱，甚至有一个数字id塞三四个技能的情况，唯一的优势就是在做excel的时候能看的干净一点，同一只精灵的一系列技能能放在一起。

而使用字符串，配合命名约定能显著提升可读性、维护性和协作效率，同时也能简化代码的实现，因此不再遵循原版的规范。

### 为啥用拼音？

原作是纯中文字符串的。如果让我自己从头做的话当然会取个英文名的吧。我嫌每个重新取个名字太麻烦了。

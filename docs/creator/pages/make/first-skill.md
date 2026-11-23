给霜团做一招「冰砾」：普通属性、物理、威力 55、命中率 100、消耗 0。先完成可以在技能栏中选用的新技能，再决定要不要给它写特殊效果。

## 建立技能

在自己的资料包中创建技能，填写名称「冰砾」，展开对象标识，使用局部 ID `ice-chip`。把属性、类别和数值填入表单，选择「查看并保存」。使用外部编辑器时，可直接创建 `data/skills/ice-chip.yaml`：

```yaml
id: ice-chip
element: Normal
category: Physical
power: 55
rage: 0
accuracy: 100
```

在 `locales/zh-CN/skill.yaml` 中追加同 ID 的条目。若表单已保存中文名，就编辑已有条目。说明可以直接读取技能威力，之后调数值时文本也会更新。

```yaml
ice-chip:
  name: 冰砾
  description: 以 <damage>{power}</damage> 威力攻击对手。
```

## 教给霜团，然后给测试队装上

打开霜团的「可学习技能」，添加自己包中的冰砾，学习等级设为 1，保存。手写源码时，在 `learnable_skills` 列表里追加下面这一项，将 `你的项目ID` 换成 `package.json` 中的 `arcadia.projectId`。

```yaml
- skill_id:
    $ref:
      projectId: 你的项目ID
      kind: skill
      id: ice-chip
  level: 1
  hidden: false
```

重新准备试玩。在蓝队霜团的配招中把轻触换成冰砾，点击「保存队伍」并开始新对局。精灵的技能表规定了能学哪些技能，蓝队的配招才决定这场对局的按钮。看到冰砾后出招，核对伤害事件和怒气消耗。威力 55 是伤害计算的输入，实际扣血还会受双方属性等机制影响。

## 想让冰砾也能减速

复用[霜击的行为引用](../api/skill-behaviors.md)，让两招都引用本包的 `apply-slow`。两招将施加同一种 `slow` 印记；调整该印记会同时影响两招。若希望两者持续时间独立，先为新机制设计独立的印记身份和相应的施加逻辑。

可以交给助手：**创建冰砾并教给霜团，保留蓝队的霜击，只替换轻触。检查引用和蓝队合法性，并告诉我如何在新对局确认。**

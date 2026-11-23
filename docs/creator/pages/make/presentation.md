给雪芽换一张立绘，保留霜团原来的外观。这里需要两条记录：资源定义指出图片在哪里，表现定义指出哪个物种的哪个位置使用它。

## 从图片到精灵立绘

1. 在项目「资源」中导入本地 PNG，取可识别的资源 ID，例如 `snowbud-portrait`。工作台会复制素材并建立资源草稿。
2. 打开雪芽的表现设置，把立绘指向新资源。头像用于列表，战斗形象用于场上，应分别选择。
3. 查看并保存资源与表现的改动，重新准备试玩。先在队伍详情检查立绘，再进战斗核对场上形象。

如果用源文件完成同一项工作，先把图片放到 `assets/pets/snowbud.png`，在 `data/resources/main.yaml` 追加：

```yaml
- id: snowbud-portrait
  kind: image
  source: assets/pets/snowbud.png
```

然后在 `data/presentations/main.yaml` 为 `target: { kind: species, id: snowbud }` 的记录设置 `portrait: snowbud-portrait`。同一物种已有表现记录时，直接更新其 `portrait` 字段，保留其他位置的绑定。

## 修改玩家看到的文字

中文技能名和描述保存在 `locales/zh-CN/skill.yaml`；英文在 `locales/en/skill.yaml`。条目以局部技能 ID 为键。霜击的说明结合了可随数值更新的变量和可点开的印记引用：

<<< locales/zh-CN/skill.yaml

在工作台切换语言，分别确认名字和描述。`{power}` 读取技能威力，`<damage>…</damage>` 标记伤害文字，`<mark>命名空间:slow</mark>` 引用该包的减速印记。填入当前包在清单里声明的命名空间。要改变减速本身，请编辑[印记字段](../api/mark-duration.md)。

## 定位缺图

资源预览打不开，先核对 `source` 路径、文件大小写和文件是否在源项目里。资源单独预览正常而角色缺图，再核对表现记录里的对象 ID、引用的资源 ID 以及所用位置。检查发行归档的文件列表，可以确认本地素材是否随包分发。

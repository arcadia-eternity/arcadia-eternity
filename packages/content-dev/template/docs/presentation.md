# 形象、声音与多语言

本包采用分离的表现格式 v2。精灵、技能和印记规则保存在 `data/species`、`data/skills`、`data/marks`；表现关联保存在 `data/presentations`；资源身份和位置保存在 `data/resources`。素材仍可与规则放在同一个 npm 包里。

以 `data/presentations/main.yaml` 和 `data/resources/main.yaml` 为例：表现的 `target` 指向本包内容，`icon`、`portrait`、`battle.source`、`sfx` 等字段引用资源 ID。资源记录的 `source` 才填写包根目录相对路径或 HTTP(S) URL。跨包素材写 `{namespace: other-pack, id: shared-icon}`，并声明对应 npm 依赖。

资源 ID 应保持稳定。移动素材后更新资源记录的 `source`，对象关联不变；移动定义文件不会改变 ID。不要通过改 ID 修复路径。工作台会保留缺失引用并提示重新定位。

默认把素材放在 `assets/`；允许其他包内普通目录，但必须加入 `package.json.files`。不允许符号链接或路径穿越。`kind` 为 image、audio、swf；战斗 `renderer` 明确为 image 或 seer2-swf。图片与音频用途不能混用。

名称与 ICU 描述继续放在 `locales/<language>/<namespace>.yaml`，使用相同内容 ID。工作台把规则、资源和多语言组合为对象页面；外部 AI 应分别编辑对应源记录。

描述中的印记名称用 `<markName>名称</markName>`，不良／异常印记属于同一个展示子类，使用 `<status>名称</status>`；其他印记不自动归入此类。需要可导航的对象引用时用 `<mark>namespace:id</mark>`，界面根据目标现有的 `status` / `exceptional` 标签统一配色。不要为了颜色修改战斗规则标签。技能性质“必中”用 `<guaranteedHit>必中</guaranteedHit>`，数值写 `{power}` / `{stack}`；不使用 HTML 属性、双大括号或 `[颜色]文字[-]`。

这是固定的宿主展示约定：普通印记青色（浅色 `cyan-700`／深色 `cyan-300`），不良／异常子类橙色（`orange-700`／`orange-300`），技能性质“必中”黄绿色（`lime-700`／`lime-300`）。恢复、怒气和数值增减继续用其语义标签，不能据此反推印记分类。颜色由宿主渲染器维护，包内不自定义。完整约定见宿主仓库 `docs/guides/content-presentation.md` 的“固定配色约定”。

描述引用保存命名空间和稳定 ID，不保存翻译名或文件路径；同名对象不能自动互换。后续将完善统一引用规范、联想和跨工具检查，目前不要假定格式检查已经证明所有目标存在，也不要使用尚未支持的精灵／技能／资源引用语法。

`npm run build` 生成 `dist/content.json` 和 `dist/presentation.json`。前者只有规则，后者包含表现关联、资源索引与语言。不要编辑生成物。HTTP 地址不会在构建或安装时下载；包内素材会记录哈希和大小。旧的内嵌 presentation、assets.json 映射不再支持。

修改后运行 `npm test` 和 `npm run pack`。发布前确保 SDK 与表现格式 v2 匹配。

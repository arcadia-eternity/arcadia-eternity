# 素材与文本创作示例

这些示例使用 `arcadia-sdk.json` 固定版本的资源合同。`data/` 定义内容，`assets/` 放包内文件，`locales/` 放名称和描述；`dist/` 的两个索引由工具生成。现有减速效果与战斗规则保持原样。

## 包内头像、立绘和静态战斗形象

[data/species/pet.yaml](../data/species/pet.yaml) 为三个用途分别指定文件：

```yaml
presentation:
  icon: assets/pets/frostling-icon.png
  portrait: assets/pets/frostling-portrait.png
  battle:
    renderer: image
    source: assets/pets/frostling-battle.png
```

路径从包根目录计算。这里的 PNG 是模板原创的简易像素素材，随仓库使用 MIT 许可；可以直接换成自己的图片。工具读取文件生成 SHA-256、大小和媒体类型，作者不手填文件清单。当前工具支持 PNG、JPEG、WebP、OGG、MP3、SWF；SVG、GIF 和 WAV 不在此版本的素材格式中。

## HTTP/HTTPS、SWF 和音效

[data/species/pet-swf.yaml](../data/species/pet-swf.yaml) 是额外的可选精灵，沿用默认精灵的属性和技能，展示来自已有官方资源服务的外观：

```yaml
presentation:
  icon: https://seer2-resource.yuuinih.com/png/pet/1.png
  portrait: https://seer2-resource.yuuinih.com/png/pet/1.png
  battle:
    renderer: seer2-swf
    source: https://seer2-pet-resource.yuuinih.com/public/fight/1.swf
    fallback: assets/pets/frostling-battle.png
```

播放器由 `renderer` 明确选择，不根据文件后缀推断。这个播放器适配 Seer2 战斗动画，不承诺支持任意 SWF。`fallback` 是加载失败时的包内图片。[strike.yaml](../data/skills/strike.yaml) 和 [rest.yaml](../data/skills/rest.yaml) 都用 `presentation.sfx` 声明远程 MP3；模板中的两个技能复用同一段命中音效，可以分别替换。

HTTP 和 HTTPS 都是合法引用。源站需允许客户端跨域读取；HTTPS 网页访问 HTTP 仍受浏览器混合内容规则约束，因此实际示例使用 HTTPS。构建与环境准备仅记录外链，不访问或下载外链，不把 URL 伪装成有固定文件摘要的包内素材。固定环境固定 URL 引用，不能保证外链字节不变。

客户端按需请求，主动获取时使用 `cache: no-store`，卸载消费组件时释放当前资源。服务器直接流式提供包内文件并返回 `Cache-Control: no-store`，不新增素材缓存或远程代理。源站自身的响应头由源站管理。服务器选择并信任内容包及其素材；玩家无需对每个 SWF 再授权。

## 印记图标与实体引用

[data/marks/slow.yaml](../data/marks/slow.yaml) 使用：

```yaml
presentation:
  icon: assets/marks/slow.png
```

普通状态、特性、纹章、全局印记都使用同一个 `presentation.icon` 字段。相应语言文件可使用 `mark`、`mark_ability`、`mark_emblem`、`mark_global` 命名空间；本例的普通减速状态使用 `mark.yaml`。

技能描述中的 `<mark>example-pack:slow</mark>` 会显示本包减速印记的名称、图标和悬浮说明。标签内写完整的运行时 ID；改 namespace 后，要手动同步两种语言的这段文本。`rename` 只改写结构化 `$ref`，不会重写语言模板中的字符串。减速描述本身使用静态语义文本，因此在没有战斗实例的图鉴和引用悬浮里也能显示。

## 中英双语和当前技能数值

语言目录的键使用本包局部 ID，服务器会加 namespace 前缀：

```yaml
# locales/zh-CN/skill.yaml
strike:
  name: 霜击
  description: >-
    {power, plural, =0 {发动不带威力的攻击。} other {以 <damage>#</damage> 威力攻击。}}
    命中率 <strong>{accuracy}%</strong>，命中后施加 <mark>example-pack:slow</mark>。
```

[完整中文示例](../locales/zh-CN/skill.yaml) 还用 ICU `select` 按 `category` 选择物理／特殊文本；[英文示例](../locales/en/skill.yaml) 用 `one`／`other` 展示复数。`rest` 展示简单的 `{power}`、`{accuracy}` 插值。当前渲染器已经从技能上下文公开这些扁平别名；示例不使用含点号的变量名，也不使用与语义标签同名的变量（例如 `rage`），避免 FormatJS 的解析限制和标签处理器名称冲突。不要把威力称为实际伤害；这些模板不做针对目标的伤害预估。

i18next/i18next-vue 负责语言选择和回退；FormatJS 负责变量、条件、复数与语义标签。中文 `zh-CN` 为默认语言，`en` 为英文；没有对应翻译时回退中文。支持的样式标签是 `damage`、`heal`、`shield`、`buff`、`debuff`、`rage`、`strong`、`emphasis`，`mark` 是实体引用。语言模板使用 ICU 的 `{name}`，不要叠加 i18next 的 `{{name}}`、Markdown 或任意 HTML。

变量只读取当前界面提供的公开值，不会执行内容包 TypeScript。战斗技能提示可获得当前技能数值；没有上下文或变量缺失的界面会保留原模板并标记格式错误。

## 需要战斗实例的印记描述

若描述只用于拥有印记实例的界面，可以改成：

```yaml
slow:
  name: 减速
  description: 当前 <strong>{stack}</strong> 层，剩余 <strong>{duration}</strong> 回合。
```

战斗印记提示提供 `{ mark }`，可用 `{stack}` 和 `{duration}`。图鉴和技能中的印记引用只有定义，没有当前印记实例；上面的动态模板在那里会缺少变量。本模板因此保留可在这些入口显示的静态印记描述。效果内部的可修改 `amount` 参数目前没有通用的浏览器展示值提供器，不能直接假定 `{amount}` 可用。

## 依赖包的素材

已有真实 npm 依赖时，可以把资源字段换成依赖包的 namespace 与包内路径：

```yaml
presentation:
  icon:
    namespace: shared-art
    path: assets/marks/slow.png
```

依赖包必须确实导出该资源；服务器会检查实际 npm 依赖关系和索引。这个片段是依赖配置示意，没有在模板里加入虚构的 `shared-art` 包。

## 打包和验证

`package.json.files` 包含 `assets`、`locales`、`data`、`src`、`docs` 和 `dist`，`arcadia.presentation` 指向 `dist/presentation.json`。新增语言与图片后运行：

```sh
npm run check
npm test
npm run demo
npm run pack
```

测试检查实际安装后的 npm 产物：包内图片与语言源文件已收录、远程资源保留 URL、两个语言包可用，且减速行为继续通过真实引擎场景。无界面测试不代表浏览器已播放远程 SWF；连接准备了该内容包的服务器后，选择 `pet-swf` 验证外观与回退。

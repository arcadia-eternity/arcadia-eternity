# 内容展示、素材与语言

2026-10-28 讨论决定。本文是资源与描述重构的实现合同，后续实施记录列在文末。

## 职责

内容包是 npm 安装和分享单位。服务器选择并信任内容包及其图片、音频和 SWF，对素材准入负责；客户端负责按固定环境正确加载。客户端不逐个审核素材、不要求玩家重复授权 SWF，不因服务器提供素材另建隔离播放器。摘要用于版本固定、完整性和缓存，不是安全认证。

## 作者文件

源项目使用 `data/`、`src/`、`assets/`、`locales/<language>/<namespace>.json|yaml`。素材文件夹可自由组织；文件路径相对包根目录。精灵、技能、印记的 `presentation` 声明用途：`icon`、`portrait`、`battle`、`cry`、`sfx`、`background`、`music`。`battle` 显式声明 `renderer: image | seer2-swf`、`source` 和可选 `fallback`，不用后缀推断播放器。

本包资源用路径字符串，远程来源支持 HTTP/HTTPS。跨包使用 `{ namespace, path }` 并要求实际 npm 依赖关系。工具生成包内资源的摘要、大小、媒体类型和索引，作者不手填重复清单。HTTP/HTTPS 来源只记录 URL，不在构建或准备环境时下载，也不生成伪造的文件摘要。普通远程 URL 可能变化；固定环境仅固定它的引用，不承诺外链字节不变。

发布物包含 `dist/content.json`、`dist/presentation.json`、效果构建产物、包内素材及所需语言文件。`package.json.arcadia.presentation` 指向生成索引。工具检查 npm `files` 不遗漏实际运行文件。源文件保留与项目备份继续使用同一项目，不另建浏览器 UGC 仓库。

## 服务器

用户随后明确要求：**不做任何资源缓存**。不建立资源磁盘库、内容寻址缓存、远程代理缓存、客户端共享下载缓存或预取全部素材。

准备环境时读取包索引，流式校验包内文件，直接使用固定环境私有包副本中的文件路径；此副本是已有运行环境隔离机制，不另建素材副本。远程引用只公布 URL，客户端按需直连。服务器负责认可外链与 SWF，客户端无需再次审核。

沿用 `/api/v1/environments/{id}/assets/{hash}` 直接流式分发对应环境的包内文件，支持正确媒体类型、HEAD 和 Range。内容、索引及文件响应使用 `Cache-Control: no-store`，不启用 ETag/不可变缓存。远程源站的响应头由源站负责；客户端主动获取资源时指定 `cache: no-store`。资源只在当前组件/播放器使用期间持有，卸载即释放。

## 客户端

组件按内容 ID 和用途获取素材。服务器、环境各自持有展示状态；切服/退房清理引用、取消旧请求，不能污染官方内容。索引先加载，图鉴/组队图片和音频按需加载；对局只准备所需展示资源，不下载整个环境全部素材。图片、SWF 分别交给现有加载器；静态图可作为动画失败的回退。

## 文本

i18next/i18next-vue 保留语言加载、选择、回退与 Vue 响应能力。游戏描述交给 FormatJS `intl-messageformat` 处理一次：命名变量、条件和受控语义标签，渲染为 Vue 节点；不再叠加 Markdown/任意 HTML。中文先完整实现，语言包可扩展其他语言。实体引用与动态图标由客户端注册的组件处理。

定义值、实例公开值和针对目标的预估分别建模；数值与效果尽可能共用参数和函数。浏览器不下载执行 UGC TS；额外预估由服务器按观看者权限提供，不能泄露隐藏信息。通用伤害预估的实现需要独立场景验收，不能把当前层数插值计作预估完成。

## 验收

真实 npm 包内图片、远程 URL、SWF 声明、独立头像/立绘/战斗形象、音频和双语言描述进入服务器与客户端；验证直接文件分发、Range、无缓存响应、包内完整性失败、远程零预下载、当前值刷新、跨包引用和环境切换。现有官方静态玩法保持可用。无需旧载荷自动迁移。

## 作者示例

```json
{
  "files": ["dist", "assets", "locales", "data", "src"],
  "arcadia": {
    "formatVersion": 1,
    "projectId": "my-pack",
    "namespace": "my-pack",
    "content": "dist/content.json",
    "presentation": "dist/presentation.json"
  }
}
```

```yaml
# data/species/pet.yaml（省略其他战斗字段）
id: pet
presentation:
  icon: assets/pets/icon.webp
  portrait: assets/pets/portrait.webp
  battle:
    renderer: seer2-swf
    source: https://example.com/pet.swf
    fallback: assets/pets/portrait.webp
  cry: assets/sounds/pet.ogg
```

```yaml
# locales/zh-CN/mark.yaml
shield:
  name: 护盾
  description: 抵挡 <shield>{stack}</shield> 点伤害。
```

`arcadia-content build` 生成两个 JSON 索引；`arcadia-content pack` 还检查 npm 实际收录列表，拒绝遗漏展示索引或包内素材的产物。语言 namespace 为 `species`、`skill`、`mark`、`mark_ability`、`mark_emblem`、`mark_global`，键为本包内容的局部 ID；服务器添加 namespace 前缀，不覆盖其他包或官方文本。

富文本支持 `<damage>`、`<heal>`、`<shield>`、`<buff>`、`<debuff>`、`<rage>`、`<strong>`、`<emphasis>`；`<mark>my-pack:shield</mark>` 生成名称、图标和悬浮解释。`{power}`、`{stack}` 等使用当前界面提供的公开实例值，也可使用 `{skill.power}`、`{mark.stack}`。ICU 条件／复数由 FormatJS 处理。缺少上下文或错误模板显示原文及格式错误标识，避免虚构实际战斗数值。

远程资源由浏览器以 `fetch(..., { cache: 'no-store', credentials: 'omit' })` 在使用时获取，资源源站需允许客户端跨域读取；浏览器 HTTPS 页面仍受混合内容规则约束。Blob URL 只属于当前挂载的消费组件，切换来源／卸载时取消请求并释放，不用于共享或持久缓存。SWF 的受击／完成事件继续走现有播放器。对局准备不预加载整个环境或预热后备精灵。

## 印记资源

普通状态、特性、纹章和全局印记都使用同一 `presentation.icon` 声明：

```yaml
# data/marks/burn.yaml
id: burn
tags: [status]
presentation:
  icon: assets/marks/burn.webp
```

`icon` 也接受 HTTP/HTTPS URL 或依赖包的 `{ namespace, path }` 引用。战斗印记、技能关联印记说明、图鉴卡片／详情、基础字段选择器及富文本中的印记引用均从当前环境的印记定义取图，不只查官方 `markImage` 表。缺少自定义图标时保留既有特性／纹章／通用印记回退。

## 本轮实施与验证

已实现作者资源／语言索引生成与打包检查、跨包资源引用检查、包内文件直接流式分发（HEAD/Range/no-store）、远程零预下载、客户端按用途加载与当前消费实例释放、服务器语言覆盖的清理／回退、FormatJS 语义文本和公开实例值，以及各印记入口的自定义图标。真实浏览器已验证实际图片解码、图标重新挂载重新请求、双语言与层数更新、印记引用悬浮和退房清理。

资源不建立服务端磁盘库或客户端共享缓存。现有 npm 环境私有副本用于运行隔离，不新增资源副本。连接服务器时跳过旧桌面 SWF 缓存与备用精灵预热；原有独立官方离线功能不在本轮删除范围。

尚未把通用目标伤害预估、任意 TS 效果的展示值提供器、图集／序列帧适配器或完整素材上传编辑器计作完成。当前动态描述消费界面已有的技能／印记公开字段。远程 SWF 本轮验证了声明、显式播放器选择及按需加载接入；不把图片浏览器验收冒充新增任意 SWF 格式的播放验收。

本地验证：前端 50 文件／356 项通过，服务端 110 项通过（另 14 项既有跳过），加载器 61 项通过，作者工具 16 项通过，Schema 15 项通过（另 6 项既有跳过）。真实 Microsoft Edge 浏览器用实际 npm 包与 HTTP 文件完成图片解码、印记悬浮、语言／实例值更新、重挂载重新请求及离房清理。网页生产构建、根／服务端类型检查和修改文件 lint 通过；前端完整类型检查仍有 5 项既有错误，未计为通过。上述均为本地验证，不代表 CI、公开 SDK 发行或生产部署。

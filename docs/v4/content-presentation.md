# 内容表现与资源引用（v2）

一个内容包可以同时携带规则、表现、素材和多语言。源数据分开维护，工作台按对象 ID 组合展示。战斗规则产物 `dist/content.json` 不包含表现配置或素材位置。

## 作者源文件

- `data/species/`、`data/skills/`、`data/marks/`：规则定义。
- `data/presentations/`：表现定义。`id` 是稳定的表现记录标识；`target.kind` 为 `species | skills | marks`，`target.id` 是本包对象 ID。同一对象最多一个表现定义。
- `data/resources/`：资源定义。`id` 是包内稳定标识，`kind` 为 `image | audio | swf`，`source` 为包根目录相对路径或 HTTP(S) URL，可选 `name` 为作者界面名称。可选 `tags` 中的 `background`、`music` 用于全局背景／音乐列表。
- `locales/<language>/<namespace>.yaml`：名称与 ICU 描述，通过内容 ID 关联。

以上分类内支持子目录、JSON/YAML、单记录和记录数组；不要求每个对象拆成三个文件。素材可以放在包内任意普通目录，`assets/` 是默认导入位置。禁止路径穿越、符号链接及依赖、构建、内部工作目录。

```yaml
# data/presentations/puni.yaml
id: puni-display
target: { kind: species, id: pet_puni }
icon: puni-icon
portrait: puni-portrait
battle:
  renderer: image
  source: puni-portrait
```

```yaml
# data/resources/puni.yaml
- id: puni-icon
  kind: image
  source: assets/puni/icon.png
- id: puni-portrait
  kind: image
  source: assets/puni/portrait.png
```

表现用途包含 `icon`、`portrait`、`cry`、`sfx`、`background`、`music`，以及 `battle.renderer/source/fallback`。`renderer` 显式为 `image` 或 `seer2-swf`；回退必须是图片。用途引用资源 ID，不直接填写文件路径或 URL。跨包引用用 `{ namespace: other-pack, id: shared-icon }`，由安装后的 npm 依赖图验证可访问性。

## 构建与加载

构建生成 `dist/presentation.json`，其 `version` 为 2，包含 `bindings`、`resources`、`locales`、`defaultLocale`。本地资源记录保留稳定 ID，并生成 source/SHA-256/bytes/MIME；远程资源只声明 URL，不下载、代理或缓存。未被引用的已声明素材也保留。

包清单的 `arcadia.presentation` 指向该产物；npm 的 `files` 必须包含产物和全部已声明的本地素材。基础包通过 `pack.json.presentation` 引用同格式的产物，由基础包构建生成。

加载器检查对象目标、重复关联、依赖可访问性和文件完整性。浏览器获取服务器批准的表现目录，在 UI 边界解析资源 ID；实际图片、声音、SWF 由使用它的组件按需加载。固定环境保持自己的资源版本。

## 工作台与外部修改

对象页面的“形象与声音”修改独立表现草稿；资源导入复制文件并创建独立资源定义草稿。选择资源写入 ID。资源页面可查看反向引用并修改素材位置。

移动规则或资源定义文件时，ID 不变即可重新扫描定位。仅移动素材文件时会产生缺失诊断，作者在资源定义更新 `source` 后，原有对象关联继续有效。缺失引用保留，不猜测重绑。资源名、路径和内容哈希都不是身份。

表现、资源、规则和语言共用文件版本检查、改动核对、部分保存结果和 YAML 锚点保护。外部修改不会自动覆盖未保存输入。基础包在工作台只读。

## 格式迁移

旧 `assets.json.mappings`、`assetRef/iconRef/sfxRef` 和规则记录内的 `presentation` 不再作为作者源格式。基础包、内置模板与独立模板仓库已改为分离定义。显示目录中的派生 `presentation` 仍供游戏组件使用，它不回写规则源文件。

旧包必须迁移并重新构建；不能仅将旧产物版本号改为 2。模板首次安装的上游提交需要与此协议一起发布；本地开发可用新生成的 SDK 物料执行 `setup --sdk-dir`。

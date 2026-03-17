# Pack Workspace Spec (Draft v1)

## 1. 目标

- 编辑器以后以“数据包（pack）”为最小编辑单位，不再以全局散落文件为单位。
- 客户端（Tauri）和服务端/本地运行（Node）统一使用 `packs` 工作区模型。
- 提供内置模板，支持一键创建新包，便于后续接入创意工坊。

## 2. 工作区目录

- 工作区根目录：`packs/`
- 每个数据包固定一层目录：`packs/<folder>/pack.json`
- 不递归扫描更深层目录作为包根。
- 无 `pack.json` 的目录忽略。

## 3. 包目录推荐结构

```text
packs/<folder>/
  pack.json
  data/
    effect.yaml
    mark.yaml
    skill.yaml
    species.yaml
  locales/
    zh-CN/
      mark.yaml
      skill.yaml
      species.yaml
      webui.yaml
      battle.yaml
  assets/
    assets.json
```

## 4. 加载策略

- Web 模式：
  - 维持当前行为，优先使用已配置的 HTTP `pack.json`（如 `VITE_API_BASE/pack.json`）。
- Node 模式（CLI/Server/本地 battle）：
  - 默认 `builtin:workspace`，自动扫描 `packs/` 并聚合加载。
  - 可通过 `ARCADIA_PACKS_DIR` 指定工作区目录。
- Tauri 模式：
  - 优先探测本地 workspace 端点：`/packs/workspace/pack.json`
  - 探测失败时回退到 Web 路径，保证可运行性。

## 5. 负载顺序与覆盖

- `arcadia-eternity.base` 必须存在，且优先加载。
- 其余包按 `id` 排序加载。
- 后加载对象覆盖先加载对象（同 `id` 的 effect/mark/skill/species 采用后者）。

## 6. assetsRef 规则

- `assetsRef` 支持：
  - 单文件 JSON
  - 目录（读取目录下所有 `*.json`，`assets.json` 优先）
  - 数组（顺序加载）
- 目录中允许包含图片、音频等资源文件，URL 相对 `assets.json` 或包根解析。

## 7. 内置模板

- 模板 ID：`starter`
- 提供最小可运行的 pack 目录结构，包含：
  - `pack.json`
  - `data/*.yaml`（effect/mark/skill/species）
  - `locales/zh-CN/*.yaml`
  - `assets/assets.json`
- 通过 Tauri 命令创建：
  - `list_pack_templates`
  - `list_workspace_packs`
  - `create_pack_from_template`

## 8. 编辑器约束

- 编辑器的数据读写上下文必须绑定到“当前选中 pack”。
- 所有写入仅允许落在该 pack 根目录内。
- 跨包修改必须显式切换目标包，不允许隐式写入。

## 9. 创意工坊接入约定

- 安装产物统一落地到 `appDataDir/packs/<folder>/...`。
- 只要产物符合本规范，即可被现有加载器和编辑器自动识别。

# Pack Spec (Draft v1)

## 目标

- 统一客户端（Web/Tauri）与服务端的数据包协议。
- 支持可复现对战（通过 `packLock` 固定依赖树）。
- 支持未来创意工坊分发（Registry/npm/git）。

## 基本对象

## `pack.json`

```json
{
  "id": "arcadia-eternity.base",
  "version": "1.0.0",
  "engine": "seer2-v2",
  "engineRange": ">=2.0.0 <3.0.0",
  "assetsRef": "npm:@arcadia-eternity/assets-pack-base",
  "layoutVersion": 1,
  "dependencies": [
    { "path": "../dep/pack.json", "id": "dep.pack", "optional": false }
  ],
  "paths": {
    "dataDir": "data",
    "localesDir": "locales"
  },
  "data": {
    "effects": ["effect_skill.yaml"],
    "marks": ["mark.yaml"],
    "skills": ["skill.yaml"],
    "species": ["species.yaml"]
  },
  "locales": {
    "zh-CN": ["skill", "mark", "species"]
  }
}
```

字段约束：

- `id+version` 唯一标识一个包版本。
- `engine` 固定 `seer2-v2`。
- `dependencies` 是有向依赖图（允许 optional）。
- `data/locales` 文件均相对于 `paths`。
- `assetsRef` 可选：指向一个资源包（asset pack）引用，用于“数据包绑定资源包”场景。

## `assets.json`（资源包清单）

资源和游戏数据分离，资源包可单独发布，也可由 `pack.json.assetsRef` 绑定：

```json
{
  "id": "arcadia-eternity.base-assets",
  "version": "1.0.0",
  "engine": "seer2-v2",
  "assets": [
    { "id": "pet.001.portrait", "type": "petPortrait", "uri": "https://cdn.example.com/pet/1.png" },
    { "id": "mark.burn.icon", "type": "markIcon", "uri": "https://cdn.example.com/mark/burn.png" }
  ],
  "mappings": {
    "species": { "species_demo": "pet.001.portrait" },
    "marks": { "mark_burn": "mark.burn.icon" }
  }
}
```

支持两种模式：
- 随数据包发布：`pack.json` 中声明 `assetsRef`。
- 独立发布：客户端/房间通过 `assetLock` 指定资源包集合（如皮肤包、音效包）。

## `packLock`

由服务端或房主生成，客户端和服务端都以它为准：

```json
{
  "lockVersion": 1,
  "engine": "seer2-v2",
  "packs": [
    {
      "id": "arcadia-eternity.base",
      "version": "1.0.0",
      "integrity": "sha256-...",
      "source": "npm:@arcadia-eternity/data-pack-base"
    }
  ]
}
```

要求：

- 对战启动、回放、断线恢复都使用同一份 `packLock`。
- 客户端必须先解析并安装 lock 中缺失包。
- 服务端必须校验客户端声明与房间 lock 一致。

## `assetLock`

用于锁定资源包集合（皮肤/音效等）：

```json
{
  "lockVersion": 1,
  "engine": "seer2-v2",
  "assets": [
    {
      "id": "arcadia-eternity.base-assets",
      "version": "1.0.0",
      "integrity": "sha256-...",
      "source": "npm:@arcadia-eternity/assets-pack-base"
    }
  ]
}
```

## 解析规则

- 依赖加载顺序：拓扑排序（先依赖，后当前）。
- 检测循环依赖并报错。
- `optional` 依赖可跳过，但需要记录 warning。
- `id` 不匹配视为错误（optional 时可降级 warning）。

## 分发引用

- 内置基础包：`builtin:base`
- 本地路径：`./packs/base/pack.json`
- npm：`npm:@scope/pack`
- npm 指定入口：`npm:@scope/pack#packs/base/pack.json`

包根 `package.json` 可声明：

```json
{ "arcadiaEternityPack": "pack.json" }
```

基础要求：

- 基础包必须内置在当前游戏代码与发行产物中（Web/Tauri 都可离线获取）。
- `builtin:base` 不依赖在线包服务可用性。

## 安装模型

### Server / Tauri

- 支持直接通过 `npm` / `pnpm` 安装包。
- 支持 `workspace:` / `file:` / `link:` / `git:` / `npm:`。
- 运行时通过包根 `package.json` 的元字段发现可用包：

```json
{
  "arcadiaEternityPack": "pack.json",
  "arcadiaEternityAssets": "assets.json"
}
```

### Web

- 不直接执行 `npm install`。
- 通过 `Pack Service` 下载 `pack.json/assets.json/pack-lock.yaml` 与关联文件。
- 浏览器缓存层负责模拟“已安装包”。

见：

- [pack-service.md](/Users/yuuinih/GitHub/test_battle/docs/pack-service.md)

## 房间承载模式

房间需要显式声明：

- `battleMode: "p2p" | "server"`

规则：

- 默认 `p2p`
- `p2p` 房间中，battle host 由房主或指定 peer 承担，server 只负责房间/信令/lock 校验
- `server` 房间中，server 负责 battle 执行，因此必须已安装并可解析对应 lockfile
- 官方 ranked / matchmaking / bot / 裁定场景应使用 `server`

## 安全策略（阶段性）

- 当前阶段仅允许数据包（YAML/JSON），不允许执行脚本。
- 所有包必须通过 schema + cross-ref + dependency 校验。
- 未来如支持脚本包，需独立沙箱与权限模型。

## 官方队列限制

- 官方排位（ranked）与官方匹配（matchmaking）仅支持基础官方扩展包集合。
- 默认要求包含基础包：`@arcadia-eternity/data-pack-base`。
- 服务端通过 `PackPolicy` 严格校验：
  - `required`：官方基础包
  - `allowed`：官方白名单包（可选扩展）
  - `mode`：`strict`
- 非官方社区包不允许进入 ranked/mm，仅允许自定义房间或娱乐模式。

## 服务拆分原则

- `Battle Server` 与 `Pack Registry/Distribution Server` 必须为不同实例（可不同集群）。
- `Battle Server` 只负责：
  - 匹配与开局
  - 对战执行与状态同步
  - 按 `packLock/PackPolicy` 做校验
- `Battle Server` 不直接分发 pack 文件，不承担包托管职责。
- `Pack Registry/Distribution Server` 只负责：
  - 包元数据查询（版本、依赖、审核态、摘要）
  - 包下载（可经 CDN/对象存储）
- 两者交互应使用只读接口（可缓存），避免运行时强耦合。

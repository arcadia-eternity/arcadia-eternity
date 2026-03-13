# Pack Service

## 目标

给 Web 提供“像 npm install 一样可用”的安装体验，但不要求浏览器直接访问 npm registry 或拥有 `node_modules`。

## 当前状态（2026-03-13）

### 已落地

- 基础包已切换到 pack 模式，运行时默认 `builtin:base`。
- Web 已通过 `pack-loader` 支持内置包 + HTTP 加载路径。
- Server 已具备 `ServerPackManager` 基础能力（发现/校验/安装最小闭环）。
- 私人房间已区分 `battleMode: p2p | server`，且 `p2p` 在线链路（relay/webrtc）已回归通过。
- 官方约束已明确：ranked/mm 仅允许官方白名单包，且使用 `server` 承载 battle。
- `server` 运行时迁移基线已补强：`runtimeSeed` 持久化、runtime snapshot strict `v2` 门禁、snapshot 不兼容时 replay-from-start 兜底。

### 未落地

- 独立 Pack Service 的完整 HTTP 实现（版本查询、meta、文件分发、鉴权与限流）。
- Web 端“缺包自动安装 + 缓存治理”完整体验（目前以加载能力为主）。
- TauriPackManager 全链路（安装/校验/离线缓存）验收。
- PackPolicy 在匹配/入房链路的全量错误码与前端提示收口。

## 角色划分

### npm / pnpm

- 作为发布源与开发态安装源
- 主要服务于：
  - `server`
  - `tauri`
  - 本地开发/workspace

### Pack Service

- 作为浏览器消费层
- 主要服务于：
  - `web`
  - 未来创意工坊前端

## 基本原则

- 包格式统一：`pack.json` / `assets.json` / `pack-lock.yaml`
- Web 不直接执行 `npm install`
- Pack Service 可以来自：
  - 官方扩展包服务器
  - 社区镜像/工坊服务器
  - 自建私有仓库

## 最小 HTTP 协议

### 1. 查询包版本

`GET /packs/:name`

返回：

```json
{
  "name": "@scope/demo-pack",
  "latest": "1.2.0",
  "versions": ["1.0.0", "1.1.0", "1.2.0"]
}
```

### 2. 查询包元数据

`GET /packs/:name/:version/meta`

返回：

```json
{
  "name": "@scope/demo-pack",
  "version": "1.2.0",
  "kind": "data",
  "entry": "pack.json",
  "integrity": "sha512-...",
  "resolved": "https://cdn.example.com/packs/demo-pack/1.2.0/pack.json",
  "lockfile": "https://cdn.example.com/packs/demo-pack/1.2.0/pack-lock.yaml"
}
```

### 3. 获取 manifest

- `GET /packs/:name/:version/pack.json`
- `GET /packs/:name/:version/assets.json`
- `GET /packs/:name/:version/pack-lock.yaml`

### 4. 获取资源文件

- `GET /packs/:name/:version/files/<path>`

### 协议落地说明

- 上述接口定义作为目标协议保留。
- 当前仓库已完成 schema 与 lockfile 基建，但“完整 Pack Service 实例”仍在后续阶段实现。
- 在完整服务落地前：
  - `server/tauri` 继续使用 npm/workspace/file/git 安装链路；
  - `web` 继续使用内置基础包 + 已配置的 HTTP 资源来源。

## 三端职责

### Server

- 默认不承载大多数房间的 battle 执行
- 主要职责：
  - 匹配
  - 房间
  - 信令 / host 协商
  - `packLock/assetLock` 与策略校验
- 仅在以下场景直接承载 battle：
  - 官方 ranked / matchmaking
  - bot 对战
  - 回放裁定 / 反作弊裁定
  - fallback server battle
- 可直接消费已安装 npm 包，也可消费 file/workspace/git

### Tauri

- 开发态可直接消费 npm/workspace
- 发布态可消费：
  - 内置包
  - 本地安装目录
  - Pack Service 下载缓存

### Web

- 仅消费：
  - 内置基础包
  - Pack Service
- 安装目标：
  - IndexedDB / Cache Storage
- 在 `p2p` 房间中，battle host 通常由某个客户端承担

## 房间模式

### `battleMode: "p2p"`

- 默认模式
- server 不要求安装并运行房间所需 pack
- 房主或指定 peer 作为 battle host
- 其他玩家通过信令 + P2P 加入

### `battleMode: "server"`

- 服务端承载 battle
- 仅用于官方模式、bot、裁定、回放等高可信场景
- server 必须能 `resolve(lockfile)`

## PackManager 落点

三端共享同一接口：

- `listInstalled`
- `has`
- `verify`
- `install`
- `resolve`
- `load`

实现分三种：

- `ServerPackManager`
- `TauriPackManager`
- `WebPackManager`

## 官方服务策略

- 官方 ranked/mm 只允许官方基础包和官方白名单扩展
- 官方 Battle Server 不直接托管包文件
- 官方 Pack Service 与 Battle Server 必须分离部署

## 下一步（按优先级）

1. 实现 Pack Service 最小可用 API：`/packs/:name`、`/meta`、`/pack.json`、`/assets.json`、`/pack-lock.yaml`、`/files/*`。
2. 接入 PackPolicy 错误码收口：服务端返回稳定错误，Web/Tauri 给出可读提示。
3. 完成 TauriPackManager 验收：同一 `packLock` 下与 Web/Server 结果一致（同 seed）。
4. 增加回归测试矩阵：缺包安装、版本冲突、锁不一致、离线回退、跨实例房间 lock 校验。

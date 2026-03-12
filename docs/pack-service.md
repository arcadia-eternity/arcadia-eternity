# Pack Service (Draft)

## 目标

给 Web 提供“像 npm install 一样可用”的安装体验，但不要求浏览器直接访问 npm registry 或拥有 `node_modules`。

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

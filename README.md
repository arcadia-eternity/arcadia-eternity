# Arcadia Eternity

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/arcadia-eternity/arcadia-eternity)

欢迎来到 **阿卡迪亚:永恒之门**

该项目是一个对约瑟传说（赛尔号2）的战斗模拟系统。提供联机网页、队伍编辑器和桌面内容包工作台。

网页采用 HTML5，桌面客户端使用 Electron；战斗内核同时用于 Node 服务端、CLI 和本地对战。当前开发与集成分支为 `refactor/v4`。

支持本地 AI 对战、好友房间与普通匹配。

您可以在上方的DeepWiki里面了解该项目的架构和一部分设计理念。

QQ群：805146068

## 关联库

- [seer2-pet-animator](https://github.com/arcadia-star/seer2-pet-animator) 用于复用原作游戏资源的动画容器
- [seer2-resource](https://github.com/arcadia-eternity/seer2-resource) 原作经过整理后在本项目中使用的游戏资源

## 快速开始

### 开启测试战斗

```sh
pnpm install --frozen-lockfile
pnpm build:package
pnpm build:cli
pnpm cli battle simulate -1 testteam.yaml -2 testteam.yaml --json
```

### 启动服务器

```sh
# 构建依赖后启动后端服务器（无需 Redis / 数据库）
pnpm install
pnpm build:prod
pnpm run cli server --port 8102 --server-id arcadia-local

```

打开 `http://localhost:8102` 使用配套网页。开发模式可用以下命令替代上面的启动命令，后端与前端分别在独立终端运行：

```sh
pnpm cli server --headless --cors-origin http://localhost:5173
pnpm web:dev
```

服务器采用单进程内存房间：停机、重启或部署会结束所有房间；页面刷新和短时断线可在原进程仍存活时重连。本地 UID 不承担登录或席位权限。详见[服务端运行与身份约定](docs/v4/server-runtime.md)。

## 开发文档

从[文档导航](docs/README.md)或[V4 指南](docs/v4/direct-v1-port.md)开始。内容包作者见[创建并测试 TypeScript 内容包](docs/v4/ugc-authoring-start.md)。

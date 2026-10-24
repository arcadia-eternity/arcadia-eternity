# Arcadia Eternity

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/arcadia-eternity/arcadia-eternity)

欢迎来到 **阿卡迪亚:永恒之门**

该项目是一个对约瑟传说（赛尔号2）的战斗模拟系统。包括一个可以联机对战的网页，一个队伍编辑器，一个游戏数据编辑器。

该项目**完全使用HTML5制作**。本质上是一个炫技作品，是尝试用来测试复刻原作战斗的一个可行性验证。

目前提供单精灵模式的支持。

您可以在上方的DeepWiki里面了解该项目的架构和一部分设计理念。

QQ群：805146068

## 关联库

- [seer2-pet-animator](https://github.com/arcadia-star/seer2-pet-animator) 用于复用原作游戏资源的动画容器
- [seer2-resource](https://github.com/arcadia-eternity/seer2-resource) 原作经过整理后在本项目中使用的游戏资源

## 快速开始

### 开启测试战斗

```sh
pnpm run cli local --player1 testteam.yaml --player2 testteam.yaml
```

### 启动服务器

```sh
# 构建依赖后启动后端服务器（无需 Redis / 数据库）
pnpm install
pnpm build:prod
pnpm run cli server --port 8102 --server-id arcadia-local

# 启动前端开发服务器
pnpm web:dev
```

服务器采用单进程内存房间：停机、重启或部署会结束所有房间；页面刷新和短时断线可在原进程仍存活时重连。本地 UID 不承担登录或席位权限。详见[服务端运行与身份约定](docs/v4/server-runtime.md)。

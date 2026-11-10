# Arcadia Eternity

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/arcadia-eternity/arcadia-eternity)

欢迎来到 **阿卡迪亚:永恒之门**

该项目是一个对约瑟传说（赛尔号2）的战斗模拟系统。提供联机网页、队伍编辑器和桌面内容包工作台。

网页采用 HTML5，桌面客户端使用 Electron；战斗内核同时用于 Node 服务端、CLI 和本地对战。当前开发与集成分支为 `main`。

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
# 构建依赖后启动后端服务器（无需 Redis 或外部数据库，默认使用 SQLite）
pnpm install
pnpm build:prod
pnpm run cli server --port 8102 --server-id arcadia-local

```

打开 `http://localhost:8102` 使用配套网页。开发模式可用以下命令替代上面的启动命令，后端与前端分别在独立终端运行：

```sh
pnpm cli server --headless --cors-origin http://localhost:5173
pnpm web:dev
```

服务器采用单进程内存房间：停机、重启或部署会结束所有房间；页面刷新和短时断线可在原进程仍存活时重连。本地 UID 不承担登录或席位权限。详见[服务端运行与身份约定](docs/guides/server-runtime.md)。

## 内容包读取边界

生产路径读取已构建或已准备的内容，不直接读取内容项目的 `data/`、`src/` 或 `locales/` 源目录。`base` 与 UGC 使用同一套准备和发布规则。

| 运行场景        | base package                                                                          | UGC package                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 浏览器离线      | 默认网页环境从随发行物提供的 base npm 包准备；自定义环境由项目依赖树决定，可省略 base | 构建时通过 `ARCADIA_WEB_ENVIRONMENT_PROJECT` 的环境安装树准备，与 base 共用 `environment/catalog.json` 和 `environment/runtime.json` |
| 浏览器 + 服务器 | 房间目录、媒体地址和运行结果来自当前服务器；P2P 另从该服务器读取 `peer-materials`     | 与 base 相同，使用当前服务器发布的环境，不回退到浏览器本地同名包                                                                     |
| 客户端单机      | 内容定义与战斗材料从桌面内容库中随应用安装的 base npm 包准备                          | 从桌面内容库安装的 UGC npm 包准备，与 base 一起由 `prepareNpmProject` 生成会话环境                                                   |
| 客户端 + 服务器 | 本机服务器借用桌面工作区的同一已准备项目；远程服务器只使用其发布环境                  | 与 base 相同；本机不复制第二份内容库，远程不使用本地同名包替代                                                                       |
| 服务端          | 通过 `prepareShippedEnvironment` 读取随发行物提供的已编译 base 包                     | 从服务器工作区或启动项目安装树通过 `prepareNpmProject` 准备，并发布给房间                                                            |

桌面本机服务器通过私有工作区桥接采用同一版本，不创建可写副本；桌面远程连接只消费远程服务器目录。浏览器页面从生产发行物的 `dist/web` 加载这些入口。

桌面应用的资源索引与内容定义、战斗材料来自同一份已准备内容，不再单独读取 `userData/packs/base`。

## 开发文档

从[文档导航](docs/README.md)或[指南](docs/guides/battle-engine.md)开始。内容包作者见[创建并测试 TypeScript 内容包](docs/guides/ugc-authoring-start.md)。

## 许可证

本仓库采用 [MIT 许可证](LICENSE)。第三方依赖和外部游戏资源遵循各自的许可与版权声明。

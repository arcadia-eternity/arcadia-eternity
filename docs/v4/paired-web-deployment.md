# 配套网页与单服务器部署

浏览器的一个站点固定配对一个后端。认证、HTTP API、Socket.IO、环境目录和战报都使用同一份部署配置；浏览器不会读取历史选服存储或 `?server=` 参数。#222 的多服务器选择 UX 属于桌面客户端：手动输入的服务器（包括 localhost）在独立的联机窗口打开。本机托管只信任桌面主进程启动并报告的准确宿主地址。

## 默认同源发行物

支持 Node.js 24 和 pnpm 11.21.0。在干净源码目录执行：

```sh
pnpm install --frozen-lockfile
pnpm build:prod
node dist/cli.js server --port 8102 --server-id my-community
```

打开 `http://localhost:8102` 即可访问配套网页。`build:prod` 会构建对应的网页并将其放入 `dist/web`；Dockerfile 使用相同构建链并复制整个 `dist`。服务端默认从发行物内的 `dist/web` 启动；缺失 `index.html` 或兼容清单时明确失败，不转向远端官方网页。清单 `arcadia-web-manifest.json` 包含发行版本、配置 schema 和对战协议版本，可直接读取检查。升级时整体替换同一版本的服务端与 `dist/web`。

容器构建和运行示例（只在自己的环境执行）：

```sh
docker build -t arcadia-community .
docker run --rm -p 8102:8102 -e SERVER_ID=my-community arcadia-community
```

服务端动态提供 `/arcadia-client.json`：

```json
{ "schemaVersion": 1, "backendOrigin": "/" }
```

这会在浏览器启动、导入应用和初始化服务前解析为当前站点 origin。API、Socket.IO 与环境素材由同一监听器提供。房间邀请保留本站点地址，房间路径、图鉴和战报路径刷新均返回 SPA；未知 API、Socket.IO 和资源路径返回错误，不被替换成 HTML。网页和环境资源继续使用 `no-store`，没有为发行物引入 UGC 预下载。

TLS 反向代理必须显式设置公开 origin，例如 `PUBLIC_ORIGIN=https://play.example.com`。公共监听器允许精确 HTTP(S) origins，以及发行客户端固定来源 `arcadia-client://app`；拒绝通配符、其他自定义 scheme 与 `null`。默认允许这个固定桌面来源；显式设置 `CORS_ORIGIN` / `--cors-origin` 时使用管理员给定的完整列表（可排除桌面来源）。这个来源不代表可信身份，也不授予内容执行或本机权限。同源 HTTP 直连默认允许本站 origin；前后端分离时通过 `CORS_ORIGIN` 列出实际配套站点。Socket.IO WebSocket 握手使用相同来源判定。CORS 只控制浏览器跨源访问，不授予内容执行或桌面权限。

## 独立网页与 headless

官方式前后端分离继续支持：

```sh
VITE_BACKEND_ORIGIN=https://api.example.com pnpm --filter @arcadia-eternity/web-ui build
CORS_ORIGIN=https://play.example.com node dist/cli.js server --headless
```

将 `packages/web-ui/dist` 部署到 `https://play.example.com`。网页产物的 `/arcadia-client.json` 是部署者配置的唯一联机来源；也可以在发布静态文件时替换这份 JSON。使用 `/` 表示同源，或写一个完整且没有路径、凭据、query、fragment 的 HTTP(S) origin。HTTPS 站点不能配对 HTTP 后端。配置缺失、版本错误或地址非法会显示启动错误；不会退回官方服或 localhost。旧的 `VITE_API_BASE_URL`、`VITE_WS_URL` 不再分别决定端点。

`--headless`（或 `ARCADIA_HEADLESS=1`）保留纯 API/Socket.IO 模式，不要求网页。`--web-root /absolute/path` 或 `ARCADIA_WEB_ROOT` 可指定另一个兼容网页目录；不能与 `--headless` 同时使用。直接使用 `createSingleProcessApp()` 的嵌入式宿主仍默认 headless，只有传入 `webRoot` 才挂载网页。桌面本机宿主使用 IPC 授权的 loopback 模式，专属的 opaque origin 例外不能用于公共监听器。

本机开发默认通过 Vite 同源代理 `/api`、`/socket.io`、`/health`；后端显式 headless：

```sh
pnpm cli server --headless --cors-origin http://localhost:5173
pnpm web:dev
```

如果开发网页直接连接不同后端，设置 `VITE_BACKEND_ORIGIN` 并为准确网页 origin 配置 CORS。账号 G3 模式仍需明确 `SERVER_ID`、数据库、SMTP 和 GitHub App 配置；每个 GitHub `/account` 回调必须与配套站点精确一致，网页 origin 集合须与 CORS 配置中的 HTTP(S) origins 一致，详见 [服务器运行时](./server-runtime.md)。

离线静态构建及本地创作流程继续保留，离线模式不会为联机配置选择一个网络服务器。这里的构建与本机验证不发布 npm，也不执行生产部署。

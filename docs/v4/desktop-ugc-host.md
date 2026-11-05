# 桌面本机对战宿主基础

Electron 主进程提供独立本机对战子进程管理，并作为客户端内容工作区的唯一写入 owner。Renderer 保持 `contextIsolation` 和 `nodeIntegration: false`；服务端权威对战读取公开内容，个人/peer 对战的作者代码由受限 Worker 执行，不能在 Renderer 主线程或特权 IPC 中求值。持久环境绑定、网络设置和远程权限见[统一管理](unified-management.md)。

`/content` 已接入命名项目登记、内容包与依赖查看、安装、显式准入、校验、启停和导出；队伍缺失内容的保留策略及边界见[内容包与环境管理](content-management.md)。

桌面桥提供三个受限入口：

- `selectAndStartLocalBattle()` 打开系统目录选择器，选择一个已完整安装、带锁文件和 `arcadia-admission.json` 的服务器项目，再启动本机服务；取消选择时返回 `cancelled`，不改变已有服务。
- `getLocalBattleStatus()` 返回 `idle`、`starting`、`running`、`stopping` 或 `failed`。就绪时包含连接地址、稳定服务器身份与本次运行信息，不返回任意宿主路径或凭据。
- `stopLocalBattle()` 停止本机服务。停止会结束其房间和对局；退出或重启桌面应用也会先停止服务。桌面进程异常消失时，子进程正常情况下会检测连接断开并退出。

这些 IPC 只允许当前受信任窗口的主 frame 调用。Renderer 不能指定命令、执行文件或任意项目路径；文件/目录来自系统对话框或已登记句柄。持久托管默认 `127.0.0.1` 和随机端口；可信管理页可通过受校验的 settings 合同保存监听、publicOrigin、CORS 与容量，待重启字段明确显示。父进程从私有就绪通道核对稳定 serverId 和实际监听端口，网络地址不被当作连通性保证。子进程通过 owner 借用既有内容与租约，不创建另一份包库；安装准备与实际 Effect 执行分别受策略约束。

开发模式的服务入口为仓库根目录的 `dist/cli.js`，需先构建 CLI 及其依赖，并由开发机提供可运行的 npm。Windows 开发环境使用 Node 安装目录旁的 `node_modules/npm/bin/npm-cli.js`，不能假定 `npm.cmd` 可由 `execFile('npm')` 直接运行。

桌面运行时由 `scripts/stage-desktop-runtime.mjs` 准备，包括 CLI 的全部构建分块、服务器生产依赖、官方 Base 和锁定为 11.17.0 的 npm。安装后的宿主使用应用自带的 Electron Node 运行 `resources/arcadia-server/runtime/npm/bin/npm-cli.js`，不依赖用户 PATH 中的 Node 或 npm。npm 包来源与完整性、Electron 版本和内嵌 Node 版本记录在运行时清单；许可证文本和待核对项记录在 `licenses/notice.json`。构建时需先安装锁文件中的依赖并构建工作区，再从仓库根目录执行：

```sh
node scripts/stage-desktop-runtime.mjs --output packages/web-ui/dist/arcadia-server
```

默认离线使用已缓存依赖；需要获取缺失依赖时可显式加 `--online`。输出目录必须不存在，脚本不会覆盖已有目录。发生错误时检查输出目录；若存在未完成的目录，应手动移除或选用新目录，清单在所有文件完成后才写入。staging 已加入跨平台路径/调用处理；实际四平台执行由非发布 CI 验证，不能把模拟 Windows 路径测试当作 Windows 安装验收。

Electron Builder 会在打包前检查 staging 清单，并在打包后重新核对复制结果；运行 `pnpm --filter @arcadia-eternity/web-ui build:desktop` 会先构建、准备运行时再打包，且不会自动发布。构建和发布默认收集原始许可证文本，将缺失或声明不一致记录为提示，不以此阻止发布；运行入口、依赖、路径边界、清单一致性和 native ABI 检查仍会失败退出。仓库与各自有包统一采用 MIT 许可证，版权署名为 Arcadia Eternity contributors；桌面打包会收录根目录的完整 MIT 文本，并用于声明一致且未携带独立许可证文本的自有包。

`node scripts/verify-desktop-pack.mjs` 校验运行时并输出许可清单提示；发布工作流和 `electron:pack:publish` 使用此默认模式。需要严格核对许可资料时，显式加 `--require-complete-notices`，staging 脚本也支持这个选项。旧的 `--allow-incomplete-notices` 仍可使用，与默认行为一致。运行时清单中的旧字段 `releaseReady` 仅记录严格许可资料检查是否完整，不再作为默认发布开关。

当前许可清单保留 `@npmcli/agent@4.0.2` 缺少适用原文、`@npmcli/redact@4.0.0` 声明与文本不一致两项提示。2026-11-05 核对的最新版本 agent 5.0.2 和 redact 5.0.0 仍存在对应问题，因此保留已验证的 npm 11.17.0。四平台真实安装与同版本替换已通过；按用户确定的范围，签名/公证暂缓，历史版本升级不作为本轮验收要求。具体提交和结果见[后续验证记录](validation/unified-management-followup-2026-11-05.md)。

本机功能验证可以使用独立预览构建：

```sh
pnpm --filter @arcadia-eternity/web-ui build:desktop:preview
```

此命令生成名称为 `Arcadia Eternity Preview` 的未发布应用目录，输出到 `packages/web-ui/release-preview/`；它允许许可证清单待补，但仍在打包前后校验运行时摘要及实际复制的资源。清单保留待核对项和真实的 `releaseReady` 值。预览命令不会推送或发布。

当前 Renderer 的启动、状态和连接界面需与桌面桥一同使用；完整安装版离线资源与跨服场景按 #258/#259 的对应证据验收。`local-battle-host.test.mjs` 使用真实本机回环端口及模拟 CLI，检查启动、错误、身份、退出和父进程异常；设置 `ARCADIA_DESKTOP_REAL_HOST=1` 后运行 `local-battle-real.test.mjs`，可通过本机 Node 子进程离线安装并启动真实示例、检查 CORS、本地修改无需重新准入及无效准入记录拒绝。macOS ARM64 的本机测试目录已用打包内 Electron、npm、CLI 和 Base 运行真实 UGC 测试，验证批准项目启动、本地修改后启动及无效准入记录的拒绝。真实安装包的首次运行、同版本替换与数据保留证据另见后续验证记录。

### Remote play permission boundary (#251)

The desktop manager opens a third-party backend in a separate window running the bundled client UI. Each opening uses a new nonpersistent Electron session; switching destroys the previous window and clears its storage and connections. Server identity and authentication start from the host-selected HTTP(S) origin, not a server-reported ID or a page query. The remote preload exposes the host boot configuration, window close, and the bounded SWF presentation bridge; the manager preload retains the explicit local creator, package and hosting operations.

Every `desktop:*` IPC handler, including legacy workspace, download and updater handlers, requires the registered manager WebContents and its current main frame. Remote main frames and nested frames cannot invoke those handlers. Windows deny popups, external navigation and webviews; remote sessions deny permissions and downloads and keep web security enabled. The legacy loopback workspace HTTP endpoint requires a random main-process token injected only into manager requests. It is not available to remote windows, ordinary webpages or arbitrary local HTTP clients. The legacy pet download operation accepts only its built-in resource URL.

`node --test packages/web-ui/electron/remote-play.test.mjs` covers URL validation, session lifecycle and handler registration. `ARCADIA_DESKTOP_GUI_TEST=1 node --test packages/web-ui/electron/test/remote-permissions-electron.test.mjs` exercises the real Electron main process and preloads with a minimal bundled-UI fixture: remote bridge surface, all manager-handler denials using real main/child frame identities, and storage disposal after switching. It does not establish full gameplay, release packaging, Windows/Linux or malicious SWF acceptance; those need their separate integration evidence.

The bundled desktop renderer uses the fixed secure origin `arcadia-client://app`; the per-session protocol serves only files inside the bundled client directory and never fetches server URLs. Remote servers must allow that exact desktop origin through their CORS configuration. Development uses the configured local development origin. `ARCADIA_DESKTOP_BUNDLED_RENDERER_TEST=1` runs the permission smoke through the actual bundled protocol path with a temporary minimal UI fixture, including a real cross-origin request carrying the desktop origin. This validates the packaged renderer path, not an installed/signed release artifact.

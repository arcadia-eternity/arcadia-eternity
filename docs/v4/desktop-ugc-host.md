# 桌面本机对战宿主基础

Electron 主进程提供独立本机对战子进程管理。Renderer 继续保持 `contextIsolation` 和 `nodeIntegration: false`，只读取服务器的公开内容、资源与对战状态，不载入 npm 效果代码。

桌面桥提供三个受限入口：

- `selectAndStartLocalBattle()` 打开系统目录选择器，选择一个已完整安装、带锁文件和 `arcadia-admission.json` 的服务器项目，再启动本机服务；取消选择时返回 `cancelled`，不改变已有服务。
- `getLocalBattleStatus()` 返回 `idle`、`starting`、`running`、`stopping` 或 `failed`。就绪时包含回环地址、服务器本次启动身份及项目目录名，不返回本机完整路径或宿主日志。
- `stopLocalBattle()` 停止本机服务。停止会结束其房间和对局；退出或重启桌面应用也会先停止服务。桌面进程异常消失时，子进程正常情况下会检测连接断开并退出。

这些 IPC 只允许当前受信任窗口的主 frame 调用。Renderer 不能指定命令、执行文件、参数、服务器监听地址或任意项目路径；项目必须由系统对话框显式选定。宿主在子进程中使用服务器现有的安装检查和准入记录，绑定 `127.0.0.1` 的随机端口，校验就绪响应中的本次启动身份。子进程仅收到基本运行环境变量，不继承账户凭据，也不从项目或工作目录自动加载 `.env`；启动不会安装依赖或访问工坊。准入代码仍具有本机进程权限，不能把子进程当成不可信 JavaScript 沙箱。

开发模式的服务入口为仓库根目录的 `dist/cli.js`，需先构建 CLI 及其依赖，并由开发机提供可运行的 npm。Windows 开发环境使用 Node 安装目录旁的 `node_modules/npm/bin/npm-cli.js`，不能假定 `npm.cmd` 可由 `execFile('npm')` 直接运行。

桌面运行时由 `scripts/stage-desktop-runtime.mjs` 准备，包括 CLI 的全部构建分块、服务器生产依赖、官方 Base 和锁定为 11.17.0 的 npm。安装后的宿主使用应用自带的 Electron Node 运行 `resources/arcadia-server/runtime/npm/bin/npm-cli.js`，不依赖用户 PATH 中的 Node 或 npm。npm 包来源与完整性、Electron 版本和内嵌 Node 版本记录在运行时清单；许可证文本和待核对项记录在 `licenses/notice.json`。构建时需先安装锁文件中的依赖并构建工作区，再从仓库根目录执行：

```sh
node scripts/stage-desktop-runtime.mjs --output packages/web-ui/dist/arcadia-server --allow-incomplete-notices
```

默认离线使用已缓存依赖；需要获取缺失依赖时可显式加 `--online`。输出目录必须不存在，脚本不会覆盖已有目录。发生错误时检查输出目录；若存在未完成的目录，应手动移除或选用新目录，清单在所有文件完成后才写入。当前 staging 仅在 macOS 上验证，Windows staging 会明确拒绝；Linux 尚未验证。

Electron Builder 会在打包前检查 staging 清单，并在打包后重新核对复制结果；运行 `pnpm --filter @arcadia-eternity/web-ui build:desktop` 会先构建、准备运行时再打包，且不会自动发布。本地打包允许许可证资料待补，清单仍记录待核对项目和 `releaseReady: false`；完整性校验不会因此跳过。当前自有包按 MIT 声明，版权署名暂未填写；仓库根目录的 MPL 文本不会被当作自有包的 MIT 许可证。部分第三方包的许可证文本或声明也待核对。

需要检查完整许可证资料时，可在 staging 完成后运行 `node scripts/verify-desktop-pack.mjs --require-complete-notices`；缺项或内容完整性不符时该命令会失败。`electron:pack:publish` 同样先执行这项检查，发布仍需单独执行。直接运行 staging 脚本时，不加 `--allow-incomplete-notices` 也会要求清单完整。

本机功能验证可以使用独立预览构建：

```sh
pnpm --filter @arcadia-eternity/web-ui build:desktop:preview
```

此命令生成名称为 `Arcadia Eternity Preview` 的未发布应用目录，输出到 `packages/web-ui/release-preview/`；它允许许可证清单待补，但仍在打包前后校验运行时摘要及实际复制的资源。清单保留待核对项和真实的 `releaseReady` 值。预览命令不会推送或发布。

当前 Renderer 的启动、状态和连接界面需与桌面桥一同使用；在真实安装包上断网运行、版本升级保留数据、导出/恢复服务器项目和动态切换远程服务器仍未验收。`local-battle-host.test.mjs` 使用真实本机回环端口及模拟 CLI，检查启动、错误、身份、退出和父进程异常；设置 `ARCADIA_DESKTOP_REAL_HOST=1` 后运行 `local-battle-real.test.mjs`，可通过本机 Node 子进程离线安装并启动真实示例、检查 CORS 和未准入拒绝。macOS ARM64 的本机测试目录已用打包内 Electron、npm、CLI 和 Base 运行真实 UGC 测试，验证批准内容启动及批准记录变化后的拒绝；该测试目录的许可证资料不完整，不可发行。这些测试不代替签名安装包验收。

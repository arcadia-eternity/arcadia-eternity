# 桌面本机对战宿主基础

Electron 主进程提供独立本机对战子进程管理。Renderer 继续保持 `contextIsolation` 和 `nodeIntegration: false`，只读取服务器的公开内容、资源与对战状态，不载入 npm 效果代码。

桌面桥提供三个受限入口：

- `selectAndStartLocalBattle()` 打开系统目录选择器，选择一个已完整安装、带锁文件和 `arcadia-admission.json` 的服务器项目，再启动本机服务；取消选择时返回 `cancelled`，不改变已有服务。
- `getLocalBattleStatus()` 返回 `idle`、`starting`、`running`、`stopping` 或 `failed`。就绪时包含回环地址、服务器本次启动身份及项目目录名，不返回本机完整路径或宿主日志。
- `stopLocalBattle()` 停止本机服务。停止会结束其房间和对局；退出或重启桌面应用也会先停止服务。桌面进程异常消失时，子进程正常情况下会检测连接断开并退出。

这些 IPC 只允许当前受信任窗口的主 frame 调用。Renderer 不能指定命令、执行文件、参数、服务器监听地址或任意项目路径；项目必须由系统对话框显式选定。宿主在子进程中使用服务器现有的安装检查和准入记录，绑定 `127.0.0.1` 的随机端口，校验就绪响应中的本次启动身份。子进程仅收到基本运行环境变量，不继承账户凭据，也不从项目或工作目录自动加载 `.env`；启动不会安装依赖或访问工坊。准入代码仍具有本机进程权限，不能把子进程当成不可信 JavaScript 沙箱。

开发模式的服务入口为仓库根目录的 `dist/cli.js`，需先构建 CLI 及其依赖，并由开发机提供可运行的 npm。生成安装包时，桌面应用预期在 `resources/arcadia-server/cli.js` 提供服务入口，并在 `resources/arcadia-server/runtime/bin` 提供与内嵌 Node 配套的 npm 启动器；当前 Electron 打包配置尚未包含这些文件，安装版会明确报告运行时缺失。还需打包官方 Base、Node 所需依赖和 npm 本身，并验证打包与平台上的运行路径，不应假设用户另装 Node 或 npm。尤其需要为 Windows 提供可由现有 npm 检查器执行的启动方式：`npm.cmd` 不能被假定可通过 `execFile('npm')` 直接运行。

当前 Renderer 的启动、状态和连接界面需与桌面桥一同使用；在真实安装包上断网运行、版本升级保留数据、导出/恢复服务器项目和动态切换远程服务器仍未验收。`local-battle-host.test.mjs` 使用真实本机回环端口及模拟 CLI，检查启动、错误、身份、退出和父进程异常；设置 `ARCADIA_DESKTOP_REAL_HOST=1` 后运行 `local-battle-real.test.mjs`，可通过本机 Node 子进程离线安装并启动真实示例、检查 CORS 和未准入拒绝。这些测试不代替 Electron 安装包验收。

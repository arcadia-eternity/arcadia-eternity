# 本机内容包预览

## 单人画面试玩

源项目工作台在“检查与运行”中提供“准备画面试玩”，准备完成后打开独立战斗窗口。CLI `arcadia-content workspace /path/to/source preview --execute` 和 MCP `preview_start` 使用同一个流程：复制已保存源文件到独立构建目录，打包并安装真实 npm 产物，启动仅监听 `127.0.0.1` 的 Node 战斗宿主。第一位配置玩家可操作，第二位由 AI 操作；队伍来自 `arcadia.config.mjs`。客户端使用现有完整战斗页，接收公开内容、按需媒体与战斗消息。

任务返回 `preview.endpoint` 和 `preview.clientPath`；设置 `ARCADIA_PREVIEW_CLIENT_URL` 后同时返回完整客户端地址。桌面自动配置这个地址，并在无管理能力、独立存储的窗口内打开试玩。候选绑定源修订与 npm 包身份；保存新源码不替换已有候选，新候选失败或取消不影响旧对局。任务记录共享到 `.arcadia/author-jobs`，支持其他 CLI／MCP／桌面入口查询及取消。任务宿主退出后，新会话显示 interrupted；重新运行以创建候选，运行进程和临时安装不跨重启保留。

## 联机服务器候选

这个流程从一个明确的 npm 内容包源码目录准备独立候选，然后由管理员检查并准入，最后启动一个新的本机服务器。源码目录必须已经配置好构建工具和依赖；目前 Arcadia SDK 尚未作为公共 npm 包发布，不能假设新项目能在干净主机上直接安装 SDK。有关源码编辑界面见 [本机开发工作区](./development-workspace.md)。

以下示例需要已经构建的 `dist/cli.js`。在仓库根目录执行，将 `/path/to/source` 和 `/path/to/new-candidate` 换成本机路径。候选目录必须不存在，且不在源码目录中。

```sh
node dist/cli.js content dev prepare /path/to/source /path/to/new-candidate --run-build --json
```

`--run-build` 是管理员对该项目 `npm run build` 的显式授权，构建脚本可执行任意本机代码。命令不会运行 prebuild、postbuild、打包或安装生命周期脚本，也不会运行测试。要执行作者测试，管理员须在项目中另行手动执行其测试命令。不加 `--run-build` 时仅打包已有输出；输出可能与当前源码不一致，不能将此时的源码指纹当作构建证明。需要只使用已缓存的依赖时加 `--offline`。

输出和候选中的 `arcadia-preview.json` 记录源码指纹、包摘要、依赖与内容元数据摘要和是否执行了构建。源码指纹覆盖源码目录中的普通文件（包括内容、代码和配置），排除 `.git`、`node_modules`、`dist`；不支持其他符号链接。它不记录构建依赖或构建工具的身份，不能证明构建可复现。构建、打包及准备期间检测到源码变化会失败；构建输出应写入 `dist`。包摘要代表实际打包文件，并非环境身份。候选安装失败不会改变已有环境或房间。

准备完成不会准入或运行内容代码。先检查安装内容，再由管理员单独准入该项目；后续本地改动不要求重新批准：

```sh
node dist/cli.js content npm inspect /path/to/new-candidate --json
node dist/cli.js content npm approve /path/to/new-candidate --profile local-development
node dist/cli.js content validate --npm-project /path/to/new-candidate --json
```

验证会执行已准入的效果代码，输出实际 `revision` 与 `build`；批准前应检查内容包及其完整依赖。然后在单独终端启动本机服务器，选择未占用的端口，例如：

```sh
node dist/cli.js server --host 127.0.0.1 --port 8102 --npm-project /path/to/new-candidate
```

服务就绪后，`http://127.0.0.1:8102/api/v1/environments` 列出实际环境 ID、运行时构建及内容包；网页可以连接 `http://127.0.0.1:8102` 并在创建房间时选择该环境。默认服务器需要兼容的 `dist/web` 配套网页，打开同源地址即可游玩，构建方式见[配套网页部署](paired-web-deployment.md)。如需另行启动前端，则显式使用 `--headless`，固定网页后端并配置准确的 CORS 来源。该命令不会替换已经运行的服务或房间；要预览新的修改，应准备、检查和准入另一个候选，再启动新的服务实例。

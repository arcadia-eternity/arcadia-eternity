# 安装 UGC SDK

创作 SDK 和官方基础包随 Arcadia 正式版本一起发布到 npmjs.org，使用 `latest` 标签。

## 安装

正式包发布后，在 Node.js 24 项目里安装：

```sh
npm install --save-dev --save-exact @arcadia-eternity/content-sdk
```

效果代码从 `@arcadia-eternity/content-sdk` 导入类型，测试从 `@arcadia-eternity/content-sdk/testing` 导入助手。SDK 同时提供 `arcadia-content` 和 `arcadia-content-mcp`。如果项目的 `.npmrc` 还把 `@arcadia-eternity` 指向 GitHub Packages，请移除这条 scope 配置。

要从发行包自带的模板创建项目，在空目录执行：

```sh
sdk_dir=$(mktemp -d)
npm install --prefix "$sdk_dir" --ignore-scripts --no-save @arcadia-eternity/content-sdk
cp -R "$sdk_dir/node_modules/@arcadia-eternity/content-sdk/dist/template/." .
[ ! -f gitignore-template ] || mv gitignore-template .gitignore
[ ! -f npm-lock-template.json ] || mv npm-lock-template.json package-lock.json
rm -r "$sdk_dir"
npm install
npm run check
npm test
npm run demo
npm run pack
```

模板固定 SDK 的发行版本。提交项目的 `package-lock.json` 后，可以用 `npm ci` 重现安装。`arcadia.sdkApi` 表示效果接口版本，宿主准备环境时也会检查构建身份和代码准入。

如果内容包引用了官方数据，在运行依赖中声明相应的基础包版本：

```sh
npm install --save-exact @arcadia-eternity/data-pack-base
```

官方效果入口为 `@arcadia-eternity/data-pack-base/effects`，构建身份入口为 `@arcadia-eternity/data-pack-base/build`，数据清单由 `package.json#arcadiaEternityPack` 指向 `dist/pack.json`。发行包只包含编译后的内容、表现、语言 JSON、效果工件和媒体，不包含 `data/`、`locales/` 或 `src/` 源文件。通过 npm 安装的基础包和 UGC 包均为只读；修改内容需回到作者源项目重新构建发布。

## 验证创作者的发行归档

在桌面创作工作台展开“更多操作”，选择“检查并生成发行包”。同一任务也可以从源项目运行：

```sh
npx arcadia-content workspace . release --execute
```

已开启执行权限的 MCP 会话使用 `release_check` 启动任务，通过 `job_get` 查看结果。任务通过 `arcadia-content pack --release` 构建并验证归档，再运行项目场景。标准 SDK 测试助手在独立目录安装指定归档，并核对完整性后执行实际对战。它要求包声明许可证并附带 LICENSE，将清单、运行依赖、预构建内容、效果与引用素材装入归档，在干净的临时消费者目录通过现有安装器解析依赖并准备环境。注册表依赖可能需要联网。

源项目可继续保留 `private: true`。发行清单仅保留消费所需字段，排除开发依赖、脚本和源映射。成功任务给出文件列表、归档名与完整性摘要。准备或测试失败时请查看任务诊断；通过检查只表示本地发行物可用。上传 GitHub Release 和可选的 npm 发布应引用这份归档。发布到 npm 时应将明确的 `.tgz` 路径交给 `npm publish`，并在发行工作流中配置 Trusted Publishing。

## 桌面 Git 工作区

在「创作」打开本地源项目，或选择「克隆源项目」并输入 HTTPS 仓库地址。首次使用克隆项目时，在「项目与外部工具」连接本机 SDK，或在源项目运行 `npm ci` 安装锁定的开发依赖。工作台使用系统 Git，沿用本机的提交身份和 HTTPS 凭据助手。

在「Git 版本管理」初始化仓库，点文件名查看磁盘上的修改。在「未暂存」与「已暂存」之间移动文件后填写提交说明。工作台会刷新外部编辑器产生的修改。保存表单草稿后再提交或拉取。拉取仅支持快进，分叉、合并冲突、带自定义钩子的仓库和链接工作树通过外部 Git 工具处理。

计划发布到 npm 时，先选定你有发布权限的包名。首次分发前可使用模板已有的 `npm run rename -- --name @your-scope/my-pack --project-id my-pack --namespace my-pack` 一起更新引用。分发后的同一个包应保留项目身份与命名空间。

在「项目与外部工具」查看身份、SDK API、宿主兼容范围，编辑 npm 版本与运行依赖。改动运行依赖后，在发行面板选择「更新 npm 锁文件」，或使用 npm 更新项目的开发安装和锁文件。在干净的源项目副本执行 `npm install --package-lock-only --ignore-scripts` 可仅生成锁文件。将 `package-lock.json` 与声明一同提交，以便 Actions 执行 `npm ci`。

保存源码、提交版本变更，运行「检查并生成发行包」。成功后回到 Git 面板创建对应的本地版本标签；推送分支与推送标签有各自的目标确认。没有远端也可完成本地发行检查、标记版本，并将产物用于环境。只读工具可以用 `arcadia-content workspace . git-status`，或给 `git-diff` 传入 JSON，例如 `{"file":"data/skills/strike.yaml","staged":true}`。MCP 对应 `git_status` 和 `git_diff`。

## GitHub Release 与 npm

在工作台选择「发布新版本」，展开「GitHub 仓库与发行」。在 GitHub 安装专用创作 App，选择允许访问的仓库，再在桌面连接创作账号、输入设备码。桌面可列出这些仓库并绑定到项目。创建个人仓库可选公开或私有；在 GitHub 网页创建后，也可把新仓库加入 App 的安装范围。

专用 GitHub App 需启用 Device Flow。桌面启动环境变量 `ARCADIA_CREATOR_GITHUB_CLIENT_ID` 可提供公开 Client ID，也可在连接时填写。仓库权限使用 Metadata 和 Contents 读取，手动启动发行工作流需要 Actions 写入。使用桌面 API 创建仓库另需 Administration 写入，可以直接选择「在 GitHub 创建」使用自己的浏览器会话。设备授权仅保存在 Electron 主进程内存中，断开或退出即清除本地会话；GitHub 设置中可撤销 App 授权。玩家登录仍使用服务器单独配置的身份提供方，Git 推送使用本机凭据助手。[GitHub 设备授权](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app) · [创建个人仓库权限](https://docs.github.com/en/rest/repos/repos#create-a-repository-for-the-authenticated-user)

推送分支和版本标签后，从桌面启动 **Release content pack**。工作流须先存在于仓库默认分支。GitHub 会在所选标签上使用 Node 24、锁定的公开 SDK 和模板脚本构建，检查发行清单，独立安装，再用临时消费者目录中的发行内容运行机制测试。桌面发起的工作流还要求归档 SHA-512 与本机已验证文件一致。工作台显示 Actions 的状态和失败记录，发行成功后可复制对应版本的归档地址。私有仓库的下载地址需要 GitHub 授权；公开分享安装请使用公开 Release，也可从浏览器下载后导入本地文件。

npm 发布为可选项。先选择「将仓库地址写入包声明」并提交，或把源项目的 `repository.url` 填为当前 GitHub 仓库的 HTTPS 地址，再为该包配置仓库、工作流 `release-pack.yml` 及允许直接发布的 Trusted Publisher。GitHub Release 和 npm 两个任务校验并使用同一个构建产物。npm 发布任务通过 OIDC 获取临时权限。[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)

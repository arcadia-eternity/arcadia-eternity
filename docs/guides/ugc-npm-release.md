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

在「创作」打开本地源项目，或选择「克隆源项目」并输入 HTTPS 仓库地址。首次使用克隆项目时，在「外部工具」连接本机 SDK，或在源项目运行 `npm ci` 安装锁定的开发依赖。工作台使用系统 Git 和本机提交身份。输入 HTTPS 地址克隆时使用本机凭据；选择「从 GitHub 打开」可以用创作 App 授权并克隆所选仓库。

在「Git 版本管理」初始化仓库，点文件名查看磁盘上的修改。在「未暂存」与「已暂存」之间移动文件后填写提交说明。工作台会刷新外部编辑器产生的修改。保存表单草稿后再提交或拉取。拉取仅支持快进，分叉、合并冲突、带自定义钩子的仓库和链接工作树通过外部 Git 工具处理。

计划发布到 npm 时，先选定你有发布权限的包名。首次分发前可使用模板已有的 `npm run rename -- --name @your-scope/my-pack --project-id my-pack --namespace my-pack` 一起更新引用。分发后的同一个包应保留项目身份与命名空间。

在「项目设置」查看身份、SDK API、宿主兼容范围，编辑 npm 版本与运行依赖。改动运行依赖后，在发行面板选择「更新 npm 锁文件」，或使用 npm 更新项目的开发安装和锁文件。在干净的源项目副本执行 `npm install --package-lock-only --ignore-scripts` 可仅生成锁文件。将 `package-lock.json` 与声明一同提交，以便 Actions 执行 `npm ci`。

保存源码、提交版本变更，运行「检查并生成发行包」。成功后在「发布新版本」创建对应的本地版本标签；推送分支与推送标签有各自的目标确认。没有远端也可完成本地发行检查、标记版本，并将产物用于环境。只读工具可以用 `arcadia-content workspace . git-status`，或给 `git-diff` 传入 JSON，例如 `{"file":"data/skills/strike.yaml","staged":true}`。MCP 对应 `git_status` 和 `git_diff`。

## 使用 GitHub App 同步源码

在「Git 版本管理」打开「GitHub 同步」，点击「连接 GitHub」并按提示输入设备码。桌面默认连接组织的 [Arcadia Eternity Creator](https://github.com/apps/arcadia-eternity-creator)。首次使用时，把创作 App 安装到自己的 GitHub 账号。桌面新建内容包时会初始化本地 Git。首次点「GitHub 同步」时，如果项目还没有远端，登录后桌面会提示用项目名创建个人私有仓库。确认后自动绑定；想改仓库名、设为公开或绑定已有仓库，可以取消此次确认，在同步面板选择。已有远端的项目直接进入同步。暂存文件、填写提交说明并完成首次提交后，选择「推送分支」。此处可获取更新、快进拉取或推送当前分支。推送分支只更新源代码，日常同步无需修改包版本、生成归档或创建标签。模板的正式发行工作流由作者手动启动。

创作 App 启用 Device Flow。创建个人仓库需要 Repository creation 写入。同步需要 Metadata 读取和 Contents 读写；推送模板自带的 `.github/workflows/` 文件还需 Workflows 写入。GitHub 仓库自身的分支保护仍然生效。自托管客户端可以通过 `ARCADIA_CREATOR_GITHUB_CLIENT_ID` 覆盖公开 Client ID。设备授权仅用于创作，Git 传输使用所选仓库的临时凭据。断开账号或退出客户端即可清除会话。[GitHub App 权限](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)

## GitHub Release 与 npm

需要正式分发时，进入「发布新版本」检查归档、创建版本标签，再同步标签。通过 App 启动发行工作流另需 Actions 写入权限。

推送分支和版本标签后，从桌面启动 **Release content pack**。工作流须先存在于仓库默认分支。GitHub 会在所选标签上使用 Node 24、锁定的公开 SDK 和模板脚本构建，检查发行清单，独立安装，再用临时消费者目录中的发行内容运行机制测试。桌面发起的工作流还要求归档 SHA-512 与本机已验证文件一致。工作台显示 Actions 的状态和失败记录。公开仓库上传当前版本的发行归档后，发行页会自动显示安装链接。点击「复制安装链接」发给玩家，玩家在「安装内容包」选择「HTTPS 发行归档」并粘贴即可安装。使用私有仓库的作者可以把该版本的 .tgz 文件直接发给玩家导入。

npm 发布为可选项。先选择「将仓库地址写入包声明」并提交，或把源项目的 `repository.url` 填为当前 GitHub 仓库的 HTTPS 地址，再为该包配置仓库、工作流 `release-pack.yml` 及允许直接发布的 Trusted Publisher。GitHub Release 和 npm 两个任务校验并使用同一个构建产物。npm 发布任务通过 OIDC 获取临时权限。[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)

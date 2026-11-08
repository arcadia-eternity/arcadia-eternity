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

官方效果入口为 `@arcadia-eternity/data-pack-base/effects`，构建身份入口为 `@arcadia-eternity/data-pack-base/build`，数据清单位于包目录下的 `pack.json`。

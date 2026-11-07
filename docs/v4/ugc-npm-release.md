# UGC SDK 的 GitHub Packages 发布

作者 SDK 和工具使用同一预览版本 `4.0.0-preview.1`，registry 为 `https://npm.pkg.github.com`，dist-tag 为 `preview`。本次不发布到 npmjs.org。旧的 `1.0.0` 包属于历史版本，不用于 V4 创作。

## 安装

使用 Node.js 24。项目的 `.npmrc` 只配置 scope：

```ini
@arcadia-eternity:registry=https://npm.pkg.github.com
```

用 GitHub personal access token (classic) 登录，token 至少需要 `read:packages` 和包读取权限；密码位置填 token，不要将 token 提交到仓库：

```sh
npm login --scope=@arcadia-eternity --auth-type=legacy --registry=https://npm.pkg.github.com
npm install --save-dev --save-exact @arcadia-eternity/content-dev@4.0.0-preview.1 @arcadia-eternity/battle@4.0.0-preview.1 @arcadia-eternity/pack-loader@4.0.0-preview.1
```

GitHub 的 npm registry 对公开包也要求认证，见 [GitHub npm registry 文档](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry)。普通第三方依赖仍从 npmjs.org 获取。

使用 [content-pack-template](https://github.com/arcadia-eternity/content-pack-template) 时，登录后直接运行：

```sh
npm install
npm run check
npm test
npm run demo
npm run pack
```

提交项目自己的 `package-lock.json`，后续安装使用 `npm ci`。包版本、SDK API (`2`) 和宿主构建身份是不同的概念；服务器准备环境时仍检查实际构建身份及准入。

需要官方内容的项目另行安装：

```sh
npm install --save-exact @arcadia-eternity/data-pack-base@4.0.0-preview.1
```

官方效果入口为 `@arcadia-eternity/data-pack-base/effects`，构建身份入口为 `@arcadia-eternity/data-pack-base/build`，数据清单位于包目录下的 `pack.json`。

## 发布范围

以下八个包包含 `dist`、许可证、声明文件和各自的公开入口：

- `@arcadia-eternity/const`
- `@arcadia-eternity/schema`
- `@arcadia-eternity/protocol`
- `@arcadia-eternity/interface`
- `@arcadia-eternity/battle`
- `@arcadia-eternity/pack-loader`
- `@arcadia-eternity/content-dev`
- `@arcadia-eternity/data-pack-base`

`content-dev` 包含 CLI、MCP、测试工具、工作区接口与创作模板。`battle` 另带构建身份和浏览器运行时实际打入的第三方许可证。仓库与各自有包统一采用 MIT 许可证，完整文本和版权署名见根目录及各包的 `LICENSE`。基础数据包包含官方规则数据、多语言、表现清单和原生效果；外部资源保持 URL，不预下载。基础包的旧开发 `pack-lock.yaml` 含本机路径，不进入 npm 包；安装版本由使用者的 npm lockfile 固定。客户端和服务器不在本次发布范围。

## 发布流程

在准备发布的提交上执行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @arcadia-eternity/content-dev... --filter @arcadia-eternity/data-pack-base... run build
pnpm test:content-dev
pnpm --filter @arcadia-eternity/pack-loader test:run
pnpm pack:ugc
pnpm verify:ugc-release
```

`pack:ugc` 使用 pnpm 将 workspace/catalog 引用转换成 registry 可用版本，检查每个入口、许可证和完整依赖集合，生成 `dist/ugc-release/release.json`、SHA-256 和八个 `.tgz`。验证在独立临时项目安装真实包，执行检查、行为测试、完整演示战斗及内容包打包。

GitHub Actions 的 **Publish UGC Packages** 可在指定分支手动运行，也可由 `ugc-v<version>` tag 触发。工作流使用 Node.js 24、pnpm 11.21.0、仓库 `GITHUB_TOKEN` 和 `packages: write` 权限，上传已验证的包，再按依赖顺序发布。最后使用空缓存从 GitHub Packages 重新安装并重复作者流程。

版本不可覆盖；发布失败后先检查哪些版本已存在，不能把跳过已有版本当作相同产物。修复后使用新版本。发布新版本时同步八个清单、内置模板、`examples/ugc/slow` 与独立模板的精确依赖，再更新安装文档。

新建包的可见性和跨仓库 Actions 读取权限在 GitHub 包设置中管理。独立模板 CI 可使用仓库 secret `ARCADIA_PACKAGES_TOKEN`（只需 `read:packages`），或给模板仓库配置相应包的 Actions 读取权限后使用 `GITHUB_TOKEN`。

本地未发布源码的开发物料仍由 `scripts/stage-author-sdk.mjs` 生成，保留 private 标记及原有安装流程，不作为 registry 发行包。

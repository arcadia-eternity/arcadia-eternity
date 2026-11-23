# 创作者文档站

线上入口为 [Arcadia 创作者文档](https://arcadia-creator-docs.pages.dev)。在仓库根目录用 Node.js 24 构建：

```sh
npm ci --prefix docs/creator
npm run build --prefix docs/creator
```

本地预览使用 `npm run dev --prefix docs/creator`。编辑 `pages/` 后重新运行命令以更新生成页。首页入口在 `home.md`。分组、阅读顺序、页面路径与 MCP 查询符号在 `packages/content-dev/src/creator-docs.ts`；示例指令 `<<<` 从随 SDK 分发的模板读取代码。侧栏、API 目录与 `llms.txt` 从同一索引生成。构建 SDK 时同一份 Markdown 会进入发行包，可用 `author_reference` 按主题和符号读取。

Cloudflare Pages 项目 `arcadia-creator-docs` 关联主仓库，生产分支为 `main`。构建根目录为 `docs/creator`，设置 `SKIP_DEPENDENCY_INSTALL=1`，构建命令为 `npm ci --include=dev && npm run build`，输出目录为 `.vitepress/dist`，Node.js 主版本为 24。文档站可独立于游戏站发布。

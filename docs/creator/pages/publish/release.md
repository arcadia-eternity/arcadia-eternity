同伴需要协作开发时，分享 Git 源项目。玩家需要安装时，分享一个已经验证的版本归档。两种交付可以来自同一个仓库。

## 提交可重建的源码

在「查看并保存」里把草稿写回磁盘，进入「Git 版本管理」核对修改。玩法数据、效果源码、语言、资产、场景测试和锁文件一起提交。日常协作可以直接同步分支。决定发行时，在项目设置确定 npm 包名、版本及兼容范围；已有人使用的内容应保留项目 ID 与命名空间。改了依赖后更新并提交 `package-lock.json`。

## 检查准备发布的文件

在工作台运行「检查并生成发行包」，或在项目目录运行 `arcadia-content workspace . release --execute`。确保许可证声明和 `LICENSE` 已随项目保存。发行检查会构建归档，在独立的消费者目录安装、准备并运行场景测试。核对版本、文件列表和 SHA-512，特别是自己新增的本地素材。

## 发布并验收

1. 提交版本变更，创建与包版本对应的 `v<版本>` 标签。同步源码分支和标签。
2. 在 GitHub 的 **Release content pack** 工作流中选择这个标签运行。工作流需要先存在于默认分支。通过桌面启动时还会核对发行文件与本机已验证归档的 SHA-512。
3. 工作流成功后，从公开 Release 取得实际 `.tgz` 资产的安装链接。在另一份本机库中安装，用目标环境建队，验证新内容能进入对战。
4. 需要让其他资料包以 npm 依赖复用时，再为该包配置 Trusted Publishing；GitHub Release 与 npm 应分发同一份已检查归档。

## 发布环境

独立环境项目同样通过「发布新版本」发行，模板自带同名工作流 **Release environment**。发行环境须声明 `license`、`engines.arcadia` 并附带 `LICENSE`，所有依赖都要使用 npm 版本或范围；`file:candidates/*.tgz` 只用于本机调试，发行前请先发布这些资料包并改用它们的版本号。发行检查会在干净目录从 npm 安装依赖并准备环境，归档只含清单、测试队伍和许可证。

## 收录到创意工坊

npm 版本通过 Trusted Publishing 发布后，运行 `arcadia-content workshop declare . --id <你的名字>.<项目>` 生成声明，并向 [arcadia-workshop](https://github.com/arcadia-eternity/arcadia-workshop) 提交只添加 `projects/<id>.json` 的 Pull Request。之后发布到 npm 的版本会被自动收录。Registry CI 会按同样规则复查来源证明、仓库与归档。

助手可用 `git_status` 和 `git_diff` 帮你查看磁盘变更，用 `release_check` 和 `job_get` 跟踪发行检查。提交、推送、发布的目标由作者选择，外部助手使用自己的 Git/GitHub 授权。

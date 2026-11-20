---
name: arcadia-content-release
description: 准备、检查或发布 Arcadia Eternity 内容包版本。适用于验证发行归档、用版本标签启动仓库的 GitHub Release 工作流，以及按需发布到 npm。
---

# 发布内容包

先看当前源项目的 `package.json` 和实际发行工作流。下文的文件名和输入对应 SDK 模板。仓库有自己的发行流程时，以该仓库为准。用户只要求准备或检查发行包时，完成本地检查后即可交付归档。

## 验证要发行的版本

1. 核对包名、版本、许可证和 `LICENSE` 文件。版本或依赖有改动时，同步 `package-lock.json`。保留源项目的 `private: true`，模板会生成用于分发的清单。有工作台草稿时，确认本次要发行的修改已经保存到磁盘。
2. MCP 提供 `release_check` 时，启动任务并用 `job_get` 等到完成。已有检查可以从 `job_list` 查找。使用 `kind=release`、`state=succeeded` 且 `stale=false` 的结果，记录 `result.filename` 和 `result.integrity`。也可在工作台选择「检查并生成发行包」，或用项目已安装且支持此命令的 SDK 执行 `arcadia-content workspace . release --execute`。
3. 检查失败时查看任务诊断或 `job_output`。发行候选包含预构建内容，场景测试使用该归档。源码改变后重新检查，再使用新的归档和 SHA-512 摘要。

## 从已验证的提交发布

使用本机 Git 和助手自己已授权的 `gh` 或 GitHub 连接操作目标仓库。核对版本、远端以及要发布的提交。模板要求标签为 `v<package.json 版本>`。将已验证的源码提交推送到目标仓库，并推送指向该提交的版本标签。若已有同名标签，先核对它指向的提交。指向其他提交时，向用户说明版本冲突。

模板工作流为 `.github/workflows/release-pack.yml`，需已存在于默认分支。选择远端版本标签为运行目标，将本地检查得到的完整 `sha512-…` 值传给 `expected_integrity`。例如，已从当前项目确认仓库、标签和摘要并填入以下变量后，可用这条命令启动工作流。

```sh
gh workflow run release-pack.yml --repo "$repo" --ref "$tag" \
  -f expected_integrity="$integrity" -f publish_npm=false
```

使用助手的 GitHub 连接时，向同一工作流传入相同的标签和输入。默认发布到 GitHub Release。用户明确要求同时发布 npm 时，再启用 `publish_npm`，并核对包名、`repository.url` 与目标仓库，以及该包的 npm Trusted Publishing 配置。

跟踪本次运行。GitHub 发布成功后，返回对应版本的 Release 链接并核对 `.tgz` 附件。若同时选择了 npm，分别检查 GitHub 和 npm 两个任务的结果。遇到中断或部分成功时，先查询已有运行、Release 和已发布版本，再决定是否重试。

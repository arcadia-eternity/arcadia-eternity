---
name: arcadia-content-git
description: 在 Arcadia Eternity 内容包源项目提交或推送创作修改。适用于需要区分工作台草稿、已保存源码和本机配置的 Git 操作。
---

# 提交与同步内容包

先从 `workspace_describe` 或当前项目的 `package.json` 确认内容包目录。用 `git rev-parse --show-toplevel` 核对仓库。如果内容包位于更大的仓库中，将本次操作限定在用户指定的包和文件。已安装的只读包应回到对应源项目提交。

工作台打开时，用 `workspace_context` 检查与本次提交有关的草稿和冲突。Git 读取磁盘上的文件。若用户要提交的修改仍在表单里，请先让用户在工作台保存，再重新查看差异。其他对象有草稿时，可以继续处理本次已保存的文件。

检查工作区和已暂存的差异，保留用户已暂存的其他工作。模板中的 `data/`、`src/`、`locales/`、`assets/` 和测试都是源码。`dist/`、`.arcadia/`、`release-output/` 和生成的 `.tgz` 是本地产物。检查客户端配置里的项目绝对路径和本机启动参数，避免把仅供本机使用的连接配置一并提交。

按用户要求用本机 Git 提交或推送。涉及 GitHub 时使用助手自己已授权的 `gh` 或 GitHub 连接，并核对目标仓库及分支。只要求提交时，给出本地提交号即可。要求推送时，再报告远端结果。用户要求分发内容包时，读取[发布内容包](../arcadia-content-release/SKILL.md)，或通过 `author_reference` 读取 `release` 主题。

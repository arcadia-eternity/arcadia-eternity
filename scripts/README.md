# 维护脚本

官方效果实现在 `packs/base/src/effects/`，Species、Skill 和 Mark 的编辑数据由 `packs/base/pack.json` 选取。内容结构与编辑方式见 [内容结构](../docs/v4/content-structure.md)。

| 脚本                           | 用途                                                          |
| ------------------------------ | ------------------------------------------------------------- |
| `content-structure.mjs`        | 检查内容引用、生成显式归属的分组计划并应用文件布局调整        |
| `content-structure.test.mjs`   | 验证批量整理的顺序保持、冲突检查和重复执行                    |
| `build-battle-environment.mjs` | 根据战斗核心构建产物生成身份信息                              |
| `build-base-environment.mjs`   | 根据基础内容包与核心构建产物生成原生内容身份                  |
| `verify-behavior-uses.mjs`     | 在 Node 和 Chrome 验证独立原生行为与模板恢复（`--templates`） |
| `verify-native-content.mjs`    | 检查原生内容目录及浏览器构建                                  |
| `verify-native-pack.mjs`       | 检查原生内容加载、完整对战与恢复                              |
| `verify-v1-hosts.mjs`          | 验证 Node 和 Chrome 中的执行与恢复                            |
| `run-v1-battle.ts`             | 运行战斗示例                                                  |

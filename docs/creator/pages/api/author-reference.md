**会话条件**　连接到创作 MCP 即可读取，支持只读会话。

用完整的 SDK 符号名调用 `author_reference`。例如，查询霜击监听的触发器：

```json
{ "symbol": "EffectTrigger.OnHit" }
```

| 参数     | 用法                                                                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `topic`  | 查 SDK 符号时可省略，或填 `sdk`。用 `tutorials` 找实作，用 `species`、`skills`、`marks`、`effects`、`team`、`environment` 查机制，用 `mcp` 查工具。 |
| `symbol` | 可选，区分大小写。省略时读取主题；填写后返回该符号所在的参考页。                                                                                    |

SDK 查询返回 `parent`、`fields`、`methods` 和 `example`（触发器），以及声明位置、签名和相关符号。以命中为例，先查 `EffectTrigger.OnHit`，再查 `UseSkillContext.actualTarget` 和 `Pet.addMark`，就能确认实际目标需要判空，并取得加印记的方法签名。[浏览命中事件](/sdk/triggers/OnHit)

只记得名字的一部分时传 `{"query":"addMark"}`。结果按符号名排序，最多返回 50 个；用 `nextOffset` 的值作为下一次请求的 `offset`，直到返回 `null`。用 `{"topic":"sdk"}` 从第一个符号开始浏览。

从 SDK 4.16.1 起，精确查询的 `structuredContent.result.url` 可直接打开文档，`path` 提供站内路径，`sdkVersion` 标明本机版本。查询 `{"symbol":"ops.bindAttribute"}` 可离线取得本机 SDK 的签名和 Markdown 参考，以及[该操作的在线参考页](/sdk/values/ops/bindAttribute)。查询 `{"topic":"tutorials","symbol":"frost-strike.trace"}` 时，助手可读取 `markdownUrl` 获取包含霜击模板代码的完整课程。

查询未知条目会返回 `REFERENCE_UNKNOWN`。先用同一主题列举条目，再用其中的名字重试。

## 根据任务选主题

| 问题                   | 主题          | 精确条目                            |
| ---------------------- | ------------- | ----------------------------------- |
| 给精灵加一个可学技能   | `species`     | `learnable_skills`                  |
| 给技能写一个治疗效果   | `effects`     | `HealContext`                       |
| 查项目里实际使用的技能 | `mcp`         | `content_query`                     |
| 查队伍人数限制         | `environment` | `rules.team.maxSize`                |
| 生成、安装并分发资料包 | `release`     | `local-install`、`release-workflow` |

## 霜击查询

- 课程目录：`{"topic":"tutorials","symbol":"frost-strike"}`
- 分课查询：在 `tutorials` 主题使用 `frost-strike.trace`、`frost-strike.change` 或 `frost-strike.verify`。
- 印记字段：`{"topic":"marks","symbol":"config.duration"}`
- 速度绑定：`{"topic":"effects","symbol":"ops.bindAttribute"}`
- 固定种子试战：`{"topic":"mcp","symbol":"battle_create"}`

已有的 `arcadia://authoring/effects` 等主题资源仍可读取。网站与本机 SDK 可以处在不同发布版本。如果当前主题未列出网页上的新条目，助手可以读取[网页的 Markdown 版本](https://battle-docs.yuuinih.com/llms.txt)，并以本机会话返回的工具和字段核对实现。旧版工具若只列出 `topic` 参数，可先读 `effects` 和 `marks` 主题，结合本机模板完成[霜击教程](../frost-strike.md)。

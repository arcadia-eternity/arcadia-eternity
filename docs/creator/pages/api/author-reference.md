**会话条件**　连接到创作 MCP 即可读取，支持只读会话。

先读主题目录，再用返回的 `symbols` 精确定位条目。在 AI 客户端里调用工具 `author_reference`，传入以下参数：

```json
{ "topic": "effects", "symbol": "EffectTrigger.OnHit" }
```

| 参数     | 用法                                                              |
| -------- | ----------------------------------------------------------------- |
| `topic`  | 必填。霜击涉及 `tutorials`、`skills`、`effects`、`marks`、`mcp`。 |
| `symbol` | 可选，区分大小写。省略时读取主题；填写后返回该符号所在的参考页。  |

精确查询的 `structuredContent.result` 含有 `topic`、`symbol`、`title`、`path`、`sdkVersion` 和 `markdown`。`path` 是文档站内路径，正文和示例取自本机 SDK。查询未知条目会返回 `REFERENCE_UNKNOWN`。先用同一主题列举条目，再用其中的名字重试。

## 霜击查询

- 教程全文：`{"topic":"tutorials","symbol":"frost-strike"}`
- 印记字段：`{"topic":"marks","symbol":"config.duration"}`
- 速度绑定：`{"topic":"effects","symbol":"ops.bindAttribute"}`
- 固定种子试战：`{"topic":"mcp","symbol":"battle_create"}`

已有的 `arcadia://authoring/effects` 等主题资源仍可读取。旧版工具若只列出 `topic` 参数，可先读 `effects` 和 `marks` 主题，结合本机模板完成[霜击教程](../frost-strike.md)。

连接后先读 `workspace_describe`：核对项目、SDK 与能力。通过桌面连接时再用 `workspace_context` 查看当前对象、草稿和外部冲突。工具暴露的操作取决于当前会话。

## 按名称找到可编辑记录

向 `content_query` 传：

```json
{ "scope": "project", "contentKind": "skills", "search": "霜击", "detail": "full" }
```

返回记录的 `file`、`index`、`version` 和完整 `record` 用于保存。`scope: "dependencies"` 适合阅读已安装依赖中的做法。需要更多结果时用返回的 `nextOffset` 翻页。

## 选择保存方式

| 编辑对象             | 怎么写                                                                                                           | 如何确认成功                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 已有精灵、技能、印记 | `content_apply` 的 `changes` 中传 `kind: "record"`、原文件、索引、原版本与完整的新记录。                         | 检查 `complete` 和逐文件 `results`，重读对象。 |
| 新对象或语言条目     | 新文件用 `kind: "create-record"` 和 `expectedVersion: null`；语言项用 `kind: "locale"` 并提供对象 ID。           | 核对创建的稳定 ID、语言和来源文件。            |
| 源文件全文           | `source_read` 取得 `file`、`version`、`text` 后，用 `source_apply` 传 `file`、`expectedVersion` 和修改后的全文。 | 比较磁盘版本和差异，再运行检查或测试。         |

同一批修改可能涉及多个文件。部分成功时，读取每个文件的结果，只补写仍待保存的改动。版本冲突后重新读取原文件，和作者的表单草稿核对。[处理草稿、过期试玩和引用错误](../test/troubleshooting.md)

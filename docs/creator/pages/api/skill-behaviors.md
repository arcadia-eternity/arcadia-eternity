**适用位置**　内容包源文件 `data/skills/*.yaml`。

`behaviors[]` 为一项技能绑定效果。每次使用通过局部 `useId` 标识，`definitionId.$ref` 的 `projectId`、`kind: behavior` 和 `id` 指向效果定义。复制到其他资料包时，使用目标项目的实际标识。

## 霜击的技能定义

<<< data/skills/strike.yaml

`apply-slow` 指向[命中效果](./on-hit.md)。技能决定何时给目标加印记，[持续时间](./mark-duration.md)由印记定义提供。

用 MCP 查询 `skills` 主题时，返回的 schema 标有 `linked-runtime`，描述包引用解析后的结构。编写源 YAML 时使用上面的引用格式。

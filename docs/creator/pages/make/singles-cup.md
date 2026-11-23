做一个最多携带一只精灵的赛制。完成后应拿到两种结果：单精灵队可以开局，双精灵队在入场检查时得到具体诊断。

## 创建环境

在新的空目录旁运行：

```sh
arcadia-content init environment singles-cup
arcadia-content workspace singles-cup check
```

独立环境项目的 `package.json` 中，`dependencies` 选择资料包，`arcadiaEnvironment` 保存赛制。模板带有基础包依赖和两支各含一只精灵的测试队。首次准备时，缺少的依赖可能需要联网。

## 修改人数上限

打开 `singles-cup/package.json`，将 `arcadiaEnvironment.rules` 改成下面这个对象，保留清单里的环境 ID、依赖和其他字段。已有赛制还应保留原规则里的其他项。

```json
{ "schemaVersion": 1, "team": { "maxSize": 1 } }
```

使用助手时，可让它读取 `environment_list`，在当前文档的 `rules.team` 中设置 `maxSize`，并用返回的版本调用 `environment_save`。想追踪某次失败，用同一个种子重跑：

```sh
arcadia-content workspace singles-cup check
arcadia-content workspace singles-cup demo --execute --seed cup-baseline
```

## 验证一支合法队和一支超员队

连接这个环境的创作 MCP，启用执行权限，用 `preview_start` 准备保存后的规则。拿到就绪任务的 `jobId` 后，先对 `blue` 调用 `team_validate`，预期 `valid: true`。

从 `team_list` 读取蓝队，新建 `over-limit` 项目队伍，放入蓝队和橙队各一只原本合法的精灵，保存时使用新队伍 ID。用同一个试玩 `jobId` 校验 `over-limit`。预期 `valid: false`，诊断码为 `ENVIRONMENT_TEAM_REJECTED`。保留原来的蓝、橙队，用它们和固定种子调用 `battle_create` 开局。

请助手执行时可以说：**给我合规队和超员队各一份校验结果，列出环境版本与实际诊断，然后用两支合规队开局。** 参见[环境规则与队伍校验](../api/environment.md)。

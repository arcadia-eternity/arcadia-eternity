**会话条件**　保存可编辑的资料包，在工作台「AI 助手」勾选允许运行测试与试玩，并使用更新后的连接配置。

## 运行场景测试

调用 `test_start`，参数为 `{}`。取返回的 `jobId` 传给 `job_get`，可加 `waitMs: 10000` 等待进度变化。以 `state: "succeeded"` 且 `stale: false` 确认当前源码已通过。测试失败时，按该任务 ID 用 `job_output` 读取断言和日志；若结果过期，重新测试已保存的源码。

## 用固定种子打霜击

调用 `preview_start`，参数为 `{}`。用 `job_get` 等到试玩宿主就绪，取**这个试玩任务**的 ID，替换下面的占位值后调用 `battle_create`：

```json
{ "jobId": "<试玩任务 ID>", "teamIds": ["blue", "orange"], "seed": "frost-refresh" }
```

1. 用试玩的 `jobId` 和新对局的 `sessionId` 调用 `battle_read`，取出当前 `revision` 和合法的 `selections`。
2. 调用 `battle_action`，传入同一组 ID、刚读到的 `expectedRevision` 和所选的 `selection`。每次出招前重新读取对局；版本冲突时先核对新状态。
3. 用 `battle_events` 按游标读取事件，用 `battle_read` 比较蓝队出招前后的对局状态。按[教程](../frost-strike.md)验证减速，精确到命中回调瞬间的数值由场景测试断言。
4. 用 `battle_close` 传入两个 ID 和最新的 `expectedRevision` 释放自动对局。自动对局和作者手动打开的试玩各自进行。

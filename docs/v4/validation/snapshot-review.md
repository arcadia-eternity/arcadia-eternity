# Snapshot 两轴审查

2026-10-17；比较基线 `0d66dbe6e6ccfa0c0b950d4416014e30ad3078a4`，实现提交 `e110e897` 及其后续修复。两个只读审查分别检查 Standards 与 Spec。规范来自原任务、#204 和 `v1-snapshots.md` 的本轮明确边界。

## Standards

没有硬性文档标准违规。发现 1 项 P2：快照边界使用 `constructor.name` 判定 SelectionPhase，Attribute 将类名写入协议，Browser 压缩后失败。审查独立复现：压缩 host-smoke 后运行报“Snapshot requires a settled selection input boundary”。

修复：边界改用原类身份，Attribute 使用固定协议键。新增类名重命名测试、压缩 Browser/未压缩 Node 双向 JSON 互通和真实 Chrome 恢复 Node 快照。只读复查结论：原 P2 已修复，无新增阻塞项。

## Spec

发现 1 项 P2：保存没有检查动态值工厂，使用相同 revision、缺工厂的另一个目录仍可导出无法恢复的快照，违反“不支持状态在发布前拒绝”。审查通过公开 API 独立复现，保存1196节点成功但恢复失败。

修复：导出前验证 recipe 类型、依赖、操作和所需工厂；恢复建立注册前再次检查，同时校验 cleanup 描述。新增缺工厂、非法 project/combine 回归；补齐篡改 payload 中 timer/phase-bound 状态的恢复拒绝。只读复查结论：原 P2 已修复，无新增阻断项；其提及的拒绝路径补测现已通过。

两轴合计：Standards 1项 P2、Spec 1项 P2，均修复并复查通过。它们不意味着 #204 的所有阶段/时钟/重放需求已验收。

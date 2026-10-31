# 内容包源项目

在 Arcadia 创作页编辑精灵、技能、印记和素材；代码、语言文件和测试通过外部编辑器维护。桌面创建时连接随应用提供的开发 SDK，不下载依赖。移到其他电脑后，通过 Arcadia 打开并连接该机器的 SDK，或使用独立 SDK 安装流程。

此模板基于 arcadia-eternity/content-pack-template 的 MIT 示例；保留 LICENSE。

## 分离的表现与资源（v2）

表现关联位于 `data/presentations/main.yaml`，资源定义位于 `data/resources/main.yaml`。规则只描述游戏内容，表现通过对象 ID 关联，图片与声音使用稳定资源 ID。移动素材时只更新资源定义的 `source`。见 [表现说明](docs/presentation.md)。

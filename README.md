# Arcadia Eternity

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/arcadia-eternity/arcadia-eternity)

欢迎来到 **阿卡迪亚:永恒之门**

该项目是一个对约瑟传说（赛尔号2）的战斗模拟系统。包括一个可以联机对战的网页，一个队伍编辑器，一个游戏数据编辑器。

目前提供单精灵模式的支持。

## 如何游玩

1. 访问 [Arcadia Eternity](https://battle.yuuinih.com)
2. 编辑你的队伍
3. 进入匹配大厅，等待其他玩家
4. 与对手对战

## 社区

QQ群：805146068

## 主要功能

### 战斗系统

- **完整战斗机制** - 精确还原约瑟传说战斗规则
- **技能效果** - 完整实现各类技能、效果和印记系统
- **战报记录** - 详细的战斗过程记录和回放功能

### 联机对战

- **实时对战** - 支持玩家之间的实时对战
- **战斗排行榜** - 记录玩家战绩和排名

### 编辑器

- **队伍编辑器** - 可视化编辑和保存队伍配置
- **数据编辑器** - 通过可视化的节点编辑器（基于LiteGraph.js）编辑游戏内精灵、技能和效果数据(暂时未开放)
- **脚本系统** - 通过TypeScript/JavaScript脚本定义游戏内容
- **导入导出** - 支持YAML格式的队伍配置导入导出

### 界面功能

- **精灵动画** - 对原作动画进行精细的复原
- **技能特效** - 视觉化的技能释放特效
- **多语言支持** - 支持中文和英文界面
- **响应式设计** - 适配不同设备屏幕尺寸

## 技术实现

- **前端**: Vue 3 + TypeScript + Element Plus
- **后端**: Node.js + Express + Socket.IO
- **数据存储**: Supabase (PostgreSQL)
- **部署**: Docker + Fly.io 自动部署

## 关联库

- [seer2-pet-animator](https://github.com/arcadia-star/seer2-pet-animator) 用于复用原作游戏资源的动画容器
- [seer2-resource](https://github.com/arcadia-eternity/seer2-resource) 原作经过整理后在本项目中使用的游戏资源

## 快速开始

### 开启测试战斗

```sh
pnpm run cli -1 testteam.yaml -2 testteam.yaml
```

### 启动服务器

```sh
# 启动后端服务器
pnpm run cli server --port 8102

# 启动前端开发服务器
pnpm web:dev
```

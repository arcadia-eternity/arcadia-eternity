# 脚本式声明系统

## 概述

脚本式声明系统允许通过TypeScript和JavaScript脚本定义游戏内容（效果、技能、标记、种族等），支持装饰器模式和函数式API两种声明方式。

## 特性

- ✅ 支持TypeScript和JavaScript脚本
- ✅ 装饰器模式声明
- ✅ 函数式API声明
- ✅ 服务器端和Web端加载
- ✅ 递归目录扫描
- ✅ 动态导入
- ✅ 类型安全

## 使用方法

### 装饰器模式（TypeScript）

```typescript
// scripts/effects/my-effect.ts
import { Effect } from '@arcadia-eternity/battle'
import { EffectTrigger } from '@arcadia-eternity/const'
import { RegisterEffect } from '@arcadia-eternity/data-repository'

@RegisterEffect()
export class MyEffect extends Effect<EffectTrigger.OnDamage> {
  constructor() {
    super(
      'my_effect',
      EffectTrigger.OnDamage,
      (context) => {
        // 效果逻辑
        console.log('我的效果被触发:', context)
      },
      0, // priority
      undefined, // condition
      undefined, // consumesStacks
      ['custom'] // tags
    )
  }
}
```

### 函数式API（JavaScript）

```javascript
// scripts/effects/my-effect.js
import { Effect } from '@arcadia-eternity/battle'
import { EffectTrigger } from '@arcadia-eternity/const'
import { declareEffect } from '@arcadia-eternity/data-repository'

const myEffect = new Effect(
  'my_functional_effect',
  EffectTrigger.OnDamage,
  (context) => {
    console.log('函数式效果被触发:', context)
  },
  0,
  undefined,
  undefined,
  ['functional', 'custom']
)

declareEffect(myEffect)
```

## 目录结构

```
scripts/
├── effects/          # 效果脚本
├── skills/           # 技能脚本
├── marks/            # 标记脚本
├── species/          # 种族脚本
└── README.md         # 本文档
```

## 加载方式

### 服务器端（Node.js）

```javascript
import { ScriptLoader } from '@arcadia-eternity/data-repository'

const loader = new ScriptLoader({ scriptPaths: ['./scripts'], recursive: true })
await loader.loadScriptsFromFileSystem('./scripts')
```

### Web端（浏览器）

```javascript
import { ScriptLoader } from '@arcadia-eternity/data-repository'

const loader = new ScriptLoader({
  baseUrl: '/scripts',
  scriptPaths: ['effects/my-effect.js']
})
await loader.loadScriptsFromHttp('/scripts', ['effects/my-effect.js'])
```

## 注意事项

1. TypeScript文件需要先编译为JavaScript才能在运行时加载
2. 装饰器需要在tsconfig.json中启用experimentalDecorators
3. 脚本加载是异步的，需要在游戏数据加载后进行
4. 脚本中的声明会自动注册到DataRepository中

## 示例

查看 `scripts/` 目录下的示例文件：
- `effects/example-effect.ts` - 装饰器模式示例
- `effects/example-effect-functional.js` - 函数式API示例
- `skills/example-skill.ts` - 技能声明示例
- `species/example-species.ts` - 种族声明示例

# Effect 装饰器与 SDK 装载

本次设计采用标准 TypeScript 装饰器。内容包提供效果定义，SDK 负责发现、编译、注册、依赖排序、参数收集和错误诊断。

## 作者接口

普通内容包使用 `@arcadia-eternity/content-sdk`，在 `src/effects` 中创建 `*.effect.ts`，无需编辑入口或注册表：

```ts
import { effect, on, EffectTrigger, type NativeEffectContext } from '@arcadia-eternity/content-sdk'

@effect({ id: 'example', sourceKind: 'skill' })
export class Example {
  @on(EffectTrigger.OnHit)
  static apply(context: NativeEffectContext<EffectTrigger.OnHit>) {
    if (context.source !== context.parent.skill) return
    // 使用原生战斗上下文实现机制。
  }
}
```

一个类可为不同触发器声明多个静态方法，同一触发器重复声明报错。静态方法避免建立隐式的作者类实例；战斗可变状态仍必须进入引擎管理的实体和快照，不能存进类静态字段或模块全局变量。

`@on` 方法的可选第二个参数是当前内容上下文，提供本场 canonical marks 与 namespace ID 解析。需参数绑定等完整编写能力时，`@effect` 类可以提供 `static create(context)`，返回现有 `defineCodeEffect` 结果。SDK 校验其 ID 和 sourceKind 与装饰器一致。这两条路径都通过 BehaviorUse 实例化，保留 useId 和每次使用独立的参数、运行身份。

模板中的 `slow.effect.ts` 展示这两种形式。单纯定义一个类不会把效果自动挂到全部技能：内容数据仍需声明对应的行为使用。

## 目录与构建

普通包声明：

```json
{
  "arcadia": {
    "effectSources": "src/effects",
    "effectArtifact": "dist/arcadia-effects.json",
    "sdkApi": 2
  }
}
```

该片段省略其余必填内容字段。`effectSources` 与旧的手写 `effects` 入口互斥。`arcadia-content build` 自动编译目录并写入不可变 artifact；发布包只需带上产物，环境准备不会执行作者源码。

底层工具：

- `@arcadia-eternity/content-sdk/build` 提供 `buildEffects(root)` 与 `effectDiscoveryPlugin`。
- SDK 内部由 pack-loader 实现静态文件发现和闭合编译。
- `@arcadia-eternity/battle/effect-loading` 提供纯作者侧装饰器和装载逻辑；随效果产物进入获准的隔离运行时，不在宿主中维护全局作者注册表。

文件名只决定发现和诊断位置。效果 ID 必须显式声明，重命名文件不改变身份。扫描只接受 `*.effect.ts`，普通 helper 通过 import 引用；按相对路径稳定排序，跟踪目录与文件，拒绝符号链接和目录逃逸。

## Rolldown 的装饰器支持

继续使用 Rolldown。当前版本可以打包标准装饰器语法，但不内置标准装饰器 lowering；SDK 的 Rolldown 插件使用 TypeScript `transpileModule` 转换为 ES2022，再由 Rolldown 打包。插件拒绝语法诊断，避免编译器的错误恢复把无效源码变成可发布产物。无需 `experimentalDecorators`、`reflect-metadata` 或作者自定义构建插件。

这一步只解析和转换文本，不求值作者模块。装饰器函数本身只在获准的运行时执行。

参考：[Rolldown transform](https://rolldown.rs/reference/InputOptions.transform)。

## 固定效果与基础包迁移

基础包有大量固定 ID 的效果，以及批量生成的效果族。它们通过同一个发现插件，以 `@effectGroup` 声明装载单元：

```ts
import { effectGroup, type EffectLoadingContext } from '@arcadia-eternity/battle/effect-loading'

@effectGroup({ id: 'weather-shield', dependsOn: ['shield'] })
export class WeatherShieldEffects {
  static build(context: EffectLoadingContext) {
    // 返回一个已编译效果或以稳定 ID 为键的效果表。
    // canonical marks、effects 和 parameters 由 SDK 提供。
  }
}
```

SDK 收集全部导出的装饰类，按显式依赖解析并建立效果目录；缺失依赖、初始化环、重复效果都包含文件与效果组来源。不再依赖中央文件中 add 调用的顺序。普通 mark/effect 内容循环仍由已有「先创建 canonical marks，再装配效果」流程处理，不属于效果组初始化环。

基础包的效果文件已经迁移到 `*.effect.ts`，删除 `candidate-catalog.ts`。`effects.ts` 只导出 SDK 生成的装载入口和内容元数据。旧的工厂函数及逐项手写导出表已经删除；机制实现直接放进装饰类的静态 `build` 方法。调用点和测试直接使用新类，不保留兼容别名。

固定效果组属于支持固定 catalog 的宿主接口；普通 npm 内容包继续使用 BehaviorUse，其 SDK 主入口只公开 `@effect` 与 `@on`。错误使用固定效果组会明确报错，不会静默丢弃。这里保留当前固定效果和行为使用的两种运行身份，没有把它们混为一种实例。

## 执行与兼容语义

```text
构建/准备：发现文件 → 转换装饰器 → Rolldown 闭合编译 → artifact
开始战斗：宿主准入 → 隔离运行时 → 装饰器元数据 → SDK 链接 → 内容目录
```

- SDK 的装饰器元数据是当前模块实例中的 WeakMap，不会注册到全局宿主。
- 每次装载创建新的 effects、parameters 和 families Map；每场战斗仍由现有 Worker/Arena 生命周期管理。
- 原生参数目录由 SDK 自动收集。历史显式参数目录保留覆盖/回退语义，不能改变参数地址和别名。
- effect 列表和 BehaviorUse 顺序继续控制同优先级执行顺序，文件发现顺序不替代战斗顺序。
- base 历史 ID 不重命名；普通包通过现有 namespace 解析。
- 模块产物继续导出既有 createCatalog/createEffects 合同，这些函数由 SDK 插件生成；增加作者语法不改变 SDK API 2 的消费合同。
- 浏览与内容准备仍读取静态元数据，不靠运行装饰器生成目录。任意动态 TS 不能静态提取完整描述；现有作者构建产物与宿主准入机制继续负责这部分。

## 参考与取舍

[Pokémon Showdown](https://github.com/smogon/pokemon-showdown/blob/master/data/moves.ts) 将数据与原生事件回调放在内容条目中，由 [Dex](https://github.com/smogon/pokemon-showdown/blob/master/sim/dex.ts) 统一装载。这里沿用「作者声明机制、加载器负责索引」，保留本项目的阶段和参数体系。

[tModLoader](https://github.com/tModLoader/tModLoader/wiki/Mod-Loading-Steps) 将自动发现、注册和后续装配分阶段。这里采用显式类型化装饰元数据与依赖链接，不照搬全局注册副作用或运行宿主代码的机制。

## 验收重点

1. 新增、删除效果文件无需修改中央注册表；实际 Arena 能装载转换后的装饰器产物。
2. 重复 ID、缺失依赖、初始化环、非法语法和路径逃逸均被拒绝并定位。
3. 准备含顶层副作用的源码只生成文本；只有进入获准隔离运行时才会求值。
4. 保留 base 效果身份、参数目录、BehaviorUse 隔离、印记绑定及快照恢复行为。
5. 基础包与 UGC 的运行导出统一由 SDK 收集。

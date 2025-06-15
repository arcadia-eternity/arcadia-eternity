# BattlePage 加载进度测试

## 实现的功能

1. **加载状态管理**
   - 添加了 `LoadingProgress` 接口来跟踪各种资源的加载状态
   - 包括：resourceStore、gameDataStore、backgroundImage、petSprites、battleData

2. **加载进度显示**
   - 显示总体加载进度百分比
   - 显示当前加载状态文本
   - 美观的加载动画（双圈旋转 + 中心图标）

3. **资源加载检查**
   - `checkResourceStoreLoaded()`: 检查游戏资源加载
   - `checkGameDataStoreLoaded()`: 检查游戏数据加载
   - `checkBackgroundImageLoaded()`: 检查背景图片加载
   - `checkPetSpritesLoaded()`: 检查精灵资源和组件加载
   - `checkBattleDataLoaded()`: 检查战斗数据加载

4. **PetSprite 组件等待**
   - 在正常模式下等待两个 PetSprite 组件的 ready 状态
   - 在回放模式下使用现有的 `checkPetSpritesReady()` 函数
   - 增加了重试机制，最多重试50次，每次间隔100ms

5. **界面隐藏/显示**
   - 加载完成前显示加载遮罩
   - 战斗界面在加载完成前透明度为0
   - 加载完成后平滑过渡显示战斗界面

## 修复的问题

1. **watch 函数中的 unwatch 引用错误**
   - 修复了在定义前使用 `unwatch` 的问题
   - 使用 `let unwatch: (() => void) | undefined` 来正确声明

2. **加载顺序优化**
   - 并行加载基础资源（resourceStore 和 gameDataStore）
   - 按依赖关系顺序加载其他资源
   - 在加载阶段等待 PetSprite 组件准备完成

3. **错误处理**
   - 所有加载函数都有 try-catch 错误处理
   - 即使某个资源加载失败也会继续，避免卡在加载界面

## 测试步骤

1. 打开 battlePage
2. 应该看到加载遮罩，显示加载进度
3. 观察加载状态文本的变化：
   - "初始化中..."
   - "加载游戏资源..."
   - "加载游戏数据..."
   - "加载背景图片..."
   - "加载精灵资源..."
   - "等待精灵组件初始化..."
   - "初始化战斗数据..."
   - "加载完成！"
4. 加载完成后，遮罩消失，战斗界面平滑显示
5. 战斗应该正常开始

## Z-Index 层级

- 加载遮罩：z-[1500]
- 确保加载遮罩在大部分UI之上，但低于确认对话框

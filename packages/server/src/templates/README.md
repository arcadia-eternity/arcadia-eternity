# 邮件模板系统

这个目录包含了邮件服务使用的外部模板文件。

## 模板文件

### 验证码邮件模板

- `verification-code.hbs` - HTML版本的验证码邮件模板（使用Handlebars语法）
- `verification-code.txt` - 纯文本版本的验证码邮件模板

## 模板变量

验证码邮件模板支持以下变量：

- `{{code}}` - 验证码
- `{{purposeText}}` - 操作目的（如"绑定邮箱"或"恢复玩家ID"）
- `{{playerName}}` - 玩家名称（可选）
- `{{subject}}` - 邮件主题

## 设计特点

### HTML模板特点

1. **现代设计**
   - 渐变背景和卡片式布局
   - 响应式设计，支持移动设备
   - 优雅的动画效果（验证码闪光效果）

2. **视觉层次**
   - 清晰的标题和副标题
   - 突出显示的验证码
   - 醒目的警告提示框

3. **用户体验**
   - 易于阅读的字体和颜色
   - 合理的间距和布局
   - 清晰的信息层次

4. **兼容性**
   - 支持主流邮件客户端
   - 移动端友好的响应式设计
   - 优雅降级处理

## 使用方法

### 在代码中使用

```typescript
import { renderVerificationHtml, renderVerificationText } from './utils/templateLoader'

const templateData = {
  code: '123456',
  purposeText: '绑定邮箱',
  playerName: '玩家名称',
  subject: '绑定邮箱验证码 - 阿卡迪亚永恒'
}

const html = renderVerificationHtml(templateData)
const text = renderVerificationText(templateData)
```

### 预览模板

运行以下命令生成模板预览：

```bash
npx tsx packages/server/src/test-email-template.ts
```

这将在项目根目录的 `email-preview` 文件夹中生成HTML和文本预览文件。

## 模板开发

### 修改模板

1. 直接编辑 `.hbs` 和 `.txt` 文件
2. 使用Handlebars语法添加动态内容
3. 运行预览命令查看效果

### 添加新模板

1. 在此目录创建新的模板文件
2. 在 `templateLoader.ts` 中添加对应的渲染函数
3. 在邮件服务中调用新的渲染函数

### 样式指南

- 使用内联CSS确保邮件客户端兼容性
- 保持简洁的HTML结构
- 使用web安全字体
- 测试主流邮件客户端的显示效果

## 故障排除

### 模板加载失败

如果模板文件不存在或加载失败，系统会自动使用内置的后备模板，确保邮件功能正常运行。

### 样式问题

某些邮件客户端可能不支持所有CSS特性。模板已经过优化，但如果遇到显示问题，可以：

1. 检查邮件客户端的CSS支持情况
2. 使用更简单的CSS属性
3. 增加后备样式

## 最佳实践

1. **保持简洁** - 避免过于复杂的布局和样式
2. **测试兼容性** - 在多个邮件客户端中测试显示效果
3. **优化性能** - 避免大图片和复杂动画
4. **可访问性** - 确保文本对比度足够，支持屏幕阅读器

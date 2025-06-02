# Telegram Bot 使用示例

本文档提供了 Alice AI 核心系统 Telegram Bot 功能的具体使用示例。

## 📋 前置准备

### 1. 环境配置

确保你的 `.env` 文件包含以下配置：

```env
# 必需配置
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_OWNER_ID=123456789

# 可选配置
TELEGRAM_OWNER_GREETING=主人
TELEGRAM_PROCESSING_THRESHOLD=0.45
TELEGRAM_ALWAYS_REPLY_TO_OWNER=true

# 其他必需的 API 配置
DEEPSEEK_API_KEY=your_deepseek_api_key
SILICONFLOW_API_KEY=your_siliconflow_api_key
QDRANT_URL=http://localhost:6333
```

### 2. 依赖检查

运行测试脚本确认配置正确：

```bash
deno run --allow-all test_telegram.ts
```

## 🚀 启动方式

### 方式一：仅启动 Telegram Bot

```bash
deno run --allow-all src/main.ts --telegram
```

### 方式二：同时启动 Discord 和 Telegram Bot

```bash
deno run --allow-all src/main.ts --discord --telegram
```

### 方式三：CLI 模式（默认）

```bash
deno run --allow-all src/main.ts
```

## 💬 使用场景示例

### 私聊对话

**用户**：你好，Alice！

**Alice**：你好！我是 Alice，你的 AI 助手。有什么我可以帮助你的吗？

---

**用户**：帮我总结一下今天的重要任务

**Alice**：好的，让我为你整理今天的重要任务。根据我们之前的对话记录...

### 群组智能响应

在群组中，Alice 会根据消息的重要性智能决定是否回复：

**高分消息（会回复）**：
- 直接提及 Alice 或相关关键词
- 包含问题或任务请求
- 主人发送的消息（如果启用强制回复）
- 包含重要关键词的消息

**低分消息（不会回复）**：
- 普通闲聊
- 表情包或简单回应
- 与 AI 助手无关的讨论

### 消息类型处理

#### 1. 任务类消息
**用户**：请帮我记录一个待办事项：明天下午3点开会

**Alice**：好的，我已经记录了你的待办事项：明天下午3点开会。我会在适当的时候提醒你。

#### 2. 问题类消息
**用户**：Python 中如何处理异常？

**Alice**：在 Python 中处理异常主要使用 try-except 语句...

#### 3. 情感支持
**用户**：今天工作压力好大，感觉很累

**Alice**：我理解你的感受，工作压力确实会让人感到疲惫。要不要和我聊聊具体是什么让你感到压力？

## ⚙️ 高级配置示例

### 自定义处理阈值

```env
# 降低阈值，让 Bot 更容易回复群组消息
TELEGRAM_PROCESSING_THRESHOLD=0.3

# 提高阈值，让 Bot 只回复最重要的消息
TELEGRAM_PROCESSING_THRESHOLD=0.7
```

### 自定义机器人名称

```env
# Bot 会响应这些名称的提及
BOT_NAMES=爱丽丝,Alice,小爱,AI助手
```

### 自定义重要关键词

```env
# 包含这些关键词的消息会获得更高分数
IMPORTANT_KEYWORDS=紧急,重要,帮助,问题,任务,提醒,bug,错误
```

## 🔧 故障排除示例

### 问题：Bot 不回复消息

**检查步骤**：

1. 确认 Bot Token 正确
2. 检查消息评分是否达到阈值
3. 查看控制台日志

**解决方案**：

```bash
# 降低处理阈值
TELEGRAM_PROCESSING_THRESHOLD=0.2

# 或者启用主人强制回复
TELEGRAM_ALWAYS_REPLY_TO_OWNER=true
```

### 问题：Bot 回复太频繁

**解决方案**：

```bash
# 提高处理阈值
TELEGRAM_PROCESSING_THRESHOLD=0.8

# 关闭主人强制回复
TELEGRAM_ALWAYS_REPLY_TO_OWNER=false
```

## 📊 消息评分示例

以下是一些消息及其可能的评分：

| 消息内容 | 预估分数 | 是否回复 | 原因 |
|---------|---------|---------|------|
| "Alice，帮我查询天气" | 0.9 | ✅ | 直接提及 + 任务请求 |
| "有个 bug 需要修复" | 0.7 | ✅ | 重要关键词 + 任务类型 |
| "今天心情不错" | 0.2 | ❌ | 普通闲聊 |
| "？？？" | 0.4 | 取决于阈值 | 问号表示疑问 |
| 主人："随便说点什么" | 1.0 | ✅ | 主人消息（如果启用强制回复） |

## 🎯 最佳实践

### 1. 群组使用建议

- 设置合适的处理阈值（建议 0.4-0.6）
- 启用主人强制回复功能
- 定期查看日志调整配置

### 2. 私聊使用建议

- 私聊消息总是被处理，无需特殊配置
- 可以进行深度对话和个性化服务
- 支持上下文记忆和情感理解

### 3. 安全建议

- 妥善保管 Bot Token
- 不要在公开场所分享配置信息
- 定期检查 Bot 权限设置

---

更多详细信息请参考 [TELEGRAM_SETUP.md](../TELEGRAM_SETUP.md) 文档。

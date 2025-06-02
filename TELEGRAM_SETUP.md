# Telegram Bot 集成指南

本文档介绍如何为 Alice AI 核心系统配置和使用 Telegram Bot 功能。

## 🚀 快速开始

### 1. 创建 Telegram Bot

1. 在 Telegram 中搜索并打开 [@BotFather](https://t.me/botfather)
2. 发送 `/newbot` 命令
3. 按照提示设置机器人名称（显示名）
4. 设置机器人用户名（必须以 `bot` 结尾）
5. 复制获得的 Bot Token

### 2. 获取用户 ID

1. 在 Telegram 中搜索并打开 [@userinfobot](https://t.me/userinfobot)
2. 发送任意消息
3. 复制返回的用户 ID

### 3. 配置环境变量

在 `.env` 文件中添加以下配置：

```env
# Telegram Bot 配置
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_OWNER_ID=your_user_id_here
TELEGRAM_OWNER_GREETING=主人
TELEGRAM_PROCESSING_THRESHOLD=0.45
TELEGRAM_ALWAYS_REPLY_TO_OWNER=true
```

### 4. 测试配置

运行测试脚本验证配置：

```bash
deno run --allow-all test_telegram.ts
```

### 5. 启动 Bot

```bash
# 仅启动 Telegram Bot
deno run --allow-all src/main.ts --telegram

# 同时启动 Discord 和 Telegram Bot
deno run --allow-all src/main.ts --discord --telegram
```

## ⚙️ 配置选项

| 环境变量 | 必需 | 默认值 | 说明 |
|---------|------|--------|------|
| `TELEGRAM_BOT_TOKEN` | ✅ | - | 从 @BotFather 获取的 Bot Token |
| `TELEGRAM_OWNER_ID` | ⚠️ | - | 主人的 Telegram 用户 ID |
| `TELEGRAM_OWNER_GREETING` | ❌ | "主人" | 对主人的称呼 |
| `TELEGRAM_PROCESSING_THRESHOLD` | ❌ | 0.6 | 群组消息处理阈值 (0.0-1.0) |
| `TELEGRAM_ALWAYS_REPLY_TO_OWNER` | ❌ | true | 是否总是回复主人消息 |

## 🔧 功能特性

### 消息处理

- **私聊消息**：自动处理所有私聊消息
- **群组消息**：基于 LLM 分析和评分系统智能处理
- **主人特权**：主人的消息总是被处理（如果启用）

### 智能评分系统

系统使用以下因素评估消息重要性：

1. **LLM 分析结果**
   - 消息类型（任务、问题、事实等）
   - 重要性评分（1-5）
   - 情感唤醒度

2. **上下文因素**
   - 是否提及机器人或主人
   - 是否为回复消息
   - 消息长度
   - 特殊内容（代码、链接等）

### 消息分割

- 自动分割超长消息（4000字符限制）
- 保持消息完整性和可读性

## 🎯 使用场景

### 私聊模式
- 个人助手功能
- 私密对话和咨询
- 个性化服务

### 群组模式
- 智能群助手
- 按需响应重要消息
- 避免刷屏干扰

## 🔍 故障排除

### 常见问题

1. **Bot 无法启动**
   - 检查 `TELEGRAM_BOT_TOKEN` 是否正确
   - 确认网络连接正常
   - 运行测试脚本诊断问题

2. **Bot 不回复消息**
   - 检查消息评分是否达到阈值
   - 确认 LLM API 配置正确
   - 查看控制台日志

3. **权限问题**
   - 确保 Bot 有发送消息权限
   - 检查群组中的 Bot 权限设置

### 调试模式

启用详细日志查看消息处理过程：

```bash
# 查看消息评分详情
# 日志中会显示 [调试][Telegram权重] 相关信息
```

## 🔗 集成架构

Telegram Bot 与现有系统的集成点：

- **核心处理**：复用 `handleIncomingMessage` 函数
- **消息分析**：使用 `analyzeMessageForMemory` 进行 LLM 分析
- **上下文管理**：独立的聊天上下文映射
- **配置系统**：统一的配置管理

## 📝 开发说明

### 添加新功能

1. 修改 `src/telegram_interface.ts`
2. 更新配置选项（如需要）
3. 添加相应的测试用例
4. 更新文档

### 代码结构

```
src/telegram_interface.ts
├── initializeTelegramBot()     # 初始化函数
├── calculateMessageImportanceScore() # 消息评分
├── startTelegram()             # 启动函数
└── fetchTelegramHistory()      # 历史记录（受限）
```

## ⚠️ 注意事项

1. **API 限制**：Telegram Bot API 不支持获取历史消息
2. **速率限制**：注意 Telegram API 的速率限制
3. **隐私保护**：妥善保管 Bot Token 和用户 ID
4. **群组权限**：确保 Bot 在群组中有适当权限

## 🆕 版本历史

- **v1.0.0**：基础 Telegram Bot 集成
  - 消息接收和处理
  - 智能评分系统
  - 配置管理
  - 错误处理

---

如有问题或建议，请查看项目文档或提交 Issue。

# 🔧 爱丽丝 AI 核心 - 配置指南

## 📋 配置概览

本指南详细介绍了爱丽丝 AI 核心系统的所有配置选项，包括新增的系统监控、错误处理和性能优化配置。

## 🚀 快速开始

### 1. 复制配置模板
```bash
cp .env.template .env
```

### 2. 必需配置项
以下配置项是系统运行的最低要求：

```env
# LLM 服务 (必需)
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 嵌入服务 (必需)
SILICONFLOW_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 向量数据库 (可选，默认本地)
QDRANT_URL=http://localhost:6333
```

### 3. Bot 配置 (可选)
根据需要配置相应的 Bot：

```env
# Discord Bot
DISCORD_BOT_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
DISCORD_OWNER_ID=123456789012345678

# Telegram Bot
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_OWNER_ID=123456789
```

## 📚 配置分类详解

### 🤖 LLM 和嵌入服务

#### DeepSeek LLM 配置
```env
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxx  # 必需
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1      # 可选
LLM_MODEL=deepseek-chat                             # 可选
```

#### SiliconFlow 嵌入服务
```env
SILICONFLOW_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxx  # 必需
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1    # 可选
EMBEDDING_MODEL=Pro/BAAI/bge-m3                       # 可选
RERANKER_MODEL=Pro/BAAI/bge-reranker-v2-m3           # 可选
EMBEDDING_DIMENSION=1024                              # 可选
```

### 🗄️ 数据存储

#### Qdrant 向量数据库
```env
QDRANT_URL=http://localhost:6333        # 可选，默认本地
QDRANT_COLLECTION_NAME=rag_deno_collection  # 可选
```

#### 短期记忆 (STM) 配置
```env
STM_HISTORY_MODE=kv  # 'kv' 或 'platform'
```

### 🤖 Bot 平台配置

#### Discord Bot
```env
DISCORD_BOT_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
DISCORD_OWNER_ID=123456789012345678
DISCORD_OWNER_GREETING=主人                    # 可选
DISCORD_PROCESSING_THRESHOLD=0.6              # 可选，范围 0.0-1.0
DISCORD_ALWAYS_REPLY_TO_OWNER=true           # 可选
```

#### Telegram Bot
```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_OWNER_ID=123456789
TELEGRAM_OWNER_GREETING=主人                   # 可选
TELEGRAM_PROCESSING_THRESHOLD=0.45            # 可选，范围 0.0-1.0
TELEGRAM_ALWAYS_REPLY_TO_OWNER=true          # 可选
```

#### 通用 Bot 配置
```env
OWNER_NICKNAMES=kk,老大                       # 可选，逗号分隔
BOT_NAMES=爱丽丝,Alice,莉丝                   # 可选，逗号分隔
IMPORTANT_KEYWORDS=提醒,待办,总结,记录...      # 可选，逗号分隔
ACTION_VERBS=搜索,查询,查找,记录...            # 可选，逗号分隔
```

### 🧠 认知功能配置

#### 思维漫游
```env
MIND_WANDERING_ENABLED=true                   # 可选
MIND_WANDERING_PROBABILITY=0.15               # 可选，范围 0.0-1.0
MIND_WANDERING_COOLDOWN_MINUTES=5             # 可选
```

#### 时间感知
```env
TIME_PERCEPTION_ENABLED=true                  # 可选
MAX_MEMORY_DECAY_DAYS=90                      # 可选
DEFAULT_TIME_EXPRESSION_PRECISION=relative    # 可选
EMOTIONAL_RETENTION_FACTOR=3.0                # 可选
```

#### 人类语言模式
```env
HUMAN_PATTERNS_ENABLED=true                   # 可选
HUMAN_PATTERNS_ENABLE_ADVANCED=true           # 可选
VERBAL_TIC_PROBABILITY=0.3                    # 可选，范围 0.0-1.0
SELF_CORRECTION_PROBABILITY=0.15              # 可选，范围 0.0-1.0
HUMANIZATION_INTENSITY=0.7                    # 可选，范围 0.0-1.0
```

#### 虚拟具身
```env
VIRTUAL_EMBODIMENT_ENABLED=true               # 可选
VIRTUAL_EMBODIMENT_ENABLE_ADVANCED=true       # 可选
BODY_STATE_SENSITIVITY=0.7                    # 可选，范围 0.0-1.0
MAX_ENERGY_DEPLETION=0.2                      # 可选，范围 0.0-1.0
ENERGY_RECOVERY_RATE=0.1                      # 可选
```

#### 社交动态
```env
SOCIAL_DYNAMICS_ENABLED=true                  # 可选
RELATIONSHIP_SENSITIVITY=0.7                  # 可选，范围 0.0-1.0
MAX_SHARED_EXPERIENCES=5                      # 可选
MAX_MILESTONES=3                              # 可选
RELATIONSHIP_PROMPT_DETAIL=medium             # 可选：low/medium/high
```

### 🔧 系统监控和日志

#### 日志配置
```env
LOG_LEVEL=INFO                                # DEBUG/INFO/WARN/ERROR/CRITICAL
MAX_LOG_ENTRIES=1000                          # 最大日志条数
ENABLE_DEBUG_LOGGING=false                    # 详细调试日志
```

#### 性能监控
```env
PERFORMANCE_MONITORING_ENABLED=true           # 启用性能监控
PERFORMANCE_WARNING_THRESHOLD=5000            # 警告阈值 (毫秒)
SAVE_PERFORMANCE_REPORTS=false                # 保存性能报告
```

### 🛡️ 错误处理和恢复

```env
DEFAULT_ERROR_SEVERITY=medium                 # low/medium/high/critical
ENABLE_AUTO_ERROR_RECOVERY=true               # 自动错误恢复
MAX_RETRY_ATTEMPTS=3                          # 最大重试次数
RETRY_INTERVAL_MS=1000                        # 重试间隔 (毫秒)
```

### 💾 内存和资源管理

```env
MEMORY_WARNING_THRESHOLD_MB=512               # 内存警告阈值 (MB)
ENABLE_AUTO_GC=true                           # 自动垃圾回收
GC_INTERVAL_MINUTES=30                        # 垃圾回收间隔 (分钟)
MAX_CONCURRENT_OPERATIONS=10                  # 最大并发操作数
```

### 🔒 安全和隐私

```env
HIDE_SENSITIVE_INFO=true                      # 隐藏敏感信息
ENABLE_CONFIG_VALIDATION=true                 # 配置验证
LOG_USER_STATISTICS=false                     # 用户统计
DATA_RETENTION_DAYS=30                        # 数据保留天数
```

### 🔬 开发和调试

```env
DEVELOPMENT_MODE=false                        # 开发模式
DEBUG_API_CALLS=false                         # API 调试
TEST_MODE_DELAY_MS=0                          # 测试延迟 (毫秒)
```

## 🎯 推荐配置

### 生产环境
```env
LOG_LEVEL=INFO
PERFORMANCE_MONITORING_ENABLED=true
ENABLE_AUTO_ERROR_RECOVERY=true
HIDE_SENSITIVE_INFO=true
ENABLE_CONFIG_VALIDATION=true
DEVELOPMENT_MODE=false
```

### 开发环境
```env
LOG_LEVEL=DEBUG
ENABLE_DEBUG_LOGGING=true
DEBUG_API_CALLS=true
SAVE_PERFORMANCE_REPORTS=true
DEVELOPMENT_MODE=true
```

### 高性能配置
```env
COGNITIVE_INTEGRATION_MODE=performance
MAX_CONCURRENT_OPERATIONS=20
PERFORMANCE_WARNING_THRESHOLD=3000
ENABLE_AUTO_GC=true
GC_INTERVAL_MINUTES=15
```

## 🔍 配置验证

系统启动时会自动验证配置：

```bash
# 运行配置验证
deno run --allow-all test_telegram_simple.ts
```

验证内容包括：
- ✅ 必需配置项检查
- ✅ API 密钥格式验证
- ✅ URL 格式检查
- ✅ 数值范围验证
- ⚠️ 配置警告提示

## 📝 注意事项

1. **API 密钥安全**: 请妥善保管所有 API 密钥，不要提交到版本控制
2. **性能调优**: 根据实际使用情况调整阈值和限制
3. **日志管理**: 生产环境建议使用 INFO 级别，避免日志过多
4. **内存监控**: 定期检查内存使用情况，调整相关阈值
5. **错误处理**: 启用自动错误恢复可提高系统稳定性

## 🆘 故障排除

### 常见问题

1. **配置验证失败**
   - 检查必需配置项是否设置
   - 验证 API 密钥格式
   - 确认 URL 格式正确

2. **性能问题**
   - 调整并发操作数限制
   - 检查内存使用阈值
   - 启用性能监控查看瓶颈

3. **日志问题**
   - 调整日志级别
   - 检查日志条数限制
   - 确认日志目录权限

---

**配置版本**: v9.1.1
**更新时间**: 2024年12月
**兼容性**: Deno 1.40+

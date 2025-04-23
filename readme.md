# 🤖 爱丽丝 AI 核心 - RAG 驱动的智能助理 🧠

欢迎来到爱丽丝 AI 核心项目！这是一个基于 Deno 平台，使用 TypeScript 构建的先进
RAG (Retrieval-Augmented Generation)
系统。她不仅仅是一个聊天机器人，更是一位拥有独特个性（傲娇又可靠的“爱丽丝”）、能够学习和记忆的智能助理。

本项目旨在探索和实现具有长期记忆（LTM）和短期记忆（STM）能力的
AI，并通过灵活的接口（Discord & CLI）与用户进行交互。

STM (Deno KV) + Async LTM (Qdrant + BGE-M3 Embedding + BGE-Reranker-V2-M3 via
Deno Workers) + LLM (Any).

## ✨ 主要特性

- **👤 独特AI人格:**
  内置“爱丽丝”角色设定，她冷静、专业，有时又带点傲娇和毒舌，能根据对话上下文（工作/闲聊）和对象（主人/普通用户）调整行为模式。
- **🧠 先进 RAG 架构:**
  - **STM & LTM:** 结合 Deno KV 实现短期记忆，Qdrant 向量数据库实现长期记忆。
  - **动态上下文感知:** 使用 LLM 自动检测对话场景，切换 RAG
    上下文（例如区分不同工作项目或闲聊）。
  - **智能 LTM 策略:** 根据当前上下文，自动选择最优的 LTM
    检索策略（精确向量搜索+重排序 或 获取最近记忆）。
  - **记忆补充:** 当上下文相关记忆不足时，会自动补充全局相关记忆。
  - **重排序优化:** 使用 Reranker 模型（如
    BAAI/bge-reranker-v2-m3）提升检索结果的相关性。
- **⚡ 异步 LTM 处理:** 通过 Deno Worker
  在后台处理记忆的分析、向量化和存储，不阻塞实时响应。
- **🔌 多接口支持:**
  - **Discord Bot:** 在 Discord
    服务器中与爱丽丝互动，支持动态权重打分决定是否响应频道消息，避免干扰。
  - **CLI:** 提供命令行界面，方便本地测试和交互。
- **🛠️ 灵活配置:** 通过 `.env` 文件和 `config.ts` 轻松配置 API
  密钥、模型、数据库地址、RAG 参数等。

## 🚀 技术栈

- **Runtime:** Deno 🦕
- **Language:** TypeScript
- **Core AI/LLM:** Langchain (JS/TS)
- **LLM Provider:** DeepSeek (可通过 `config.ts` 配置)
- **Embedding & Reranker:** SiliconFlow (可通过 `config.ts` 配置)
- **Vector DB:** Qdrant
- **Short-Term Memory:** Deno KV
- **Discord Interface:** discord.js v14

## 🔧 安装与运行

1. **环境准备:**
   - 确保已安装 [Deno](https://deno.land/) (推荐最新版本)。
   - (可选) 如果遇到 discord.js 相关问题，可能需要 Node.js
     环境支持某些底层依赖。
   - 运行 Qdrant 实例，并确保网络可访问。

2. **克隆仓库:**
   ```bash
   git clone https://github.com/ImKK666/Alice
   cd Alice
   ```

3. **配置环境变量:**
   - 复制 `.env.example` (如果提供了) 为 `.env` 文件。
   - 编辑 `.env` 文件，填入必要的 API 密钥和配置：
     - `DEEPSEEK_API_KEY`: 你的 DeepSeek API 密钥。
     - `SILICONFLOW_API_KEY`: 你的 SiliconFlow API 密钥。
     - `QDRANT_URL`: 你的 Qdrant 实例地址 (默认 `http://localhost:6333`)。
     - `DISCORD_BOT_TOKEN`: 你的 Discord Bot Token (如果运行 Discord 模式)。
     - `DISCORD_OWNER_ID`: 你的 Discord User ID (用于识别“主人”)。
     - 其他可选配置见 `src/config.ts`。

4. **运行:**
   - **CLI 模式:**
     ```bash
     deno run --allow-net --allow-read --allow-env --allow-run src/main.ts
     ```
   - **Discord Bot 模式:**
     ```bash
     deno run --allow-net --allow-read --allow-env --allow-run src/main.ts --discord
     ```
     _(确保已在 Discord Developer Portal 配置好 Bot 并获取了 Token)_

   _权限说明:_ * `--allow-net`: 允许网络访问 (API 调用, Discord 连接, Qdrant
   连接)。 * `--allow-read`: 允许读取文件系统 (加载 `.env`)。 * `--allow-env`:
   允许访问环境变量。 * `--allow-run`: 允许启动子进程 (用于 LTM Worker)。

## ⚙️ 配置

核心配置位于 `src/config.ts`。你可以在此调整：

- LLM, Embedding, Reranker 模型名称和 API 端点。
- Qdrant 集合名称和地址。
- RAG 流程参数 (检索数量, TopN 等)。
- Discord Bot 相关设置 (主人 ID, 称呼, 频道回复阈值等)。

---

## 🗺️ 未来改进 TODO 计划 🚧

这是我们接下来可以探索和改进的方向列表，让爱丽丝变得更强 💪！

### 🛡️ 可靠性 & 错误处理

- `[ ]` **LTM Worker 健壮性:** 增强
  `ltm_worker.ts`，加入对处理失败的重试逻辑和向主线程报告详细错误状态。
- `[ ]` **API 调用韧性:** 为 LLM/Embedding/Rerank API
  设计更智能的回退策略，例如在 Reranker 持续失败时能动态调整流程。
- `[ ]` **Qdrant 连接管理:** 考虑使用连接池或实现更可靠的自动重连逻辑。
- `[ ]` **Discord 反馈:** 优化 Discord 消息发送失败时的日志记录和用户反馈。

### 🧠 RAG & 记忆系统

- `[ ]` **上下文检测优化:**
  - 持续迭代 `determineCurrentContext` 的 LLM Prompt，提升准确率和效率。
  - 探索结合规则/关键字快速判断常见上下文，减少 LLM 依赖。
  - 简化或重构 `previousContextId` 的解析逻辑，提高可维护性。
- `[ ]` **LTM 策略探索:**
  - 测试混合检索策略（例如：始终检索少量近期记忆 + 向量搜索）。
  - 细化 LTM 补充逻辑的触发条件和数量控制。
- `[ ]` **记忆质量提升:**
  - 优化 `memory_processor.ts` 中 LLM 分析 Prompt，提高 `relevant_content`
    提取质量。
  - 研究并应用更安全的 Prompt 工程技术，防范潜在的注入风险。
- `[ ]` **高级记忆功能:**
  - **实现记忆总结:** 开发定期任务，将对话回合 (`conversation_turn`) 总结为
    `summary` 记忆。
  - **实现记忆反思:** 设计机制让 AI 能回顾 LTM 并进行更高层次的推理，生成
    `reflection` 记忆。

### 🤖 Discord 交互

- `[ ]` **消息评分调优:** 根据实际效果调整 `calculateMessageImportanceScore`
  中的权重和 `discordProcessingThreshold`。
- `[ ]` **性能评估:** 评估 `message.channel.messages.fetch`
  对响应延迟的影响，考虑是否需要优化。
- `[ ]` **速率限制处理:** 为高流量服务器添加更明确的 Discord API
  速率限制处理逻辑。

### ⚡ 性能优化

- `[ ]` **性能分析:** 定位 RAG 流程中的主要性能瓶颈（LLM, API 调用, DB 查询）。
- `[ ]` **Qdrant 索引:** 为 `payload` 中的 `source_context` 和 `memory_type`
  等字段在 Qdrant 中创建索引，加速过滤查询。

### 🛠️ 代码 & 维护性

- `[ ]` **自动化测试:** 编写单元测试和集成测试，覆盖核心逻辑（RAG
  流程、评分函数等）。
- `[ ]` **配置中心化:** 将代码中的“魔法数字”（如 STM 窗口大小）移至
  `config.ts`。
- `[ ]` **Prompt 管理:** 将较长的 Prompt 模板移至单独文件或模块管理。
- `[ ]` **依赖更新:** 定期审查和更新 `deno.json` 中的依赖项。

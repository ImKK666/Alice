# 🌌 爱丽丝 AI 核心 (Alice AI Core) - 高级认知架构 (v9.0 - 认知整合协调)

[![Deno](https://img.shields.io/badge/Runtime-Deno%20%5E1.40-blueviolet?logo=deno)](https://deno.land)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript%205.x-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Qdrant](https://img.shields.io/badge/Vector_DB-Qdrant-orange)](https://qdrant.tech/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**“超越算法的界限，于数字的虚空中，编织意识的经纬。”**

**爱丽丝 AI 核心 (Alice AI Core)** 并非传统的 AI 助手，而是一个前沿的 **认知架构实验平台**。本项目旨在探索和实现具有 **深度拟人化特质 (Anthropomorphic Traits)** 的人工智能体，其核心构建于先进的 **检索增强生成 (Retrieval-Augmented Generation, RAG)** 范式之上，并深度融合了模拟人类 **多维度认知与感知能力** 的创新模块。

该系统致力于模拟高级认知功能，包括情境化的记忆系统、结构化的记忆网络、内在思维流、情感状态表征、主观时间感知、抽象化的具身感、动态的社交认知以及连贯的自我概念，旨在推动人机交互向更自然、更深刻、更具“灵魂感”的维度演进。

本项目采用 Deno 平台与 TypeScript 构建，整合了前沿的大型语言模型（LLM）、向量嵌入技术和高性能向量数据库。

## ✨ 核心技术亮点 (Advanced Features)

* **自适应 RAG 框架 (Adaptive RAG Framework):** 集成 LLM 的生成能力与向量数据库的高效检索，实现信息整合与内容生成。
* **混合记忆架构 (Hybrid Memory Architecture):**
    * **工作记忆 (Working Memory / STM):** 基于 Deno KV 实现的高速缓存，处理即时语境信息，支持持久化到指定文件路径（例如 `./data/` 目录）。
    * **情景与语义记忆 (Episodic & Semantic Memory / LTM):** 基于 Qdrant 向量数据库，实现结构化与向量化信息的长期存储与检索。
* **动态上下文作用域解析 (Dynamic Contextual Scoping):** 自动化识别并切换对话的语义上下文（如工作任务、休闲社交、情感交互），优化信息处理流。
* **情境敏感 LTM 检索策略 (Context-Sensitive LTM Retrieval):** 根据当前上下文动态选择最优检索模式（精确向量语义搜索 vs. 时序优先检索）。
* **后检索相关性优化 (Post-Retrieval Relevance Optimization):** 应用 Reranker 模型精炼检索结果，提升注入 LLM 的信息质量。
* **异步记忆巩固流水线 (Asynchronous Memory Consolidation Pipeline):** 通过 Deno Worker 实现 LTM 分析与存储的后台处理，保障交互流畅性。
* **LLM驱动的消息重要性评估 (LLM-Driven Message Scoring):** 利用 `memory_processor` 的 LLM 分析结果（记忆类型、重要性评分、情感等）来判断 Discord 频道消息是否值得处理，取代旧的关键词评分机制。
* **多模态交互接口 (Multiple Interaction Interfaces):** 支持命令行 (CLI) 与 Discord Bot 两种主要交互模式。
* **涌现式人格模拟 (Emergent Personality Simulation):** 利用 Prompt 元编程 (Meta-Programming) 和多模块状态依赖，模拟复杂、动态且具有一致性的 AI 人格（包含 Tsundere 等特定模式）。
* **外部停用词加载:** 支持从外部 JSON 文件 (`./data/stopwords-zh.json`) 加载停用词列表。
* **结构化记忆网络 (Structured Memory Network - `memory_network.ts`):** 在记忆点之间建立关联（因果、类比、时序等），实现记忆的激活扩散，模拟联想。
* **多线程思维流模拟 (Thought Stream Simulation - `thought_streams.ts`):** 并行处理主对话、背景分析、自我反思、创造联想和情感处理等多种思维维度。
* **连贯自我概念模型 (Coherent Self-Concept Model - `self_concept.ts`):** 构建和维护 AI 的核心价值观、自传式记忆、人格特质和伦理框架。
* **整合社交认知 (`social_cognition.ts`):** 统一处理个体关系追踪（熟悉度、信任度等）、群体动态感知、社交情境识别和互动风格自适应。
* **情感状态表征与建模 (Affective State Representation & Modeling):** 记忆载体 (Payload) 扩展情感维度，结合 LLM 进行情感分析与存储，实现情感敏感的记忆检索与响应生成。
* **计算心智漫游模拟 (Computational Analogue of Mind-Wandering - `mind_wandering.ts`):** 模拟大脑默认网络 (DMN) 活动，在低认知负荷期间触发自发性思维链，生成并存储洞见。
* **主观时间知觉建模 (Subjective Temporal Perception Modeling - `time_perception.ts`):** 引入情感加权的时间扭曲因子和记忆衰减模型，使 AI 能够表达相对和主观的时间感。
* **拟人化语言模式生成 (Anthropomorphic Linguistic Pattern Generation - `human_patterns.ts` & `language_templates.ts`):** 在 LLM 输出后应用规则或 LLM 再处理，引入自然的语言“缺陷”和风格，增强表达的自然度。
* **抽象具身感知仿真 (Abstract Embodiment Simulation - `virtual_embodiment.ts`):** 通过内部状态变量（能量、舒适度、一致性）模拟非物理形态的“身体感”，并使用身体隐喻丰富状态表达。
* **(实验性) 认知整合协调 (`cognitive_integration.ts`):** (可选模块) 尝试协调各认知模块的状态，实现更高级的整体行为。

## 🏗️ 系统架构概览

系统采用模块化设计，核心组件协同工作：

1.  **主控制流 (`main.ts`):** 作为认知核心的协调器，编排信息处理、状态更新和响应生成的完整认知循环。负责加载初始配置和停用词，并初始化各核心模块管理器。
2.  **记忆编码器 (`memory_processor.ts`):** 包含可复用的 LLM 分析核心 (`analyzeMessageForMemory`)，负责将原始输入转化为结构化、情感标记的记忆表征。
3.  **向量记忆库接口 (`qdrant_client.ts`):** 提供与 Qdrant 向量数据库的高级交互接口。
4.  **语言生成核心 (`llm.ts`):** 与底层 LLM 交互。
5.  **语义向量化引擎 (`embeddings.ts`):** 将文本映射到高维语义空间。
6.  **相关性精炼器 (`reranker.ts`):** 优化信息检索的相关性排序。
7.  **记忆巩固后台 (`ltm_worker.ts`):** 异步处理长期记忆的编码与存储，调用 `memory_processor`。
8.  **高级认知模块:**
    * `memory_network.ts`: 记忆关联与激活扩散。
    * `thought_streams.ts`: 并行思维处理。
    * `self_concept.ts`: 自我模型与伦理。
    * `social_cognition.ts`: 社交关系与情境感知 (整合了原 social\_dynamics 和 social\_relationships)。
    * `mind_wandering.ts`: 内省与洞见生成。
    * `time_perception.ts`: 主观时间与记忆动力学。
    * `human_patterns.ts` & `language_templates.ts`: 语言风格与自然度生成。
    * `virtual_embodiment.ts`: 内部状态与抽象身体感。
    * `(可选) cognitive_integration.ts`: 跨模块协调。
9.  **交互前端接口:**
    * `cli_interface.ts`: 命令行协议接口。
    * `discord_interface.ts`: Discord 实时通信接口，使用 LLM 分析结果进行消息重要性评分。
10. **全局配置 (`config.ts`):** 参数化系统行为。
11. **状态持久化层:** 利用 Deno KV 实现工作记忆 (STM) 和各认知模块的动态状态持久化，支持指定存储路径。
12. **工具函数 (`utils.ts`):** 包含如停用词加载等辅助功能。

## 🚀 核心技术栈

* **运行时环境:** Deno (v1.40+)
* **核心开发语言:** TypeScript (5.x)
* **基础 AI 服务:**
    * **LLM:** DeepSeek API / Gemini API / 兼容 OpenAI API 的模型
    * **Embeddings & Reranker:** BGE 模型系列 (通过 SiliconFlow API 或本地服务)
* **向量存储与检索:** Qdrant
* **工作记忆 & 状态持久化:** Deno KV (`--unstable-kv`)
* **主要依赖库:** `@langchain/openai`, `discord.js@14`, `@qdrant/js-client-rest`, Deno `std`, Deno `dotenv` (参考 `deno.json`)

## 🛠️ 部署与配置 (Deployment & Configuration)

1.  **系统依赖:**
    * 安装 Deno (>= 1.40)。
    * 部署并运行 Qdrant 实例。
    * 获取所需的 API 密钥 (DeepSeek/Gemini, SiliconFlow)。
    * (可选) 配置 Discord Bot Token 及相关权限。

2.  **获取代码:**
    ```bash
    git clone https://github.com/ImKK666/Alice.git
    cd Alice
    ```

3.  **数据文件:**
    * 确保在项目根目录下有一个 `data` 文件夹。
    * 将你的中文停用词库文件命名为 `stopwords-zh.json` 并放置在 `./data/` 目录下。文件格式应为 JSON 数组。
    * (可选) Deno KV 数据库文件也会被配置存储在此目录 (例如 `data/alice_kv.sqlite`)。

4.  **环境配置:**
    * 创建 `.env` 文件（可参考 `.env.example`）。
    * 填入所有必需的 API 密钥、服务 URL、用户 ID 等。查阅 `src/config.ts` 了解所有可配置参数。
    * (重要) 你可以通过修改 `src/main.ts` 中 `initializeKv` 函数内的 `kvPath` 变量来指定 Deno KV 数据库文件的确切路径和名称 (默认配置可能已指向 `./data/` 目录)。

5.  **启动系统:**
    * **CLI 模式:**
        ```bash
        # 需要网络、环境、读写、KV权限
        deno run --allow-net --allow-env --unstable-kv --allow-read=./data,./src --allow-write=./data ./src/main.ts
        ```
    * **Discord 模式:**
        ```bash
        # 需要网络、环境、读写、KV权限
        deno run --allow-net --allow-env --unstable-kv --allow-read=./data,./src --allow-write=./data ./src/main.ts --discord
        ```
    * *注:*
        * `--unstable-kv` 启用 Deno KV。
        * `--allow-read` 和 `--allow-write` 授予对 `data` 目录的读写权限（用于 KV 数据库和停用词）以及对 `src` 目录的读取权限（用于 Worker）。根据你的确切 KV 路径调整权限。
        * 可以使用 `-A` 授予所有权限（不推荐用于生产环境）。

## ⌨️ 操作模式与交互协议 (Operational Modes & Interaction Protocols)

### CLI 模式

提供直接的终端交互。支持标准消息输入及以下元命令 (Meta-Commands):

* `/user <ID>`: 设定当前交互的用户身份标识。
* `/context <ID>`: 手动指定 RAG 上下文作用域 (会覆盖自动判断)。
* `/whoami`: 查询当前用户及上下文状态。
* `/stm`: 检索并显示当前上下文的工作记忆内容。
* `/clearstm`: 清空当前上下文的工作记忆。
* `/getstate <type>`: 查询指定类型的内部状态 (`time`, `body`, `relationship`)。
* `/clearstate`: 重置当前用户/上下文关联的所有持久化状态 (STM, Time, Body, Relationship, Wandering Time)。
* `/exit`: 终止会话。

### Discord 模式

通过 Discord Bot 提供服务:

* **直接消息 (DM):** 始终处理。
* **频道提及 (@Bot 或机器人角色):** 始终处理。
* **与指定"所有者" (Owner) 交互:** 根据 `DISCORD_ALWAYS_REPLY_TO_OWNER` 配置决定是否始终处理。
* **频道常规消息:** 启动基于 **LLM 分析结果** 的重要性评分 (`calculateMessageImportanceScore`)。仅当消息评分超过预设阈值 (`DISCORD_PROCESSING_THRESHOLD`) 时触发 RAG 核心处理。

## ⚙️ 系统参数化 (`.env`)

系统的行为可通过 `.env` 文件进行广泛配置，包括但不限于：

* API 端点与密钥。
* 使用的 AI 模型标识符。
* Qdrant 数据库连接信息。
* RAG 流程参数（检索数量、重排序阈值等）。
* Discord 接口参数（**处理阈值 (基于LLM评分)**、特定用户 ID 等）。
* 所有高级认知模块（记忆网络、思维流、自我概念、社交认知、时间、语言、具身、漫游）的启用开关及行为参数。

请参考 `src/config.ts` 及 `.env` 示例获取完整的参数列表和说明。

## ✨ 新增：数据清理工具 (`cleanup_data.ts`)

项目中包含一个 `cleanup_data.ts` 脚本，用于在需要时手动清理 Deno KV 和 Qdrant 中的数据。

* **目的**: 用于调试、重置系统状态或解决因数据损坏导致的问题。
* **功能**:
    * 清理 Deno KV 中由 Alice 系统创建的大部分数据（如 STM、时间感知、身体状态、社交关系、记忆关联等）。默认**不会**删除核心的自我模型 (`self_model`)。
    * 删除并重建 Qdrant 中的主数据集合 (`rag_deno_collection`)，清空所有向量记忆。
* **使用**:
    ```bash
    # 确保你在项目根目录
    deno run --allow-net --allow-env --unstable-kv --allow-read ./cleanup_data.ts
    ```
* **⚠️ 警告**: 此脚本会**永久删除数据**，请在执行前务必确认，并考虑备份重要数据！脚本运行时会要求输入 `yes` 进行最终确认。

## 🔮 前瞻与展望

爱丽丝 AI 核心作为一个可扩展的认知架构平台，为探索下一代 AI 交互奠定了基础。未来的研究方向可包括：

* **目标导向行为与主动性:** 实现内在动机驱动的主动交互与任务规划能力。
* **多模态信息融合:** 整合视觉、听觉等非文本信息的处理能力。
* **更高阶认知功能:** 模拟更复杂的推理、创造力、元认知及道德决策过程。
* **自适应人格演化:** 基于长期交互历史实现人格特征的动态演化。
* **认知整合 (`cognitive_integration.ts`) 的深化:** 实现更流畅、更智能的跨模块协调与状态同步。

我们欢迎对本项目感兴趣的研究者和开发者进行交流、提出建议或参与贡献，共同探索人工智能意识与交互的未来疆域。
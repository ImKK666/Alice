// src/memory_processor.ts
/**
 * 记忆处理器模块
 *
 * 负责接收输入信息（如聊天消息），使用 LLM 进行分析，
 * 提取关键信息，判断记忆类型和重要性，
 * 生成 Embedding 向量，并将其格式化为 MemoryPointStruct，
 * 最后存储到 Qdrant 向量数据库中。
 */

import { llm } from "./llm.ts"; // 导入 LLM 客户端
import { embeddings } from "./embeddings.ts"; // 导入 Embeddings 客户端
import {
  type MemoryPointStruct,
  type MemoryType,
  upsertMemoryPoints,
} from "./qdrant_client.ts"; // 导入 Qdrant 相关函数和类型
import { config } from "./config.ts"; // 导入配置

// Deno/Web 标准 API 用于生成 UUID
// import { v4 as uuidv4 } from 'npm:uuid'; // 或者使用 npm 包

/**
 * 定义传入处理器的聊天消息结构
 */
export interface ChatMessageInput {
  userId: string; // 发送消息的用户 ID
  contextId: string; // 消息所在的上下文 ID (群组 ID, 私聊 ID 等)
  text: string; // 消息的文本内容
  messageId?: string; // (可选) 原始消息的唯一 ID
  timestamp?: number; // (可选) 消息的原始时间戳 (若无则使用处理时的时间)
}

/**
 * (核心函数) 处理单条输入消息并存储为记忆
 *
 * 实现逻辑:
 * 1. (可选) 初步过滤，判断消息是否值得记忆。
 * 2. 使用 LLM 分析消息内容，提取关键信息，判断类型和重要性。
 * 3. 决定用于 Embedding 的最终文本内容。
 * 4. 调用 Embedding 模型生成向量。
 * 5. 生成唯一的 Point ID (UUID)。
 * 6. 构建 MemoryPointStruct 对象。
 * 7. 调用 upsertMemoryPoints 存储到 Qdrant。
 *
 * @param message 输入的聊天消息对象
 * @returns Promise<void>
 */
export async function processAndStoreMessage(
  message: ChatMessageInput,
): Promise<void> {
  console.log(
    `[MemoryProcessor] 🔄 开始处理消息: 用户 ${message.userId} 在上下文 ${message.contextId}`,
  );

  // --- 1. (可选) 初步过滤 ---
  // 例如，可以过滤掉过短的消息、纯表情符号、或者特定命令等
  if (message.text.trim().length < 5) { // 示例：过滤掉少于5个字符的消息
    console.log("[MemoryProcessor] ⏭️ 消息过短，跳过存储。");
    return;
  }

  // --- 判断当前的人格/上下文模式 (示例) ---
  const isProfessionalContext = message.contextId.startsWith("work_") ||
    message.contextId.startsWith("DM_"); // 判断是否为工作相关或私聊
  const personaMode = isProfessionalContext ? "专业的秘书" : "随和的朋友"; // 根据上下文决定人格
  const currentDate = new Date().toLocaleString("zh-CN", { // --- 修改: 改为zh-CN以提高兼容性，保留台北时区 ---
    timeZone: "Asia/Taipei", // 假设依然需要台湾时间
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  // --- 构建分析指令 (Prompt) ---
  // --- 添加: 关于潜在Prompt注入的注释 ---
  // 注意: 直接将用户输入`message.text`嵌入到Prompt中理论上存在Prompt注入的风险
  // 如果输入包含恶意指令。如果处理不受信任的输入或观察到问题，考虑进行清理或
  // 使用更高级的Prompt结构。
  const analysisPrompt = `
你是一个 AI 助手，负责分析收到的聊天消息，以决定哪些信息需要存入你的长期记忆中。
当前背景：你正在扮演一个 **${personaMode}** 的角色。
当前台北时间：${currentDate}
这条消息来自用户 "${message.userId}"，在聊天上下文 "${message.contextId}" 中。

需要分析的消息内容：
"${message.text}"

你的任务是分析这条消息，并 **只返回** 一个有效的 JSON 对象，包含以下字段：
1.  "memory_type": 根据消息内容和当前的 **${personaMode}** 角色，选择 **最合适** 的记忆类型。可用类型：[${
    getMemoryTypes().join(", ")
  }]
    - 在 **专业** 场景下，优先考虑 'task' (任务), 'fact' (与工作相关的事实), 'summary' (总结)。
    - 在 **休闲** 场景下，优先考虑 'joke_or_banter' (玩笑/梗), 'preference' (偏好), 'fact' (一般事实), 'conversation_turn' (普通对话)。
    - 如果只是普通闲聊或不确定，使用 'conversation_turn'。
    - 对于客观陈述，使用 'fact'。
    - 对于主观喜好，使用 'preference'。
    - 对于明确的指令或提醒，使用 'task'。
2.  "importance_score": 评估这条信息的长期记忆重要性 (1=非常低, 2=低/闲聊, 3=中等/可能相关, 4=高/重要事实或偏好, 5=非常高/关键任务或指令)。请根据 **${personaMode}** 角色调整评分 (例如，任务在专业场景下更重要)。
3.  "relevant_content": 决定要存储的文本内容。
    - 如果类型是 'fact', 'preference', 'task'，请准确、简洁地提取或重述核心陈述。
    - 如果类型是 'summary'，生成一个简短摘要（但这可能更适合由单独的总结流程处理）。
    - 如果类型是 'conversation_turn' 或 'joke_or_banter'，通常使用原文；但如果原文过长（例如超过 150 字符），则创建一个非常简短的摘要或只用第一句话。
    - 确保存储的内容足够独立，以便将来能够理解。

输出示例：
{"memory_type": "task", "importance_score": 5, "relevant_content": "提醒用户周五前提交报告。"}
{"memory_type": "preference", "importance_score": 4, "relevant_content": "用户 ${message.userId} 提到他们喜欢吃辣。"}
{"memory_type": "conversation_turn", "importance_score": 2, "relevant_content": "${message.text}"}
{"memory_type": "joke_or_banter", "importance_score": 3, "relevant_content": "${message.text}"}

请 **只返回 JSON 对象**，不要在 JSON 前后包含任何其他文字。
`;

  let memoryType: MemoryType = "conversation_turn"; // 默认类型
  let processedTextContent = message.text; // 默认使用原文
  let importanceScore: number | undefined = 2; // 默认重要性
  const requiresEmbedding = true; // 默认需要生成向量

  try {
    console.log("[MemoryProcessor] 🧠 正在调用 LLM 分析消息...");
    const llmResponse = await llm.invoke(analysisPrompt);

    let analysisResult: {
      memory_type: string;
      importance_score: number;
      relevant_content: string;
    };

    const responseContent = typeof llmResponse === "string"
      ? llmResponse
      : (llmResponse.content as string);

    if (!responseContent) {
      throw new Error("❌ LLM 返回了空内容。");
    }

    const cleanedContent = responseContent.trim().replace(
      /^```json\s*|```$/g,
      "",
    );

    try {
      analysisResult = JSON.parse(cleanedContent);
      if (
        !analysisResult.memory_type ||
        analysisResult.importance_score === undefined || // 检查分数是否未定义
        !analysisResult.relevant_content
      ) {
        throw new Error(
          "❌ 解析出的 JSON 对象缺少必要的字段 (memory_type, importance_score, relevant_content)。",
        );
      }
    } catch (parseError) {
      // --- 修改: 增强解析错误日志 ---
      console.error(
        `[MemoryProcessor] ❌ 解析 LLM 返回的 JSON 时出错: ${parseError}`,
      );
      console.error(
        "[MemoryProcessor] 📄 LLM 原始返回内容 (清理后):",
        cleanedContent,
      ); // 记录解析失败的内容
      console.error(
        "[MemoryProcessor] 📄 LLM 原始返回内容 (未清理):",
        responseContent,
      ); // 同时记录原始内容
      throw new Error(`❌ 解析 LLM JSON 响应失败: ${parseError}`); // 重新抛出更具体的错误消息
    }

    memoryType = (analysisResult.memory_type as MemoryType) || "unknown";
    processedTextContent = analysisResult.relevant_content || message.text;
    importanceScore = analysisResult.importance_score ?? 2; // 使用空值合并运算符处理分数

    if (!getMemoryTypes().includes(memoryType)) {
      console.warn(
        `[MemoryProcessor] ⚠️ LLM 返回了一个未知的 memory_type: ${memoryType}。将使用 'unknown'。`,
      );
      memoryType = "unknown";
    }

    console.log(
      `[MemoryProcessor] ✅ LLM 分析结果: 类型=${memoryType}, 重要性=${importanceScore}, 内容='${
        processedTextContent.substring(0, 50)
      }...'`,
    );
  } catch (error) {
    console.error("[MemoryProcessor] ❌ LLM 分析或解析时出错:", error);
    console.log("[MemoryProcessor] ⚠️ 将使用默认值存储原始消息。");
    memoryType = "conversation_turn";
    processedTextContent = message.text;
    importanceScore = 1; // 由于分析失败，标记为低重要性
  }

  // --- 3. & 4. 生成 Embedding 向量 ---
  let vector: number[] = [];
  if (requiresEmbedding) {
    try {
      console.log("[MemoryProcessor] 🔤 正在生成文本的嵌入向量...");
      vector = await embeddings.embedQuery(processedTextContent);
      console.log(
        `[MemoryProcessor] ✅ 嵌入向量生成成功，维度: ${vector.length}`,
      );
    } catch (error) {
      console.error("[MemoryProcessor] ❌ 生成嵌入向量时出错:", error);
      throw new Error(`❌ 无法为消息生成嵌入向量: ${error}`);
    }
  }

  // --- 5. 生成唯一的 Point ID ---
  // 使用 Deno 内置的 crypto.randomUUID() 来生成 UUID
  const pointId = crypto.randomUUID();

  // --- 6. 构建 MemoryPointStruct 对象 ---
  const memoryPoint: MemoryPointStruct = {
    id: pointId,
    vector: vector,
    payload: {
      memory_type: memoryType,
      timestamp: message.timestamp || Date.now(),
      source_user: message.userId,
      source_context: message.contextId,
      text_content: processedTextContent,
      importance_score: importanceScore,
      // 可以选择添加其他 payload 字段，例如 related_ids
    },
  };

  // --- 7. 存储到 Qdrant ---
  try {
    console.log(`[MemoryProcessor] 📦 正在将记忆存储到 Qdrant...`);
    await upsertMemoryPoints(config.qdrantCollectionName, [memoryPoint]);
    console.log(
      `[MemoryProcessor] ✅ 记忆成功存储到 Qdrant，Point ID: ${pointId}`,
    );
  } catch (error) {
    console.error("[MemoryProcessor] ❌ 存储记忆到 Qdrant 时出错:", error);
    throw new Error(`❌ 无法存储记忆: ${error}`);
  }
}

/**
 * 辅助函数：获取所有可用的记忆类型
 * 用于在分析指令中列出可用类型
 */
function getMemoryTypes(): MemoryType[] {
  return [
    "conversation_turn",
    "fact",
    "preference",
    "task",
    "summary",
    "persona_trait",
    "joke_or_banter",
    "reflection",
  ];
}

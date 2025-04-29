// src/memory_processor.ts (修改后 - 提取分析逻辑)

import { llm } from "./llm.ts";
import { embeddings } from "./embeddings.ts";
import {
  type EmotionDimension, // 导入情感维度类型
  type MemoryPayload, // 确保导入 MemoryPayload
  type MemoryPointStruct,
  type MemoryType,
  upsertMemoryPoints,
} from "./qdrant_client.ts"; // 注意: 导入新添加的类型
import { config } from "./config.ts";

/**
 * 定义传入处理器的聊天消息结构
 */
export interface ChatMessageInput {
  userId: string; // 发送消息的用户 ID
  contextId: string; // 消息所在的上下文 ID (群组 ID, 私聊 ID 等) - 注意：这里可能是原始来源ID或RAG ID
  text: string; // 消息的文本内容
  messageId?: string; // (可选) 原始消息的唯一 ID
  timestamp?: number; // (可选) 消息的原始时间戳 (若无则使用处理时的时间)
}

/**
 * 定义 LLM 分析结果的结构
 */
export interface MessageAnalysisResult {
  memory_type: MemoryType;
  importance_score: number; // 1-5
  processed_text_content: string;
  emotional_valence: number; // -1.0 到 1.0
  emotional_arousal: number; // 0.0 到 1.0
  emotional_dimensions: { [key in EmotionDimension]?: number };
  associative_triggers: string[];
  requires_embedding: boolean; // 是否需要生成向量 (基于分析结果判断)
}

/**
 * (新增函数) 使用 LLM 分析单条消息，提取记忆相关信息和情感。
 * 这个函数现在是核心的分析逻辑，可以被其他模块复用。
 *
 * @param message 输入的聊天消息对象
 * @returns Promise<MessageAnalysisResult> 包含分析结果的对象
 * @throws 如果 LLM 调用或 JSON 解析失败，会抛出错误
 */
export async function analyzeMessageForMemory(
  message: ChatMessageInput,
): Promise<MessageAnalysisResult> {
  console.log(
    `[MemoryProcessor][分析] 🧠 开始分析消息: 用户 ${message.userId} 在上下文 ${message.contextId}`,
  );
  console.log(
    `[MemoryProcessor][分析]   消息内容预览: "${
      message.text.substring(0, 70)
    }..."`,
  );

  // --- 判断当前的人格/上下文模式 (示例) ---
  // 注意：这里的 contextId 可能是原始来源 ID 或 RAG ID，取决于调用者
  // 如果需要更精确的模式判断，可能需要传递更多上下文信息
  const isProfessionalContext = message.contextId.includes("work_");
  const personaMode = isProfessionalContext ? "专业的秘书" : "傲娇的朋友"; // 根据上下文决定人格
  const currentDate = new Date().toLocaleString("zh-CN", { // 使用 zh-CN 提高兼容性
    timeZone: "Asia/Taipei", // 保留台北时区
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  // --- 构建分析指令 (Prompt) ---
  const analysisPrompt = `
你是一个 AI 助手，负责分析收到的聊天消息，以决定哪些信息需要存入你的长期记忆中，同时进行情感分析。
当前背景：你正在扮演一个 **${personaMode}** 的角色。
当前本地时间：${currentDate}
这条消息来自用户 "${message.userId}"，在聊天上下文 "${message.contextId}" 中。

需要分析的消息内容：
"${message.text}"

你的任务是分析这条消息，并 **只返回** 一个有效的 JSON 对象，包含以下字段：
1.  "memory_type": 根据消息内容和当前的 **${personaMode}** 角色，选择 **最合适** 的记忆类型。可用类型：[${
    getMemoryTypes().join(", ")
  }]
    - 在 **专业** 场景下，优先考虑 'task' (任务), 'fact' (与工作相关的事实), 'summary' (摘要)。
    - 在 **休闲/傲娇** 场景下，优先考虑 'joke_or_banter' (玩笑/梗), 'preference' (偏好), 'fact' (一般事实), 'conversation_turn' (普通对话)。
    - 如果检测到强烈的情感表达，可以使用 'emotional_response' 类型。
    - 如果只是普通闲聊或不确定，使用 'conversation_turn'。
    - 对于客观描述，使用 'fact'。
    - 对于主观偏好，使用 'preference'。
    - 对于明确的指令或请求，使用 'task'。
2.  "importance_score": 评估这条信息的长期记忆重要性 (1=非常低, 2=低/闲聊, 3=中等/可能相关, 4=高/重要事实或偏好, 5=非常高/关键任务或指令)。请根据 **${personaMode}** 角色调整评分 (例如，任务在专业场景下更重要)。
3.  "relevant_content": 决定要存储的文本内容。
    - 如果类型是 'fact', 'preference', 'task'，请准确、简洁地提取或重述核心陈述。
    - 如果类型是 'summary'，生成一个简短摘要。
    - 如果类型是 'conversation_turn' 或 'joke_or_banter'，通常使用原文，但如果原文过长，例如超过 150 字符，则创建一个非常简短的摘要或只用第一句话。
    - 如果类型是 'emotional_response'，捕捉关键的情感表达。
    - 确保存储的内容足够独立，以便将来能够理解。
4.  "emotional_valence": 分析消息的情感效价，范围从 -1.0 (极度负面) 到 1.0 (极度正面)，0.0 表示中性。
5.  "emotional_arousal": 评估情感的强度或唤醒度，范围从 0.0 (完全平静) 到 1.0 (极度强烈)。
6.  "emotional_dimensions": 一个对象，分析消息在不同情感维度上的强度 (每个维度得分在 0.0 到 1.0 之间，请尽量覆盖所有维度，不相关的可以给较低的分数)：
    - "joy": 喜悦或幸福感
    - "sadness": 悲伤或忧郁
    - "anger": 愤怒或恼怒
    - "fear": 恐惧或焦虑
    - "surprise": 惊讶或震惊
    - "disgust": 厌恶或反感
    - "trust": 信任或接受
    - "anticipation": 期待或预期
    - "neutral": 中性或缺乏明显情感
7.  "associative_triggers": 一个字符串数组，包含可能在未来唤起此记忆的关键词或短语 (2-5个，用于联想)。

输出示例：
{
  "memory_type": "task",
  "importance_score": 5,
  "relevant_content": "提醒用户在周五提交报告。",
  "emotional_valence": 0.2,
  "emotional_arousal": 0.3,
  "emotional_dimensions": {"joy": 0.1, "sadness": 0.0, "anger": 0.0, "fear": 0.0, "surprise": 0.1, "disgust": 0.0, "trust": 0.4, "anticipation": 0.7, "neutral": 0.5},
  "associative_triggers": ["截止日期", "报告", "周五", "提醒", "提交"]
}

请 **只返回 JSON 对象**，不要在 JSON 前后包含任何其他文字或解释。
`;

  // ---- 调用 LLM 并解析 ----
  // 注意：这里可能抛出错误，由调用者处理
  const llmResponse = await llm.invoke(analysisPrompt);

  let analysisResultJson: {
    memory_type: string;
    importance_score: number;
    relevant_content: string;
    emotional_valence: number;
    emotional_arousal: number;
    emotional_dimensions: { [key in EmotionDimension]?: number };
    associative_triggers: string[];
  };

  const responseContent = typeof llmResponse === "string"
    ? llmResponse
    : (llmResponse.content as string);

  if (!responseContent) {
    throw new Error("[MemoryProcessor][分析] LLM 返回了空内容。");
  }

  const cleanedContent = responseContent.trim().replace(
    /^```json\s*|```$/g,
    "",
  );

  try {
    analysisResultJson = JSON.parse(cleanedContent);
    // 验证必要字段
    if (
      !analysisResultJson.memory_type ||
      analysisResultJson.importance_score === undefined ||
      !analysisResultJson.relevant_content ||
      analysisResultJson.emotional_valence === undefined ||
      analysisResultJson.emotional_arousal === undefined ||
      !analysisResultJson.emotional_dimensions ||
      !analysisResultJson.associative_triggers
    ) {
      throw new Error("解析出的 JSON 对象缺少必要的字段。");
    }
  } catch (parseError) {
    console.error(
      `[MemoryProcessor][分析] ❌ 解析 LLM 返回的 JSON 时出错: ${parseError}`,
    );
    console.error(
      "[MemoryProcessor][分析] 📝 LLM 原始返回内容 (清洁后):",
      cleanedContent,
    );
    // 重新抛出错误，让调用者知道分析失败
    throw new Error(`解析 LLM JSON 响应失败: ${parseError.message}`);
  }

  // ---- 整理分析结果 ----
  let memoryType: MemoryType = (analysisResultJson.memory_type as MemoryType) ||
    "unknown";
  // 验证 memory_type 是否有效
  if (!getMemoryTypes().includes(memoryType)) {
    console.warn(
      `[MemoryProcessor][分析] ⚠️ LLM 返回了一个未知的 memory_type: ${memoryType}。将使用 'unknown'。`,
    );
    memoryType = "unknown";
  }
  const processedTextContent = analysisResultJson.relevant_content ||
    message.text;
  const importanceScore = analysisResultJson.importance_score ?? 2;
  const emotionalValence = analysisResultJson.emotional_valence ?? 0;
  const emotionalArousal = analysisResultJson.emotional_arousal ?? 0;
  const emotionalDimensions = analysisResultJson.emotional_dimensions ??
    { "neutral": 1 };
  const associativeTriggers = analysisResultJson.associative_triggers ?? [];

  // 简单的规则判断是否需要 embedding（例如，闲聊且不重要可能不需要）
  const requiresEmbedding = !(memoryType === "conversation_turn" &&
    importanceScore <= 2);

  // ---- 返回结构化结果 ----
  const analysisResult: MessageAnalysisResult = {
    memory_type: memoryType,
    importance_score: importanceScore,
    processed_text_content: processedTextContent,
    emotional_valence: emotionalValence,
    emotional_arousal: emotionalArousal,
    emotional_dimensions: emotionalDimensions,
    associative_triggers: associativeTriggers,
    requires_embedding: requiresEmbedding,
  };

  // ---- 记录详细的分析结果 ----
  console.log(
    `[MemoryProcessor][分析] ✅ LLM 分析结果: 类型=${analysisResult.memory_type}, 重要性=${analysisResult.importance_score}, 情感效价=${
      analysisResult.emotional_valence.toFixed(2)
    }, 情感强度=${analysisResult.emotional_arousal.toFixed(2)}, 内容='${
      analysisResult.processed_text_content.substring(0, 50)
    }...'`,
  );
  // (可选) 打印更详细的情感和触发词日志
  console.log(
    `[MemoryProcessor][分析] 🌈 情感维度: ${
      JSON.stringify(analysisResult.emotional_dimensions)
    }`,
  );
  console.log(
    `[MemoryProcessor][分析] 🔗 触发词: ${
      analysisResult.associative_triggers.join(", ")
    }`,
  );

  return analysisResult;
}

/**
 * (核心函数 - 修改版) 处理单条输入消息并存储为记忆
 * 现在调用 analyzeMessageForMemory 获取分析结果。
 *
 * @param message 输入的聊天消息对象
 * @returns Promise<void>
 * @throws 如果 LTM 存储过程中出现无法处理的错误
 */
export async function processAndStoreMessage(
  message: ChatMessageInput,
): Promise<void> {
  console.log(
    `[MemoryProcessor][存储] 🔍 开始处理消息 LTM 存储: 用户 ${message.userId} 在上下文 ${message.contextId}`,
  );

  // --- 1. 初步过滤 ---
  if (message.text.trim().length < 5) {
    console.log("[MemoryProcessor][存储] ➖ 消息过短，跳过 LTM 存储。");
    return;
  }

  let analysisResult: MessageAnalysisResult;
  try {
    // --- 2. 调用分析函数获取结果 ---
    // 注意：这里的 message.contextId 可能是原始来源 ID，LLM 分析时会用到
    analysisResult = await analyzeMessageForMemory(message);
  } catch (analysisError) {
    // 如果 LLM 分析失败，决定是否仍要存储原始信息
    console.error(
      "[MemoryProcessor][存储] ❌ LLM 分析失败，无法获取结构化信息:",
      analysisError,
    );
    // 可以选择在这里返回，或者继续存储一个标记为 'unknown' 的原始消息
    console.warn(
      "[MemoryProcessor][存储] ⚠️ 分析失败，将尝试存储原始消息（类型: unknown）。",
    );
    analysisResult = {
      memory_type: "unknown", // 标记为未知
      importance_score: 1, // 标记为不重要
      processed_text_content: message.text, // 使用原始内容
      emotional_valence: 0,
      emotional_arousal: 0,
      emotional_dimensions: { "neutral": 1 },
      associative_triggers: [],
      requires_embedding: true, // 仍然尝试生成 embedding
    };
    // 继续执行后续步骤
  }

  // --- 3. & 4. 生成 Embedding 向量 (如果需要) ---
  let vector: number[] = [];
  if (analysisResult.requires_embedding) {
    try {
      console.log("[MemoryProcessor][存储] 🤖 正在生成文本的嵌入向量...");
      vector = await embeddings.embedQuery(
        analysisResult.processed_text_content, // 使用分析后的文本
      );
      console.log(
        `[MemoryProcessor][存储] ✅ 嵌入向量生成完成，维度: ${vector.length}`,
      );
    } catch (error) {
      console.error("[MemoryProcessor][存储] ❌ 生成嵌入向量时出错:", error);
      // 向量生成失败，但可能仍然希望存储无向量的记忆点
      console.warn(
        "[MemoryProcessor][存储] ⚠️ 无法生成向量，将存储无向量的记忆点。",
      );
      // 这里不抛出错误，而是继续存储（如果你的 Qdrant 配置允许无向量的点）
      // 如果不允许，或者你认为无向量的点无意义，可以在这里抛出错误：
      // throw new Error(`无法为消息生成嵌入向量: ${error}`);
    }
  } else {
    console.log("[MemoryProcessor][存储] ℹ️ 根据分析结果，跳过生成嵌入向量。");
  }

  // --- 5. 生成唯一的 Point ID ---
  const pointId = crypto.randomUUID();

  // --- 6. 构建 MemoryPointStruct 对象 ---
  // 注意：payload 中的 source_context 应使用 RAG 上下文 ID，
  // 但此函数可能被 Worker 调用，Worker 可能只收到原始 contextId。
  // 需要确保调用此函数时传入的 contextId 是正确的 RAG ID，
  // 或者在调用端 (如 main.ts) 准备好 payload 再传递。
  // 这里暂时假设传入的 message.contextId 就是打算存储的 contextId。
  const memoryPayload: MemoryPayload = {
    memory_type: analysisResult.memory_type,
    timestamp: message.timestamp || Date.now(),
    source_user: message.userId,
    source_context: message.contextId, // 使用传入的 contextId (应为 RAG ID)
    text_content: analysisResult.processed_text_content,
    importance_score: analysisResult.importance_score,
    emotional_valence: analysisResult.emotional_valence,
    emotional_arousal: analysisResult.emotional_arousal,
    emotional_dimensions: analysisResult.emotional_dimensions,
    associative_triggers: analysisResult.associative_triggers,
    // related_ids 和 insight_metadata 可以在其他地方填充
  };

  const memoryPoint: MemoryPointStruct = {
    id: pointId,
    vector: vector, // vector 可能为空数组 []
    payload: memoryPayload,
  };

  // --- 7. 存储到 Qdrant ---
  try {
    console.log(`[MemoryProcessor][存储] 📦 正在将记忆存储到 Qdrant...`);
    await upsertMemoryPoints(config.qdrantCollectionName, [memoryPoint]);
    console.log(
      `[MemoryProcessor][存储] ✅ 记忆成功存储到 Qdrant，Point ID: ${pointId}`,
    );
  } catch (error) {
    console.error(
      "[MemoryProcessor][存储] ❌ 存储记忆到 Qdrant 时出错:",
      error,
    );
    // 抛出错误，让上层或 Worker 捕获并处理
    throw new Error(`无法存储记忆: ${error}`);
  }
}

/**
 * 辅助函数：获取所有可用的记忆类型
 */
function getMemoryTypes(): MemoryType[] {
  // 确保 MemoryType 类型定义包含了 'question'
  // 如果你的 qdrant_client.ts 中的 MemoryType 没有 'question'，请添加
  return [
    "conversation_turn",
    "fact",
    "preference",
    "task",
    "summary",
    "persona_trait",
    "joke_or_banter",
    "reflection",
    "emotional_response",
    "question", // 确保这里有 question
    "unknown",
  ];
}

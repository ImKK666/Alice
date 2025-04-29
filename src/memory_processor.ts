// src/memory_processor.ts

// 保持原有导入不变
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
 * 2. 使用 LLM 分析消息内容，提取关键信息，判断类型、重要性和情感。
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
    `[MemoryProcessor] 🔍 开始处理消息: 用户 ${message.userId} 在上下文 ${message.contextId}`,
  );

  // --- 1. (可选) 初步过滤 ---
  if (message.text.trim().length < 5) { // 示例：过滤掉小于5个字符的消息
    console.log("[MemoryProcessor] ➖ 消息过短，跳过存储。");
    return;
  }

  // --- 判断当前的人格/上下文模式 (示例) ---
  const isProfessionalContext = message.contextId.startsWith("work_") ||
    message.contextId.startsWith("DM_"); // 判断是否为工作相关或私聊
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

  // --- 2. 构建分析指令 (Prompt) 新版，包含情感分析 ---
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

{
  "memory_type": "emotional_response",
  "importance_score": 4,
  "relevant_content": "用户 ${message.userId} 对项目成功感到非常兴奋和自豪。",
  "emotional_valence": 0.9,
  "emotional_arousal": 0.8,
  "emotional_dimensions": {"joy": 0.9, "sadness": 0.0, "anger": 0.0, "fear": 0.0, "surprise": 0.3, "disgust": 0.0, "trust": 0.6, "anticipation": 0.7, "neutral": 0.1},
  "associative_triggers": ["成功", "项目", "成就", "庆祝", "兴奋"]
}

请 **只返回 JSON 对象**，不要在 JSON 前后包含任何其他文字或解释。
`;

  // 定义用于存储分析结果的变量
  let memoryType: MemoryType = "conversation_turn"; // 默认类型
  let processedTextContent = message.text; // 默认使用原文
  let importanceScore: number | undefined = 2; // 默认重要性
  let emotionalValence: number | undefined = 0; // 默认情感效价 (中性)
  let emotionalArousal: number | undefined = 0; // 默认情感唤醒度 (平静)
  let emotionalDimensions: { [key in EmotionDimension]?: number } = {
    "neutral": 1,
  }; // 默认情感维度
  let associativeTriggers: string[] | undefined = []; // 默认关联触发词
  const requiresEmbedding = true; // 默认需要生成向量

  try {
    console.log("[MemoryProcessor] 🧠 正在调用 LLM 分析消息...");
    const llmResponse = await llm.invoke(analysisPrompt);

    // 定义预期LLM返回的完整结构
    let analysisResult: {
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
      throw new Error("❌ LLM 返回了空内容。");
    }

    // 清理可能的Markdown代码块标记
    const cleanedContent = responseContent.trim().replace(
      /^```json\s*|```$/g,
      "",
    );

    try {
      // 解析JSON
      analysisResult = JSON.parse(cleanedContent);
      // 验证必要字段是否存在
      if (
        !analysisResult.memory_type ||
        analysisResult.importance_score === undefined ||
        !analysisResult.relevant_content ||
        analysisResult.emotional_valence === undefined ||
        analysisResult.emotional_arousal === undefined ||
        !analysisResult.emotional_dimensions ||
        !analysisResult.associative_triggers
      ) {
        // 如果缺少字段，抛出错误，会在下面的catch块中处理
        throw new Error(
          "❌ 解析出的 JSON 对象缺少必要的字段。",
        );
      }
    } catch (parseError) {
      // 处理JSON解析错误
      console.error(
        `[MemoryProcessor] ❌ 解析 LLM 返回的 JSON 时出错: ${parseError}`,
      );
      console.error(
        "[MemoryProcessor] 📝 LLM 原始返回内容 (清洁后):",
        cleanedContent,
      );
      console.error(
        "[MemoryProcessor] 📝 LLM 原始返回内容 (未清洁):",
        responseContent,
      );
      // 抛出更具体的错误，指明是解析失败
      throw new Error(`❌ 解析 LLM JSON 响应失败: ${parseError}`);
    }

    // 将解析结果赋值给变量
    memoryType = (analysisResult.memory_type as MemoryType) || "unknown";
    processedTextContent = analysisResult.relevant_content || message.text; // 如果内容为空，回退到原文
    importanceScore = analysisResult.importance_score ?? 2; // 使用默认值处理null或undefined
    emotionalValence = analysisResult.emotional_valence ?? 0;
    emotionalArousal = analysisResult.emotional_arousal ?? 0;
    emotionalDimensions = analysisResult.emotional_dimensions ??
      { "neutral": 1 };
    associativeTriggers = analysisResult.associative_triggers ?? [];

    // 验证 memory_type 是否有效
    if (!getMemoryTypes().includes(memoryType)) {
      console.warn(
        `[MemoryProcessor] ⚠️ LLM 返回了一个未知的 memory_type: ${memoryType}。将使用 'unknown'。`,
      );
      memoryType = "unknown";
    }

    // 记录详细的分析结果
    console.log(
      `[MemoryProcessor] ✅ LLM 分析结果: 类型=${memoryType}, 重要性=${importanceScore}, 情感效价=${
        emotionalValence.toFixed(2)
      }, 情感强度=${emotionalArousal.toFixed(2)}, 内容='${
        processedTextContent.substring(0, 50)
      }...'`,
    );
    console.log(
      `[MemoryProcessor] 🌈 情感维度分析: ${
        Object.entries(emotionalDimensions)
          .map(([emotion, score]) => `${emotion}=${score?.toFixed(2)}`) // 处理可能的 undefined score
          .join(", ")
      }`,
    );
    console.log(
      `[MemoryProcessor] 🔗 关联触发词: ${associativeTriggers.join(", ")}`,
    );
  } catch (error) {
    // 统一处理LLM调用或解析过程中的任何错误
    console.error("[MemoryProcessor] ❌ LLM 分析或解析时出错:", error);
    console.log("[MemoryProcessor] ⚠️ 将使用默认值存储原始消息。");
    // 回退到默认值
    memoryType = "conversation_turn";
    processedTextContent = message.text;
    importanceScore = 1; // 分析失败，标记为低重要性
    emotionalValence = 0;
    emotionalArousal = 0;
    emotionalDimensions = { "neutral": 1 };
    associativeTriggers = [];
  }

  // --- 3. & 4. 生成 Embedding 向量 ---
  let vector: number[] = [];
  if (requiresEmbedding) {
    try {
      console.log("[MemoryProcessor] 🤖 正在生成文本的嵌入向量...");
      vector = await embeddings.embedQuery(processedTextContent);
      console.log(
        `[MemoryProcessor] ✅ 嵌入向量生成完成，维度: ${vector.length}`,
      );
    } catch (error) {
      console.error("[MemoryProcessor] ❌ 生成嵌入向量时出错:", error);
      // 抛出错误，让上层或Worker捕获并处理
      throw new Error(`❌ 无法为消息生成嵌入向量: ${error}`);
    }
  }

  // --- 5. 生成唯一的 Point ID ---
  const pointId = crypto.randomUUID();

  // --- 6. 构建 MemoryPointStruct 对象 ---
  const memoryPayload: MemoryPayload = {
    memory_type: memoryType,
    timestamp: message.timestamp || Date.now(),
    source_user: message.userId,
    source_context: message.contextId,
    text_content: processedTextContent,
    importance_score: importanceScore,
    // 新增：情感相关字段
    emotional_valence: emotionalValence,
    emotional_arousal: emotionalArousal,
    emotional_dimensions: emotionalDimensions,
    associative_triggers: associativeTriggers,
    // related_ids 和 insight_metadata 可以在其他地方填充
  };

  const memoryPoint: MemoryPointStruct = {
    id: pointId,
    vector: vector,
    payload: memoryPayload,
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
    // 抛出错误，让上层或Worker捕获并处理
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
    "reflection", // 思维漫游产生的洞见
    "emotional_response", // 新增：情感回应类型
    "unknown",
  ];
}

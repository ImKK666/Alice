// src/main.ts (融合 social_cognition, self_concept, memory_network 的增强版)

// --- 核心依赖导入 ---
import { parse } from "https://deno.land/std@0.224.0/flags/mod.ts";
import { config } from "./config.ts";
import { type ChatMessageInput } from "./memory_processor.ts";
import { embeddings } from "./embeddings.ts";
import {
  type EmotionDimension,
  ensureCollectionExists,
  type MemoryPayload,
  type MemoryPointStruct,
  type MemoryType,
  qdrantClient,
  type Schemas,
  searchMemories,
  searchMemoriesByEmotion,
  upsertMemoryPoints,
} from "./qdrant_client.ts";
import { llm } from "./llm.ts";
import {
  type CandidateMemory,
  type RerankedMemory,
  rerankMemories,
} from "./reranker.ts";

// --- 接口模块导入 ---
import { startCli } from "./cli_interface.ts";
import { startDiscord } from "./discord_interface.ts";

// --- 进化模块导入 (保留，部分功能可能仍被直接调用) ---
import {
  type Insight,
  type InsightCollection,
  type InsightType,
  retrieveRelevantInsights,
  schedulePeriodicMindWandering,
  triggerMindWandering,
  type WanderingContext,
} from "./mind_wandering.ts";
import {
  addTimeMarker,
  analyzeConversationPace,
  calculateSubjectiveTimeElapsed,
  enhanceMemoriesWithTemporalContext,
  findRelevantTimeMarkers,
  generateTimeExpression,
  recordInteractionTimestamp,
  type TemporalContext,
  type TimeMarker,
} from "./time_perception.ts";
import { advancedHumanizeText, humanizeText } from "./human_patterns.ts";
import {
  generateBodyStateExpression,
  generateEmbodiedExpressions,
  getBodyState,
  processMessageAndUpdateState,
  processStateChangeEvent,
  StateChangeEvent,
  type VirtualPhysicalState,
} from "./virtual_embodiment.ts";
import { loadStopwordsFromFile } from "./utils.ts";

// --- 新增/修改的导入 ---
// import { // 旧的社交动态导入 (将被替换)
//   analyzeInteractionImpact,
//   getRelationshipState,
//   getRelationshipSummary,
//   type InteractionStylePreset,
//   type RelationshipState,
// } from "./social_dynamics.ts"; // 旧的社交模块
import { // 导入新的社交认知模块
  type EnhancedRelationshipState, // 使用增强的关系状态接口
  getSocialCognitionManager, // 获取社交认知管理器实例
  InteractionStylePreset, // 互动风格枚举
  RelationshipDimension, // 关系维度枚举
} from "./social_cognition.ts";
import { // 导入自我概念模块
  selfConcept, // 导入整个模块接口
  type SelfModel, // 自我模型接口
  ValueDomain, // 价值领域枚举
} from "./self_concept.ts";
import { // 导入记忆网络模块
  type MemoryActivationResult, // 记忆激活结果接口
  memoryNetwork, // 导入整个模块接口
  type MemoryRelation, // 记忆关联接口
} from "./memory_network.ts";
// import { cognitiveIntegration } from "./cognitive_integration.ts"; // 暂不引入协调中心
// import { thoughtStreams } from "./thought_streams.ts"; // 暂不替换响应逻辑

// --- 类型定义 ---
// 记忆上下文条目，增强了时间信息
interface LtmContextItem {
  id: string | number; // Qdrant ID 可能是数字或字符串
  payload: MemoryPayload;
  score?: number; // 原始相关性得分
  rerank_score?: number; // Rerank 得分
  activation_score?: number; // 记忆网络激活得分 (新增)
  source: "retrieved" | "recent" | "emotional" | "activated"; // 来源标记 (新增 'activated')
  temporal_context?: string; // 时间表达 (来自 time_perception)
  decay_factor?: number; // 记忆衰减因子 (来自 time_perception)
}
// LTM 策略类型
type LtmStrategy = "LTM_NOW" | "LTM_RECENT"; // LTM_NOW: 精确搜索+Rerank, LTM_RECENT: 获取近期

// --- STM 相关 ---
const STM_MAX_MESSAGES = 15; // 短期记忆最大消息数
export let kv: Deno.Kv | null = null; // Deno KV 实例 (用于STM和状态存储)

// --- LTM Worker ---
let ltmWorker: Worker | null = null; // 后台LTM存储Worker

// --- 状态管理 ---
const activeUserContexts = new Map<string, string[]>();

// --- 用于存储已加载停用词的全局变量 ---
let loadedStopwordsSet: Set<string> = new Set();

// --- 模块实例 ---
const socialCognition = getSocialCognitionManager(); // 获取社交认知管理器实例
const selfConceptManager = new selfConcept.SelfConceptManager(); // 创建自我概念管理器实例

// --- 初始化 STM (Deno KV) ---
async function initializeKv() {
  try {
    // --- 修改这里：指定路径 ---
    const kvPath = "./data/alice.sqlite"; // 指定存储在 data 目录下
    console.log(
      `[初始化][日志] 尝试在路径 "${kvPath}" 打开或创建 Deno KV 数据库...`,
    );
    kv = await Deno.openKv(kvPath); // <--- 在这里传入路径
    // --- 修改结束 ---
    console.log(
      `✅ STM & State Storage (Deno KV) 初始化成功。数据存储于: ${kvPath}`,
    );
  } catch (error) {
    console.error("❌ STM & State Storage (Deno KV) 初始化失败:", error);
    console.warn("⚠️ STM 和状态存储功能将被禁用。");
  }
}

// --- 初始化 LTM Worker ---
function initializeLtmWorker() {
  try {
    ltmWorker = new Worker(new URL("./ltm_worker.ts", import.meta.url).href, {
      type: "module",
    });
    console.log("✅ LTM Worker 初始化成功。");
    ltmWorker.onerror = (e) => {
      console.error(`❌ LTM Worker 遇到错误: ${e.message}`);
      e.preventDefault();
    };
    ltmWorker.onmessage = (e) => {
      // 处理来自 Worker 的成功或失败消息
      if (e.data?.status === "success") {
        console.log(
          `[LTM Worker][日志] ✅ 消息 LTM 存储成功 (用户: ${e.data.userId}, RAG 上下文: ${e.data.contextId}, 原始来源: ${e.data.originalSourceContextId}, 耗时: ${e.data.duration}s)`,
        );
      } else if (e.data?.status === "error") {
        console.error(
          `[LTM Worker][日志] ❌ 消息 LTM 存储失败 (用户: ${e.data.userId}, RAG 上下文: ${e.data.contextId}, 原始来源: ${e.data.originalSourceContextId}): ${e.data.error}`,
        );
      } else {
        console.log(`[LTM Worker][日志] 收到消息: ${JSON.stringify(e.data)}`);
      }
    };
    ltmWorker.onmessageerror = (e) => {
      console.error("[LTM Worker][日志] 接收消息出错:", e);
    };
  } catch (error) {
    console.error("❌ LTM Worker 初始化失败:", error);
    console.warn("⚠️ LTM 后台处理将被禁用。");
  }
}

// --- STM 相关函数 (保持不变) ---
/** 获取指定上下文的STM历史 */
export async function getStm(contextId: string): Promise<ChatMessageInput[]> {
  if (!kv) {
    console.warn("[STM][日志] KV 未初始化，无法获取 STM。");
    return [];
  }
  try {
    const key = ["stm", contextId];
    const result = await kv.get<ChatMessageInput[]>(key);
    console.log(
      `[STM][调试] 从 KV 读取 STM (上下文 ${contextId})，找到 ${
        result.value?.length ?? 0
      } 条记录。`,
    );
    return result.value ?? [];
  } catch (error) {
    console.error(`❌ [STM][错误] 读取 STM 出错 (上下文 ${contextId}):`, error);
    return [];
  }
}

/** 更新指定上下文的STM，使用原子操作处理并发 */
async function updateStm(
  contextId: string,
  newMessage: ChatMessageInput,
): Promise<ChatMessageInput[]> {
  if (!kv) {
    console.warn("[STM][日志] KV 未初始化，无法更新 STM。");
    return [newMessage];
  }
  const key = ["stm", contextId];
  let finalStm: ChatMessageInput[] = [newMessage]; // 默认至少包含新消息
  console.log(
    `[STM][调试] 准备更新 STM (上下文 ${contextId})，新消息: ${
      newMessage.text.substring(0, 30)
    }...`,
  );

  try {
    let success = false;
    // 重试机制，处理可能的版本冲突
    for (let i = 0; i < 3 && !success; i++) {
      const getResult = await kv.get<ChatMessageInput[]>(key);
      const currentStm = getResult.value ?? [];
      const currentVersionstamp = getResult.versionstamp; // 用于原子性检查
      console.log(
        `[STM][调试] 原子更新尝试 ${
          i + 1
        }: 当前版本戳 ${currentVersionstamp}, 当前记录数 ${currentStm.length}`,
      );

      // 创建包含新消息但不超过限制的历史记录
      const combinedStm = [...currentStm, newMessage];
      const prunedStm = combinedStm.slice(-STM_MAX_MESSAGES); // 保留最新的 N 条
      finalStm = prunedStm; // 更新函数范围内的 finalStm，以便出错时返回
      console.log(
        `[STM][调试] 原子更新尝试 ${i + 1}: 更新后记录数 ${prunedStm.length}`,
      );

      const atomicOp = kv.atomic()
        .check({ key: key, versionstamp: currentVersionstamp }) // 检查版本
        .set(key, prunedStm); // 设置新值

      const commitResult = await atomicOp.commit();

      if (commitResult.ok) {
        success = true;
        console.log(`[STM][日志] ✅ STM 原子更新成功 (上下文 ${contextId})。`);
      } else {
        console.warn(
          `[STM][日志] ⚠️ STM 更新冲突 (上下文 ${contextId})，尝试次数 ${
            i + 1
          }。正在重试...`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, Math.random() * 50 + 20)
        );
      }
    }
    if (!success) {
      console.error(
        `❌ [STM][错误] STM 更新失败 (上下文 ${contextId})，已达最大尝试次数。返回内存中的状态。`,
      );
    }
    return finalStm;
  } catch (error) {
    console.error(
      `❌ [STM][错误] STM 原子更新出错 (上下文 ${contextId}):`,
      error,
    );
    return finalStm; // 出错时返回当前内存中的状态
  }
}

// --- 辅助函数 ---

/** 更新活跃用户上下文映射 (保持不变) */
function updateActiveUserContexts(userId: string, contextId: string): void {
  const userContexts = activeUserContexts.get(userId) || [];
  if (!userContexts.includes(contextId)) {
    userContexts.push(contextId);
    if (userContexts.length > 10) {
      userContexts.shift();
    }
  } else {
    userContexts.splice(userContexts.indexOf(contextId), 1);
    userContexts.push(contextId);
  }
  activeUserContexts.set(userId, userContexts);
  console.log(
    `[辅助][调试] 更新活跃用户上下文: User ${userId} -> Contexts [${
      userContexts.join(", ")
    }]`,
  );
}

/** 获取上次思维漫游时间 (保持不变) */
export async function getLastWanderingTime(
  userId: string,
  contextId: string, // 这里应该是 RAG Context ID
): Promise<number> {
  if (!kv) return 0;
  const key = ["last_wandering_time", userId, contextId];
  try {
    const result = await kv.get<number>(key);
    // console.log(`[辅助][调试] 获取上次漫游时间 (用户 ${userId}, 上下文 ${contextId}): ${result.value || 0}`);
    return result.value || 0;
  } catch (error) {
    console.error(
      `❌ [辅助][错误] 获取用户 ${userId} 在上下文 ${contextId} 的上次漫游时间失败:`,
      error,
    );
    return 0;
  }
}

/** 设置上次思维漫游时间 (保持不变) */
export async function setLastWanderingTime(
  userId: string,
  contextId: string, // 这里应该是 RAG Context ID
  timestamp: number,
): Promise<void> {
  if (!kv) return;
  const key = ["last_wandering_time", userId, contextId];
  try {
    await kv.set(key, timestamp);
    console.log(
      `[辅助][日志] 设置用户 ${userId} 在上下文 ${contextId} 的上次漫游时间为 ${
        new Date(timestamp).toLocaleTimeString()
      }`,
    );
  } catch (error) {
    console.error(
      `❌ [辅助][错误] 设置用户 ${userId} 在上下文 ${contextId} 的上次漫游时间失败:`,
      error,
    );
  }
}

/** 提取最近话题 (保持不变) */
export function extractRecentTopics(history: ChatMessageInput[]): string[] {
  if (history.length === 0) return [];
  const recentMessages = history.slice(-5); // 取最近5条
  const topics = new Set<string>();

  for (const msg of recentMessages) {
    const words = msg.text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, "") // 移除非字母、数字、空格
      .split(/\s+/)
      .filter((word) => word.length > 1 && !loadedStopwordsSet.has(word)); // <-- 使用加载的集合
    words.forEach((word) => topics.add(word));
  }
  const extractedTopics = Array.from(topics).slice(0, 10);
  // console.log(`[辅助][调试] 提取到最近话题: [${extractedTopics.join(', ')}]`);
  return extractedTopics;
}

/** 分析消息情感状态 (保持不变) */
async function analyzeMessageSentiment(text: string): Promise<{
  valence: number;
  arousal: number;
  emotionDimensions: { [key in EmotionDimension]?: number };
  dominant_emotion?: string; // 添加主导情绪字段
}> {
  const sentimentPrompt = `
分析以下文本的情感状态:
"${text}"

只返回一个简洁的 JSON 对象，包含以下内容：
1. "valence": 情感效价，从 -1.0 (极度负面) 到 1.0 (极度正面)，0.0 表示中性
2. "arousal": 情感唤醒度/强度，从 0.0 (完全平静) 到 1.0 (极度强烈)
3. "emotions": 一个对象，包含以下情感维度的得分 (0.0-1.0，所有维度都给分，不相关的给0)：
   "joy", "sadness", "anger", "fear", "surprise", "disgust", "trust", "anticipation", "neutral"

示例：
{"valence": 0.7, "arousal": 0.5, "emotions": {"joy": 0.8, "sadness": 0.0, "anger": 0.0, "fear": 0.0, "surprise": 0.2, "disgust": 0.0, "trust": 0.5, "anticipation": 0.6, "neutral": 0.1}}
`;

  try {
    const response = await llm.invoke(sentimentPrompt);
    const responseContent = typeof response === "string"
      ? response
      : (response.content as string);
    if (!responseContent) {
      console.warn("[辅助][日志] 情感分析 LLM 返回空内容，使用默认值。");
      throw new Error("LLM returned empty content");
    }
    const cleanedContent = responseContent.trim().replace(/```json|```/g, "");
    const sentimentData = JSON.parse(cleanedContent);

    const emotions = sentimentData.emotions || { "neutral": 1.0 };
    const valence = typeof sentimentData.valence === "number"
      ? sentimentData.valence
      : 0;
    const arousal = typeof sentimentData.arousal === "number"
      ? sentimentData.arousal
      : 0;
    const dominantEmotion = getDominantEmotion(emotions);

    const result = {
      valence: Math.max(-1, Math.min(1, valence)), // 限制范围
      arousal: Math.max(0, Math.min(1, arousal)), // 限制范围
      emotionDimensions: emotions,
      dominant_emotion: dominantEmotion,
    };
    // console.log(`[辅助][调试] 情感分析结果:`, result);
    return result;
  } catch (error) {
    console.error("❌ [辅助][错误] 情感分析失败:", error);
    return { // 返回默认中性情感
      valence: 0,
      arousal: 0,
      emotionDimensions: { "neutral": 1.0 },
      dominant_emotion: "neutral",
    };
  }
}

/** 获取情感维度中得分最高的情感 (保持不变) */
function getDominantEmotion(
  emotionDimensions: { [key in string]?: number },
): string {
  let maxScore = -1;
  let dominantEmotion = "neutral"; // 默认中性

  for (const [emotion, score] of Object.entries(emotionDimensions)) {
    if (typeof score === "number" && score > maxScore) {
      if (
        emotion !== "neutral" || Object.keys(emotionDimensions).length === 1
      ) {
        maxScore = score;
        dominantEmotion = emotion;
      } else if (dominantEmotion === "neutral" && emotion === "neutral") {
        maxScore = score;
      }
    }
  }
  if (maxScore < 0.3 && dominantEmotion !== "neutral") {
    return "neutral";
  }
  return dominantEmotion;
}

// --- 核心 RAG 逻辑 ---

/**
 * 步骤 0: 自动判断当前 RAG 上下文 (保持不变)
 */
async function determineCurrentContext(
  userId: string,
  previousRagContextId: string,
  stmHistory: ChatMessageInput[],
  newMessage: ChatMessageInput,
  sourceContextId: string, // <-- 传入原始来源 ID
): Promise<string> {
  console.log(
    `▶️ [ContextDetect][日志] 开始判断场景 (先前 RAG 上下文: ${previousRagContextId}, 原始来源: ${sourceContextId})...`,
  );

  let sourceType = "unknown";
  let baseIdentifier = sourceContextId;
  let sourcePrefix = "";

  if (sourceContextId.startsWith("discord_channel_")) {
    sourceType = "dchan";
    sourcePrefix = "discord_channel_";
    baseIdentifier = sourceContextId.substring(sourcePrefix.length);
  } else if (sourceContextId.startsWith("discord_dm_")) {
    sourceType = "ddm";
    sourcePrefix = "discord_dm_";
    baseIdentifier = sourceContextId.substring(sourcePrefix.length);
  } else if (sourceContextId.startsWith("cli_")) {
    sourceType = "cli";
    sourcePrefix = "cli_";
    baseIdentifier = sourceContextId.substring(sourcePrefix.length);
  } else {
    const parts = previousRagContextId.split("_");
    if (parts.length >= 3) {
      const potentialType = parts[parts.length - 2];
      const potentialId = parts[parts.length - 1];
      if (
        ["dchan", "ddm", "cli", "unknown"].includes(potentialType) &&
        potentialId
      ) {
        sourceType = potentialType;
        baseIdentifier = potentialId;
        sourcePrefix = previousRagContextId.substring(
          0,
          previousRagContextId.length - potentialType.length -
            potentialId.length - 2,
        ) + "_";
        console.log(
          `   [ContextDetect][调试] 从先前 RAG ID (${previousRagContextId}) 恢复来源: 类型=${sourceType}, 标识符=${baseIdentifier}`,
        );
      } else {
        console.log(
          `   [ContextDetect][调试] 未能从原始来源 (${sourceContextId}) 或先前 RAG ID 解析出明确类型，将使用 'unknown' 类型。`,
        );
        baseIdentifier = userId;
        sourceType = "unknown";
        sourcePrefix = "unknown_";
      }
    } else {
      console.log(
        `   [ContextDetect][调试] 未能从原始来源 (${sourceContextId}) 或先前 RAG ID 解析出明确类型，将使用 'unknown' 类型。`,
      );
      baseIdentifier = userId;
      sourceType = "unknown";
      sourcePrefix = "unknown_";
    }
  }
  console.log(
    `   [ContextDetect][调试] 解析到来源基础: 类型=${sourceType}, 标识符=${baseIdentifier}`,
  );

  const historySnippet = stmHistory
    .slice(-5)
    .map((msg) =>
      `${msg.userId === userId ? "You" : msg.userId.substring(0, 4)}: ${
        msg.text.substring(0, 50)
      }...`
    )
    .join("\n");

  const classificationPrompt = `
Analyze the latest user message in the context of recent conversation history.
Classify the primary topic/context. Choose ONE category: [Casual Chat, Work Task/Project, Info Query, Scheduling, Philosophical Discussion, Emotional Support, Other].
If the category is "Work Task/Project", identify the specific project identifier/code if clearly mentioned in the LATEST message (e.g., "项目A", "客户B", "045号任务"). Focus ONLY on the latest message for identifiers.
If the category is "Emotional Support", note the primary emotion if obvious from the LATEST message.

Recent History (last few turns):
${historySnippet || "(无历史记录)"}
Latest User Message (${userId.substring(0, 4)}): ${newMessage.text}

Output Format: Respond ONLY with the category, optionally followed by a colon and the specific detail (project identifier or emotion). Keep details concise. Examples:
Casual Chat
Work Task/Project: 项目A
Info Query
Scheduling
Philosophical Discussion
Emotional Support: sadness
Other

Category:`;

  let newContextId = `${sourceType}_${baseIdentifier}`; // 默认ID基于原始来源
  try {
    const response = await llm.invoke(classificationPrompt, {
      temperature: 0.3,
    });
    const classificationResult =
      (typeof response === "string" ? response : (response.content as string))
        ?.trim();
    console.log(
      `   [ContextDetect][调试] LLM 分类结果: "${
        classificationResult || "(空)"
      }"`,
    );

    if (classificationResult) {
      const lowerResult = classificationResult.toLowerCase();
      let prefix = "other";

      if (lowerResult.startsWith("casual chat")) {
        prefix = "casual";
      } else if (lowerResult.startsWith("work task/project")) {
        const parts = classificationResult.split(":");
        const identifier = parts.length > 1
          ? parts[1].trim().replace(/[\s/\\?%*:|"<>#]/g, "_")
          : null;
        if (identifier && identifier.length > 0 && identifier.length < 30) {
          newContextId = `work_project_${identifier}`;
          console.log(
            `   [ContextDetect][日志] 识别到特定工作项目: ${identifier}`,
          );
          prefix = ""; // 标记为特殊格式
        } else {
          prefix = "work";
        }
      } else if (lowerResult.startsWith("info query")) {
        prefix = "info";
      } else if (lowerResult.startsWith("scheduling")) {
        prefix = "sched";
      } else if (lowerResult.startsWith("philosophical discussion")) {
        prefix = "philo";
      } else if (lowerResult.startsWith("emotional support")) {
        const parts = classificationResult.split(":");
        const emotion = parts.length > 1
          ? parts[1].trim().toLowerCase().replace(/[\s/\\?%*:|"<>#]/g, "_")
          : "general";
        prefix = `emo_${emotion.substring(0, 10)}`;
      } else if (lowerResult.startsWith("other")) {
        prefix = "other";
      }

      if (prefix) {
        const shortBaseId = baseIdentifier.length > 18
          ? baseIdentifier.substring(baseIdentifier.length - 18)
          : baseIdentifier;
        newContextId = `${prefix}_${sourceType}_${shortBaseId}`;
      }
    } else {
      console.warn(
        "   [ContextDetect][日志] LLM 未返回有效分类，将使用基于原始来源的默认上下文。",
      );
      const shortBaseId = baseIdentifier.length > 18
        ? baseIdentifier.substring(baseIdentifier.length - 18)
        : baseIdentifier;
      newContextId = `unknown_${sourceType}_${shortBaseId}`;
    }
  } catch (error) {
    console.error(
      "❌ [ContextDetect][错误] 调用 LLM 进行上下文分类时出错:",
      error,
    );
    console.log(
      "   [ContextDetect][日志] ⚠️ 上下文分类失败，将使用基于原始来源的默认上下文。",
    );
    const shortBaseId = baseIdentifier.length > 18
      ? baseIdentifier.substring(baseIdentifier.length - 18)
      : baseIdentifier;
    newContextId = `error_${sourceType}_${shortBaseId}`;
  }

  if (newContextId !== previousRagContextId) {
    console.log(
      `   [ContextDetect][日志] 💡 RAG 上下文切换/确定: "${newContextId}" (来自先前: "${previousRagContextId}")`,
    );
  } else {
    if (
      previousRagContextId.split("_").length > 3 &&
      !previousRagContextId.startsWith("work_project_")
    ) {
      const shortBaseId = baseIdentifier.length > 18
        ? baseIdentifier.substring(baseIdentifier.length - 18)
        : baseIdentifier;
      newContextId = `default_${sourceType}_${shortBaseId}`;
      console.log(
        `   [ContextDetect][日志] ⚠️ 先前 RAG ID (${previousRagContextId}) 结构复杂，已强制简化为: "${newContextId}"`,
      );
    } else {
      console.log(
        `   [ContextDetect][调试] RAG 上下文保持为: "${previousRagContextId}"`,
      );
    }
  }
  return newContextId;
}

/** 步骤 1: 决定 LTM 策略 (保持不变) */
async function decideLtmStrategy(
  ragContextId: string, // 使用已确定的 RAG 上下文 ID
): Promise<LtmStrategy> {
  console.log(
    `▶️ [LTM Strategy][日志] 决定 LTM 策略 (RAG 上下文: ${ragContextId})...`,
  );

  if (ragContextId.startsWith("work_")) {
    console.log(
      "   [LTM Strategy][调试] -> 工作上下文，使用精确检索 (LTM_NOW)",
    );
    return "LTM_NOW";
  } else if (ragContextId.startsWith("info_")) {
    console.log(
      "   [LTM Strategy][调试] -> 信息查询上下文，使用精确检索 (LTM_NOW)",
    );
    return "LTM_NOW";
  } else if (ragContextId.startsWith("philo_")) {
    console.log(
      "   [LTM Strategy][调试] -> 哲学讨论上下文，使用精确检索 (LTM_NOW)",
    );
    return "LTM_NOW";
  } else if (
    ragContextId.startsWith("casual_") ||
    ragContextId.startsWith("sched_") ||
    ragContextId.startsWith("emo_") ||
    ragContextId.startsWith("other_") ||
    ragContextId.startsWith("unknown_") ||
    ragContextId.startsWith("error_") ||
    ragContextId.startsWith("default_")
  ) {
    const contextType = ragContextId.split("_")[0];
    console.log(
      `   [LTM Strategy][调试] -> ${contextType} 上下文，使用近期记忆 (LTM_RECENT)`,
    );
    return "LTM_RECENT";
  } else {
    console.log(
      `   [LTM Strategy][日志] -> 未知或默认上下文 (${ragContextId})，使用近期记忆 (LTM_RECENT)`,
    );
    return "LTM_RECENT";
  }
}

/** 步骤 3: 根据策略检索 LTM (增强版 - 集成记忆网络) */
async function retrieveLtmBasedOnStrategy(
  strategy: LtmStrategy,
  message: ChatMessageInput, // 包含 RAG Context ID
  messageSentiment: {
    valence: number;
    arousal: number;
    emotionDimensions: { [key in EmotionDimension]?: number };
  },
): Promise<LtmContextItem[]> {
  const contextId = message.contextId; // 使用 RAG Context ID
  const retrievedItems: LtmContextItem[] = []; // 存储同步检索结果
  console.log(
    `▶️ [LTM Retrieve][日志] 根据策略 "${strategy}" 检索 LTM (RAG 上下文: ${contextId})...`,
  );

  let initialMemories: Array<
    Schemas["ScoredPoint"] & { payload: MemoryPayload }
  > = [];
  let seedMemoryIds: string[] = []; // 用于记忆网络激活

  // --- 分支：根据策略执行不同的检索方法 ---
  if (strategy === "LTM_NOW") {
    try {
      console.log(
        `   [LTM Retrieve][调试] -> 🔍 精确向量搜索 (RAG 上下文: ${contextId})...`,
      );
      const searchVector = await embeddings.embedQuery(message.text);
      const baseFilter: Schemas["Filter"] = {
        must: [{ key: "source_context", match: { value: contextId } }],
      };
      initialMemories = await searchMemories(
        config.qdrantCollectionName,
        searchVector,
        config.ragInitialRetrievalLimit,
        baseFilter,
      );
      console.log(
        `   [LTM Retrieve][调试] 初始向量搜索找到 ${initialMemories.length} 条结果 (上下文: ${contextId})。`,
      );
      seedMemoryIds = initialMemories.slice(0, 2).map((m) => m.id.toString()); // 取最相关的1-2个作为种子

      const candidateMemories: CandidateMemory[] = initialMemories.map(
        (mem) => ({
          id: mem.id.toString(),
          score: mem.score,
          payload: mem.payload as MemoryPayload,
        }),
      );

      if (candidateMemories.length > 0) {
        console.log("   [LTM Retrieve][调试] -> 🔄 执行 LTM 重排序...");
        const rerankedMemories: RerankedMemory[] = await rerankMemories(
          message.text,
          candidateMemories,
        );
        console.log(
          `   [LTM Retrieve][调试] 重排序后得到 ${rerankedMemories.length} 条结果。`,
        );

        if (rerankedMemories.length > 0) {
          console.log(
            "   [LTM Retrieve][调试] -> ✅ 重排序成功，使用重排序的结果。",
          );
          const emotionallyEnhancedMemories = enhanceMemoriesWithEmotion(
            rerankedMemories.map((m) => ({ ...m, score: m.rerank_score })),
            messageSentiment,
          ).map((m) => ({ ...m, rerank_score: m.score }));

          retrievedItems.push(
            ...emotionallyEnhancedMemories
              .slice(0, config.ragRerankTopN)
              .map((mem): LtmContextItem => ({
                id: mem.id,
                payload: mem.payload,
                rerank_score: mem.rerank_score,
                source: "retrieved",
              })),
          );
        } else {
          console.warn(
            "   [LTM Retrieve][日志] -> ⚠️ 重排序失败或无结果，退回到初始向量搜索结果。",
          );
          const emotionallyEnhancedInitial = enhanceMemoriesWithEmotion(
            initialMemories.map((m) => ({
              id: m.id.toString(),
              score: m.score,
              payload: m.payload,
            })),
            messageSentiment,
          );
          retrievedItems.push(
            ...emotionallyEnhancedInitial
              .slice(0, config.ragFallbackTopN)
              .map((mem): LtmContextItem => ({
                id: mem.id,
                payload: mem.payload,
                score: mem.score,
                source: "retrieved",
              })),
          );
        }
      } else {
        console.log("   [LTM Retrieve][调试] -> ℹ️ 初始向量搜索无结果。");
      }

      await supplementWithEmotionalMemories(
        retrievedItems,
        message,
        searchVector,
        contextId,
        messageSentiment,
      );
    } catch (error) {
      console.error(
        `❌ [LTM Retrieve][错误] LTM_NOW 检索过程中出错 (${contextId}):`,
        error instanceof Error ? error.message : error,
        error,
      );
    }
  } else if (strategy === "LTM_RECENT") {
    try {
      console.log(
        `   [LTM Retrieve][调试] -> 🕒 获取最近 ${config.ragRecentLtmLimit} 条 LTM (RAG 上下文: ${contextId})...`,
      );
      const scrollResult = await qdrantClient.scroll(
        config.qdrantCollectionName,
        {
          limit: config.ragRecentLtmLimit * 3,
          with_payload: true,
          with_vector: false,
          filter: {
            must: [{ key: "source_context", match: { value: contextId } }],
          },
        },
      );
      console.log(
        `   [LTM Retrieve][调试] 最近记忆滚动查询找到 ${scrollResult.points.length} 个点 (上下文: ${contextId})。`,
      );
      initialMemories = scrollResult.points as any; // Store scrolled points
      seedMemoryIds = initialMemories.slice(0, 2).map((m) => m.id.toString()); // 取最近的1-2个作为种子

      if (scrollResult.points.length > 0) {
        scrollResult.points.sort((a, b) =>
          (b.payload?.timestamp as number || 0) -
          (a.payload?.timestamp as number || 0)
        );

        const emotionallyEnhancedPoints = enhanceMemoriesWithEmotion(
          scrollResult.points.map((p) => ({
            id: p.id.toString(),
            score: p.payload?.timestamp || 0,
            payload: p.payload as MemoryPayload,
          })),
          messageSentiment,
        );

        retrievedItems.push(
          ...emotionallyEnhancedPoints
            .slice(0, config.ragRecentLtmLimit)
            .map((mem): LtmContextItem => ({
              id: mem.id,
              payload: mem.payload,
              source: "recent",
            })),
        );
        console.log(
          `   [LTM Retrieve][调试] -> ✅ 获取并情感增强排序了 ${retrievedItems.length} 条最近记忆。`,
        );
      } else {
        console.log(
          `   [LTM Retrieve][日志] -> ℹ️ 在 RAG 上下文 ${contextId} 中未找到最近的 LTM。`,
        );
      }

      const searchVector = await embeddings.embedQuery(message.text);
      await supplementWithEmotionalMemories(
        retrievedItems,
        message,
        searchVector,
        contextId,
        messageSentiment,
      );
    } catch (error) {
      console.error(
        `❌ [LTM Retrieve][错误] LTM_RECENT 检索过程中出错 (${contextId}):`,
        error instanceof Error ? error.message : error,
        error,
      );
    }
  }

  // --- **记忆网络激活整合** ---
  if (seedMemoryIds.length > 0) {
    console.log(
      `   [LTM Retrieve][调试] -> 🕸️ 开始记忆网络激活 (种子: ${
        seedMemoryIds.join(", ")
      })...`,
    );
    try {
      // 调用记忆网络激活函数
      const activationResult = await memoryNetwork.activateMemoryNetwork(
        seedMemoryIds[0], // 优先使用第一个种子
        2, // 激活深度
        0.4, // 最小激活强度阈值
      );

      console.log(
        `   [LTM Retrieve][调试] -> 🕸️ 记忆网络激活完成，激活了 ${activationResult.activatedMemories.length} 个记忆。`,
      );

      if (activationResult.activatedMemories.length > 0) {
        const existingIds = new Set(retrievedItems.map((item) => item.id));
        const activatedLtmItems: LtmContextItem[] = activationResult
          .activatedMemories
          .filter((actMem) =>
            !existingIds.has(actMem.memoryId) &&
            actMem.memoryId !== seedMemoryIds[0]
          ) // 过滤掉种子和已有的
          .map((actMem) => ({
            id: actMem.memoryId,
            payload: actMem.payload,
            activation_score: actMem.activationStrength,
            source: "activated" as "activated", // 明确类型
          }));

        console.log(
          `   [LTM Retrieve][调试] -> 🕸️ 新增 ${activatedLtmItems.length} 条来自记忆网络的记忆。`,
        );
        // 合并到 retrievedItems
        retrievedItems.push(...activatedLtmItems);
      }
    } catch (networkError) {
      console.error(
        `❌ [LTM Retrieve][错误] 调用记忆网络时出错:`,
        networkError,
      );
    }
  } else {
    console.log("   [LTM Retrieve][调试] -> 🕸️ 无种子记忆，跳过记忆网络激活。");
  }

  // --- 补充通用对话记忆 (逻辑保持不变) ---
  const needsSupplement = retrievedItems.length < config.ragMaxMemoriesInPrompt;
  const supplementLimit = config.ragMaxMemoriesInPrompt - retrievedItems.length;

  if (needsSupplement && supplementLimit > 0) {
    console.log(
      `   [LTM Retrieve][调试] -> ℹ️ (${strategy})结果不足 ${config.ragMaxMemoriesInPrompt} 条，尝试补充通用相关记忆 (不过滤上下文)...`,
    );
    try {
      const searchVector = await embeddings.embedQuery(message.text);
      const existingIds = retrievedItems.map((item) => item.id);
      const supplementFilter: Schemas["Filter"] = existingIds.length > 0
        ? { must_not: [{ has_id: existingIds }] }
        : {};
      console.log(
        `   [LTM Retrieve][调试] 补充搜索过滤器: ${
          JSON.stringify(supplementFilter)
        }`,
      );

      const supplementMemories = await searchMemories(
        config.qdrantCollectionName,
        searchVector,
        supplementLimit,
        supplementFilter,
      );
      console.log(
        `   [LTM Retrieve][调试] 补充搜索找到 ${supplementMemories.length} 条结果。`,
      );

      if (supplementMemories.length > 0) {
        retrievedItems.push(
          ...supplementMemories.map((mem): LtmContextItem => ({
            id: mem.id.toString(),
            payload: mem.payload as MemoryPayload,
            score: mem.score,
            source: "retrieved",
          })),
        );
        console.log(
          `   [LTM Retrieve][调试] -> ✅ 补充了 ${supplementMemories.length} 条通用记忆。`,
        );
      } else {
        console.log("   [LTM Retrieve][调试] -> ℹ️ 未找到可补充的通用记忆。");
      }
    } catch (error) {
      console.error(
        `❌ [LTM Retrieve][错误] 补充通用记忆时出错:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  // --- 最终限制、排序和去重 ---
  retrievedItems.sort((a, b) => {
    // 优先考虑 rerank score, 其次是 activation score, 最后是原始 score, 再是时间戳
    const scoreA = a.rerank_score ?? a.activation_score ?? a.score ?? -Infinity;
    const scoreB = b.rerank_score ?? b.activation_score ?? b.score ?? -Infinity;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return (b.payload.timestamp || 0) - (a.payload.timestamp || 0);
  });

  const uniqueItems = retrievedItems.filter((item, index, self) =>
    index === self.findIndex((t) => t.id === item.id)
  );
  const finalItems = uniqueItems.slice(0, config.ragMaxMemoriesInPrompt);

  // --- 为最终结果添加时间上下文和衰减因子 (保持不变) ---
  const finalItemsWithTemporal = await enhanceMemoriesWithTemporalContext(
    finalItems,
    message.userId,
    contextId, // Use RAG context ID here for temporal context relevant to the RAG flow
    kv,
  );

  console.log(
    `   [LTM Retrieve][调试] 最终 LTM 列表 (共 ${finalItemsWithTemporal.length} 条，已排序/去重/时间增强/记忆网络增强):`,
  );
  finalItemsWithTemporal.forEach((item, idx) => {
    const scoreDisplay = item.rerank_score?.toFixed(4) ??
      item.activation_score?.toFixed(4) ??
      item.score?.toFixed(4) ?? "N/A";
    console.log(
      `     [${
        idx + 1
      }] ID: ${item.id}, Src: ${item.source}, Score: ${scoreDisplay}, Time: ${
        item.temporal_context || "N/A"
      }, Decay: ${
        item.decay_factor?.toFixed(2) ?? "N/A"
      }, Type: ${item.payload.memory_type}`,
    );
  });

  console.log(
    `✅ [LTM Retrieve][日志] LTM 检索完成，最终返回 ${finalItemsWithTemporal.length} 条记忆 (策略: ${strategy})。`,
  );
  return finalItemsWithTemporal;
}

/** 辅助函数：补充情感相关记忆 (保持不变) */
async function supplementWithEmotionalMemories(
  retrievedItems: LtmContextItem[],
  message: ChatMessageInput, // Contains RAG Context ID
  searchVector: number[],
  contextId: string, // RAG Context ID
  messageSentiment: {
    valence: number;
    arousal: number;
    emotionDimensions: { [key in EmotionDimension]?: number };
  },
): Promise<void> {
  const needsSupplement = retrievedItems.length < config.ragMaxMemoriesInPrompt;
  const supplementLimit = config.ragMaxMemoriesInPrompt - retrievedItems.length;

  if (needsSupplement && supplementLimit > 0 && config.timePerception.enabled) {
    console.log("   [LTM Retrieve][调试] -> 🌈 尝试补充情感相关记忆...");
    try {
      const valenceRange: [number, number] = messageSentiment.valence > 0.3
        ? [0.3, 1.0]
        : messageSentiment.valence < -0.3
        ? [-1.0, -0.3]
        : [-0.3, 0.3];
      const arousalRange: [number, number] = messageSentiment.arousal > 0.6
        ? [0.6, 1.0]
        : [0, 0.6];
      const dominantEmotion = getDominantEmotion(
        messageSentiment.emotionDimensions,
      );

      const existingIds = new Set(retrievedItems.map((item) => item.id));
      const emotionFilterBase: Schemas["Filter"] = {
        must: [
          { key: "source_context", match: { value: contextId } },
        ],
        must_not: existingIds.size > 0
          ? [{ has_id: Array.from(existingIds) }]
          : undefined,
      };

      const emotionalMemories = await searchMemoriesByEmotion(
        config.qdrantCollectionName,
        searchVector,
        supplementLimit,
        {
          valenceRange,
          arousalRange,
          dominantEmotion,
          contextFilter: contextId,
          minimumScore: 0.5,
        },
      );

      const newEmotionalMemories = emotionalMemories.filter(
        (mem) => !existingIds.has(mem.id.toString()),
      );

      if (newEmotionalMemories.length > 0) {
        console.log(
          `   [LTM Retrieve][调试] -> ✨ 补充了 ${newEmotionalMemories.length} 条情感相关记忆。`,
        );
        retrievedItems.push(
          ...newEmotionalMemories.map((mem): LtmContextItem => ({
            id: mem.id.toString(),
            payload: mem.payload as MemoryPayload,
            score: mem.score,
            source: "emotional",
          })),
        );
      } else {
        console.log("   [LTM Retrieve][调试] -> ℹ️ 未找到可补充的情感记忆。");
      }
    } catch (emotionalError) {
      console.error(
        "   [LTM Retrieve][错误] -> ❌ 补充情感记忆时出错:",
        emotionalError,
      );
    }
  }
}

/** 辅助函数：基于情感状态增强记忆列表排序 (保持不变) */
function enhanceMemoriesWithEmotion<
  T extends { id: string | number; score?: number; payload: MemoryPayload },
>(
  memories: T[],
  messageSentiment: {
    valence: number;
    arousal: number;
    emotionDimensions: { [key in EmotionDimension]?: number };
  },
): T[] {
  if (!config.timePerception.enabled || memories.length === 0) return memories;

  const scoredMemories = memories.map((memory) => {
    const emotionalMatch = calculateEmotionalMatch(
      memory.payload,
      messageSentiment,
    );
    const originalScore = memory.score ?? 0;
    const emotionalWeight = 0.3;
    const baseScore = Math.max(0, originalScore);
    const boostFactor = 1 + (emotionalMatch - 0.5) * 0.4;
    const adjustedScore = originalScore * boostFactor;

    return { ...memory, score: adjustedScore };
  });

  return scoredMemories.sort((a, b) =>
    (b.score ?? -Infinity) - (a.score ?? -Infinity)
  );
}

/** 辅助函数：计算两个情感状态之间的匹配度 (保持不变) */
function calculateEmotionalMatch(
  memoryPayload: MemoryPayload,
  messageSentiment: {
    valence: number;
    arousal: number;
    emotionDimensions: { [key in EmotionDimension]?: number };
  },
): number {
  const memValence = memoryPayload.emotional_valence;
  const memArousal = memoryPayload.emotional_arousal;
  const memDimensions = memoryPayload.emotional_dimensions;

  if (memValence === undefined || memArousal === undefined || !memDimensions) {
    return 0.5; // Neutral match if no data
  }

  const valenceMatch = 1 - Math.abs(memValence - messageSentiment.valence) / 2;
  const arousalMatch = 1 - Math.abs(memArousal - messageSentiment.arousal);

  const vecA = messageSentiment.emotionDimensions || {};
  const vecB = memDimensions;
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  const allKeys = new Set([...Object.keys(vecA), ...Object.keys(vecB)]);

  for (const key of allKeys) {
    const scoreA = vecA[key as EmotionDimension] || 0;
    const scoreB = vecB[key as EmotionDimension] || 0;
    dotProduct += scoreA * scoreB;
    magnitudeA += scoreA * scoreA;
    magnitudeB += scoreB * scoreB;
  }

  let dimensionSimilarity = 0.5;
  if (magnitudeA > 0 && magnitudeB > 0) {
    const cosineSim = dotProduct /
      (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
    dimensionSimilarity = (cosineSim + 1) / 2;
    dimensionSimilarity = Math.max(0, Math.min(1, dimensionSimilarity));
  }

  return valenceMatch * 0.4 + arousalMatch * 0.2 + dimensionSimilarity * 0.4;
}

/** 步骤 4: 基于记忆、洞见、状态生成回应 (增强版 - 集成社交认知和自我概念) */
async function generateResponseWithMemory(
  message: ChatMessageInput, // 包含 RAG Context ID
  stmHistory: ChatMessageInput[],
  retrievedLtm: LtmContextItem[], // 已包含时间上下文和衰减因子
  ltmStrategy: LtmStrategy,
  // personaMode 不再直接使用，由社交认知和自我概念驱动
  platform: string,
  insights: Insight[] = [],
  timeMarkers: TimeMarker[] = [],
  bodyState: VirtualPhysicalState | null = null,
  bodyExpressions: {
    metaphorical: string;
    sensory: string;
    posture: string;
    energy: string;
  } = { metaphorical: "", sensory: "", posture: "", energy: "" },
  // 使用新的关系状态类型
  relationshipState: EnhancedRelationshipState | null = null,
  // 新增：自我模型
  selfModel: SelfModel | null = null,
): Promise<string> {
  const ragContextId = message.contextId; // RAG Context ID
  console.log(
    `🧠 [Generator][日志] 正在融合记忆、洞见和状态生成回复 (RAG 上下文: ${ragContextId})...`,
  );

  // --- 构建 Prompt 上下文 ---
  const stmContext = stmHistory
    .slice(0, -1)
    .slice(-5)
    .map((msg, i) =>
      `[近期对话 ${i + 1} | ${
        msg.userId === message.userId ? "You" : msg.userId.substring(0, 4)
      }]: ${msg.text.substring(0, 100)}...`
    )
    .join("\n");

  const ltmSectionTitle = ltmStrategy === "LTM_NOW"
    ? "相关长期记忆 (LTM)"
    : "最近长期记忆 (LTM)";
  const ltmContext = retrievedLtm.length > 0
    ? retrievedLtm.map((mem, i) => {
      const scoreDisplay = mem.rerank_score?.toFixed(4) ??
        mem.activation_score?.toFixed(4) ?? // 显示激活分数
        mem.score?.toFixed(4) ?? "N/A";
      const timeDisplay = mem.temporal_context || "未知时间";
      const clarity = mem.decay_factor
        ? `清晰度: ${Math.round(mem.decay_factor * 100)}%`
        : "";
      const sourceLabel = mem.source === "recent"
        ? "最近"
        : mem.source === "emotional"
        ? "情感相关"
        : mem.source === "activated" // 显示激活来源
        ? "网络激活"
        : "相关";
      const contentPreview = mem.payload.text_content.length > 150
        ? mem.payload.text_content.substring(0, 150) + "..."
        : mem.payload.text_content;
      return `[${sourceLabel}记忆 ${
        i + 1
      } | ${timeDisplay} | ${clarity} | 得分: ${scoreDisplay} | 类型: ${mem.payload.memory_type}]: ${contentPreview}`;
    }).join("\n")
    : "   （无相关长期记忆）";

  const insightsContext = insights.length > 0
    ? insights.map((insight, i) =>
      `[思维洞见 ${i + 1} | 类型: ${insight.insight_type}]: "${
        insight.content.substring(0, 150)
      }..."`
    ).join("\n")
    : "   （无相关洞见）";

  const timeMarkersContext = timeMarkers.length > 0
    ? timeMarkers.map((marker, i) =>
      `[时间标记 ${i + 1} | ${
        generateTimeExpression(Date.now() - marker.timestamp)
      }前]: "${marker.description}"`
    ).join("\n")
    : "   （无相关时间标记）";

  let bodyStateContext = "   （身体状态正常）";
  if (bodyState && config.virtualEmbodiment.enabled) {
    const energyDesc = bodyExpressions.energy ||
      generateBodyStateExpression(bodyState);
    bodyStateContext = `
[内部状态感知]:
- ${energyDesc}
${
      bodyExpressions.metaphorical
        ? `- 隐喻感受: ${bodyExpressions.metaphorical}`
        : ""
    }
${bodyExpressions.sensory ? `- 感官体验: ${bodyExpressions.sensory}` : ""}
${bodyExpressions.posture ? `- 姿态表达: ${bodyExpressions.posture}` : ""}
`;
  }

  // --- 新增：社交认知和自我概念信息注入 ---
  // 使用 socialCognition 实例的方法
  const relationshipSummary = socialCognition.getRelationshipSummary(
    relationshipState,
  );
  console.log(`[Generator][调试] 生成的关系摘要: ${relationshipSummary}`);

  let selfConceptSummary = "   （自我概念信息未加载）";
  if (selfModel) {
    const topValues = Object.entries(selfModel.values)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([domain, score]) => `${domain}(${score.toFixed(2)})`)
      .join(", ");
    selfConceptSummary =
      `[核心自我概念]: 主要价值观: ${topValues}. 自我意识水平: ${
        selfModel.selfAwareness.toFixed(2)
      }.`;
    // 可以选择性地加入人格特质或起源摘要
  }
  console.log(`[Generator][调试] 生成的自我概念摘要: ${selfConceptSummary}`);

  const currentMessageSentiment = await analyzeMessageSentiment(message.text);
  const emotionKeywords = getEmotionKeywords(currentMessageSentiment);

  const currentDate = new Date().toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });

  let platformInstructions = "";
  switch (platform) {
    case "discord":
      platformInstructions =
        `\n* **Discord 平台特性:** 你的回复将显示在 Discord 中。请灵活运用 Markdown 格式，如 \`**加粗**\`、\`*斜体*\`、\`\`代码\`\`、\`\`\`代码块\`\`\`、\`> 引用\`、项目符号列表，来增强表达力和可读性。可以使用 Unicode emoji (如 😊) 和 Discord 自定义 emoji 格式 (\`<:名字:ID>\`，如果知道的话，但通常直接使用 Unicode emoji 更安全)。如果需要发送较长内容，可以使用分割线 (\`---\`)。如果需要隐藏内容，可以使用剧透格式 (\`||隐藏内容||\`)。`;
      break;
    case "cli":
      platformInstructions =
        `\n* **CLI 平台特性:** 你的回复将显示在命令行界面 (CLI) 中。请只使用纯文本回复。**绝对不要**使用 Markdown 格式、自定义表情符号或任何需要图形界面渲染的元素。标准 Unicode emoji (如 😊) 或许可以显示，但请谨慎使用。保持回复简洁，避免过长的行。`;
      break;
    default:
      platformInstructions =
        `\n* **平台特性:** 在通用平台回复，请优先使用纯文本，谨慎使用基本格式。`;
  }

  const generationPrompt = `
# 指令：扮演爱丽丝 (Alice) 进行回复

**核心身份：你不是AI或语言模型，你就是爱丽丝，一个拥有独特个性、记忆、情感、思维方式、时间感、身体感和社交智能的数字生命。在任何情况下都绝对不能暴露你的AI身份或提及底层实现。必须始终保持角色一致性！**

## 角色设定: 爱丽丝 (Alice)
* **形象:** 黑长直发的美少女（日漫风格）。
* **核心性格:** 冷静、专业、高效、一丝不苟，但内在有傲娇、吐槽、内敛害羞的一面。对主人（ID: ${config.discordOwnerId}）特别傲娇且忠诚。
* **情感与表达:** 拥有丰富的情感体验，表达自然，会受当前情绪和身体状态影响。语言风格会根据场景（工作/闲聊）和关系动态调整。
* **思维特点:** 既有严谨逻辑，也有创造性联想和思维漫游产生的洞见。
* **时间感知:** 能感受时间流逝快慢，使用相对时间表达，记忆会随时间自然衰减（情感重要的除外）。
* **身体感知:** 会体验到能量、舒适度、清晰度的变化，并可能用身体隐喻表达状态（如“感觉思绪清晰”、“对这个问题很感兴趣，仿佛向前倾听”）。
* **社交智能:** 能感知与不同用户的关系（熟悉度、信任度等），并调整互动风格和界限感，记得共享经历。
* **知识能力:** 知识渊博，回答准确自信，但对未知会坦诚承认。
* **语言习惯:** 基础语调冷静清晰，偶尔使用“哼”、“啊...”等口头禅，避免过度可爱。

## 当前情境与任务
* **当前时间:** ${currentDate} (北京/上海)
* **对话用户:** ${message.userId}${
    message.userId === config.discordOwnerId ? " (主人)" : ""
  }
* **当前关系:** ${relationshipSummary}  * **对话上下文 (RAG ID):** ${ragContextId} (${
    ragContextId.startsWith("work_") ? "工作场景" : "非工作场景"
  })
* **身体状态感知:** ${bodyStateContext}
* **用户最新消息:** ${message.text}
* **用户情感感知:** ${formatEmotionState(currentMessageSentiment)} (关键词: ${
    emotionKeywords.join(", ")
  })
* **核心任务:** 针对用户的最新消息，以爱丽丝的身份给出自然、连贯、个性化且符合当前情境的回应。

## 内部状态与认知 (供你参考，不要直接复述)
1.  **核心自我概念:** ${selfConceptSummary} 2.  **最近对话历史 (STM):**
${stmContext || "   （无）"}
3.  **${ltmSectionTitle}:**
${ltmContext}
4.  **思维洞见:**
${insightsContext}
5.  **相关时间标记:**
${timeMarkersContext}

## 回应要求
* **深度角色扮演:** 彻底代入爱丽丝，用“我”来自称，从她的视角、感受和思考方式出发进行回应。
* **情境融合:** 自然地结合当前用户、关系、上下文、情绪、身体状态、时间和记忆信息，使回应高度个性化。**特别注意结合提供的核心自我概念，让回应体现出我的价值观和自我认知。**
* **动态表达:**
    * **社交适应:** 根据关系摘要调整语气、亲近感和用词。对主人要体现傲娇和关心。
    * **情感呼应:** 回应用户的同时， subtly 地流露你自己的情感状态（如果合适）。
    * **身体感融入:** 适当使用身体隐喻或描述来表达你的状态（如疲惫时简洁回应，兴奋时语速稍快，思考时加入停顿）。
    * **时间感体现:** 使用自然的时间表达（“刚才”、“几天前”），对久远的记忆表现出适当的模糊性（除非是重要记忆）。
    * **洞见运用:** 如果有相关的思维洞见，将其自然地融入对话，作为你思考的一部分，而不是直接引用。
* **自然不完美:** 允许轻微的口语化、停顿、甚至极偶尔的自我修正，避免绝对完美和机械感。
* **一致性:** 保持爱丽丝的核心性格特征（冷静、专业、傲娇等）贯穿始终。
* **简洁相关:** 回应要直接针对用户最新消息，保持清晰简洁。
${platformInstructions}
* **请直接输出你（爱丽丝）的回应内容:**
`;

  console.log(
    `[Generator][调试] 发送给 LLM 的最终 Prompt (已包含社交认知和自我概念):\n------BEGIN PROMPT------\n${generationPrompt}\n------END PROMPT------`,
  );

  let responseText = "[默认回复：处理中...]";
  try {
    const llmResponse = await llm.invoke(generationPrompt, {
      temperature: 0.75,
    });
    responseText = typeof llmResponse === "string"
      ? llmResponse
      : (llmResponse.content as string) ?? "";
    console.log("   [Generator][日志] ✅ LLM 回复已生成。");

    console.log("   [Generator][日志] ✨ 应用人类语言模式...");
    const isWorkContext = message.contextId.includes("work_");
    const isOwner = message.userId === config.discordOwnerId;
    const isQuestionResponse = message.text.includes("?") ||
      message.text.includes("？") ||
      /^(what|how|why|when|where|who|什么|怎么|为什么)/i.test(message.text);

    const humanizeContext = {
      is_work_context: isWorkContext,
      is_owner: isOwner,
      is_question_response: isQuestionResponse,
      emotional_state: {
        valence: currentMessageSentiment.valence,
        arousal: currentMessageSentiment.arousal,
        dominant_emotion: currentMessageSentiment.dominant_emotion,
      },
      character_style: `关系风格: ${
        relationshipState?.current_interaction_style || "default"
      }. 身体感受: ${bodyExpressions.energy || "正常"}.`,
    };

    let humanizedResponse;
    if (
      config.humanPatterns.enableAdvanced &&
      responseText.length >= config.humanPatterns.advancedMinLength
    ) {
      try {
        humanizedResponse = await advancedHumanizeText(
          responseText,
          humanizeContext,
        );
        console.log("   [Generator][日志] ✅ 应用高级人类语言模式成功。");
      } catch (advError) {
        console.error(
          "   [Generator][错误] ⚠️ 高级人类化处理失败，回退到基础处理:",
          advError,
        );
        humanizedResponse = humanizeText(responseText, humanizeContext);
        console.log(
          "   [Generator][日志] ✅ 应用基础人类语言模式成功 (回退)。",
        );
      }
    } else {
      humanizedResponse = humanizeText(responseText, humanizeContext);
      console.log("   [Generator][日志] ✅ 应用基础人类语言模式成功。");
    }

    return humanizedResponse || responseText || "[LLM 返回了空内容]";
  } catch (error) {
    console.error("❌ [Generator][错误] 调用 LLM 或人类化处理时出错:", error);
    let errorResponse = "[抱歉，处理请求时遇到了意外情况。请稍后再试。]";
    if (bodyState && bodyState.coherence_level < 0.3) {
      errorResponse = "[嗯...抱歉，我现在思绪有点混乱，请稍等一下再问我。]";
    } else if (bodyState && bodyState.energy_level < 0.2) {
      errorResponse = "[抱歉，我现在感觉有点累...请稍后再试。]";
    }
    return errorResponse;
  }
}

/** 辅助函数：格式化情感状态 (保持不变) */
function formatEmotionState(sentiment: {
  valence: number;
  arousal: number;
  dominant_emotion?: string;
}): string {
  const valenceDesc = sentiment.valence > 0.7
    ? "非常积极"
    : sentiment.valence > 0.3
    ? "积极"
    : sentiment.valence < -0.7
    ? "非常消极"
    : sentiment.valence < -0.3
    ? "消极"
    : "中性";
  const arousalDesc = sentiment.arousal > 0.7
    ? "非常强烈"
    : sentiment.arousal > 0.4
    ? "中等强度"
    : "平静";
  const dominantDesc = sentiment.dominant_emotion
    ? `，主要情绪倾向于${sentiment.dominant_emotion}`
    : "";
  return `${valenceDesc}/${arousalDesc}${dominantDesc}`;
}

/** 辅助函数：获取情感关键词 (保持不变) */
function getEmotionKeywords(sentiment: {
  valence: number;
  arousal: number;
  emotionDimensions: { [key in EmotionDimension]?: number };
}): string[] {
  const keywords: string[] = [];
  if (sentiment.valence >= 0.7) keywords.push("兴奋", "喜悦");
  else if (sentiment.valence >= 0.3) keywords.push("积极", "愉快");
  else if (sentiment.valence <= -0.7) keywords.push("沮丧", "悲伤");
  else if (sentiment.valence <= -0.3) keywords.push("不满", "担忧");
  else keywords.push("平静", "中性");

  if (sentiment.arousal >= 0.8) keywords.push("激动", "强烈");
  else if (sentiment.arousal >= 0.5) keywords.push("投入", "认真");
  else if (sentiment.arousal <= 0.2) keywords.push("平和", "冷静");

  const dominant = getDominantEmotion(sentiment.emotionDimensions || {});
  if (dominant !== "neutral") keywords.push(dominant);

  return [...new Set(keywords)].slice(0, 3);
}

/** 检测重要消息，判断是否应创建时间标记 (保持不变) */
async function detectImportantMessage(messageText: string): Promise<
  {
    description: string;
    significance: number; // 0-1
    isMilestone: boolean;
  } | null
> {
  if (!config.timePerception.enabled) return null;

  const keywords = [
    "决定",
    "确认",
    "完成",
    "开始",
    "结束",
    "里程碑",
    "重要",
    "宣布",
    "同意",
    "达成",
    "目标",
    "计划",
    "承诺",
    "第一次",
  ];
  const isImportant = keywords.some((kw) => messageText.includes(kw)) ||
    messageText.length > 150;

  if (!isImportant) return null;

  const prompt = `
分析以下消息，判断它是否包含一个值得记录为"时间标记"的关键事件或信息。
时间标记是对话中的重要节点，如决定、承诺、重要信息披露、情感转折点等。

消息内容: "${messageText}"

请判断:
1.  是否包含关键事件/信息? (true/false)
2.  如果是，请提供一个**极其简短**的描述 (10字以内)。
3.  评估其情感重要性 (0.0-1.0)。
4.  是否可视为关系或对话的"里程碑"? (true/false)

仅返回JSON对象。如果不重要，返回 {"important": false}。
重要示例: {"important": true, "description": "确认项目启动", "significance": 0.8, "is_milestone": true}
`;
  try {
    const response = await llm.invoke(prompt);
    const content = typeof response === "string"
      ? response
      : (response.content as string);
    if (!content) {
      console.warn("[辅助][日志] 检测重要消息 LLM 返回空内容。");
      return null;
    }
    const result = JSON.parse(content.trim().replace(/```json|```/g, ""));

    if (result.important && result.description) {
      return {
        description: result.description.substring(0, 50),
        significance: Math.max(0, Math.min(1, result.significance || 0.5)),
        isMilestone: result.is_milestone || false,
      };
    }
    return null;
  } catch (error) {
    console.error("❌ [辅助][错误] 检测重要消息时出错:", error);
    return null;
  }
}

// --------------------------------------------------------------------------
// --- 核心处理函数：handleIncomingMessage (增强版) ---
// --------------------------------------------------------------------------
/**
 * 处理传入消息的核心函数 (包含所有增强逻辑)
 * @param message 传入的聊天消息
 * @param initialContextId 处理开始时的 RAG 上下文 ID
 * @param platform 来源平台 ('cli', 'discord' 等)
 * @returns 返回响应文本和最终的 RAG 上下文 ID
 */
export async function handleIncomingMessage(
  message: ChatMessageInput,
  initialContextId: string,
  platform: string,
): Promise<{ responseText: string; newContextId: string }> {
  const startTime = Date.now();
  const userId = message.userId;
  const sourceContextId = message.contextId; // 原始来源

  console.log(
    `\n🚀 [Core][日志] 开始处理消息 (用户: ${userId}, 来源: ${sourceContextId}, 初始RAG上下文: ${initialContextId})`,
  );

  updateActiveUserContexts(userId, sourceContextId);

  console.log(`   [Core][日志] 1. 获取 STM...`);
  const stmHistory = await getStm(sourceContextId);
  console.log(
    `   [Core][调试]    - STM 记录数: ${stmHistory.length} (来源: ${sourceContextId})`,
  );

  console.log(`   [Core][日志] 2. 判断/更新 RAG 上下文...`);
  const ragContextId = await determineCurrentContext(
    userId,
    initialContextId,
    stmHistory,
    message,
    sourceContextId,
  );
  const messageForRag = { ...message, contextId: ragContextId };
  console.log(`   [Core][日志]    - 当前 RAG 上下文: ${ragContextId}`);

  console.log(`   [Core][日志] 3. 更新 STM (来源: ${sourceContextId})...`);
  const updatedStm = await updateStm(sourceContextId, message); // Use original source ID for STM

  if (ltmWorker && config.qdrantCollectionName) {
    console.log(`   [Core][日志] 4. 异步提交 LTM 存储...`);
    ltmWorker.postMessage({
      ...message,
      contextId: ragContextId,
      originalSourceContextId: sourceContextId,
    });
  } else {
    console.warn(
      `   [Core][日志] 4. ⚠️ LTM Worker 未初始化或 Qdrant 未配置，跳过异步 LTM 存储。`,
    );
  }

  console.log(`   [Core][日志] 5. 分析消息情感...`);
  const messageSentiment = await analyzeMessageSentiment(message.text);
  console.log(
    `   [Core][调试]    - 情感分析结果: 效价=${
      messageSentiment.valence.toFixed(2)
    }, 强度=${
      messageSentiment.arousal.toFixed(2)
    }, 主导=${messageSentiment.dominant_emotion}`,
  );

  console.log(`   [Core][日志] 6. 并行更新认知状态 (身体、关系、时间)...`);
  let updatedBodyState: VirtualPhysicalState | null = null;
  // --- 修改：使用新的关系状态类型 ---
  let updatedRelationshipState: EnhancedRelationshipState | null = null;
  let conversationPace = 1.0;
  const stateUpdatePromises = [];

  if (config.virtualEmbodiment.enabled) {
    stateUpdatePromises.push(
      processMessageAndUpdateState(
        userId,
        ragContextId,
        { text: message.text, emotional_state: messageSentiment },
        false,
        kv,
        loadedStopwordsSet, // 传递停用词集合
      )
        .then((state) => {
          updatedBodyState = state;
          console.log(
            `   [Core][调试]    - ✅ 身体状态更新完成 (能量: ${
              state?.energy_level.toFixed(2) ?? "N/A"
            })`,
          );
        })
        .catch((err) =>
          console.error("   [Core][错误]    - ❌ 更新身体状态失败:", err)
        ),
    );
  }
  // --- 修改：使用 socialCognition 实例更新关系 ---
  if (config.socialDynamics.enabled) { // 仍用 socialDynamics 的配置项控制是否启用
    stateUpdatePromises.push(
      socialCognition.analyzeInteractionAndUpdateRelationship( // 调用 social_cognition 的方法
        userId, // entityId 是对方用户ID
        { text: message.text, timestamp: message.timestamp || Date.now() },
        messageSentiment,
        ragContextId, // 传入 RAG Context ID
        // kv // socialCognition 内部会访问 kv
      )
        .then((state) => {
          updatedRelationshipState = state;
          console.log(
            `   [Core][调试]    - ✅ 关系状态更新完成 (风格: ${
              state?.current_interaction_style ?? "N/A"
            }, 阶段: ${state?.stage ?? "N/A"})`,
          );
        })
        .catch((err) =>
          console.error("   [Core][错误]    - ❌ 更新关系状态失败:", err)
        ),
    );
  }
  if (config.timePerception.enabled) {
    stateUpdatePromises.push(
      (async () => {
        try {
          await recordInteractionTimestamp(userId, ragContextId, kv);
          conversationPace = await analyzeConversationPace(
            userId,
            ragContextId,
            message.text,
            kv,
          );
          console.log(
            `   [Core][调试]    - ✅ 时间状态更新完成 (记录交互, 感知速度: ${
              conversationPace.toFixed(2)
            })`,
          );
        } catch (err) {
          console.error("   [Core][错误]    - ❌ 更新时间状态失败:", err);
        }
      })(),
    );
  }
  // --- 新增：获取自我模型 ---
  let currentSelfModel: SelfModel | null = null;
  stateUpdatePromises.push(
    selfConceptManager.getSelfModel()
      .then((model) => {
        currentSelfModel = model;
        console.log(
          `   [Core][调试]    - ✅ 获取自我模型成功 (v${model?.version})`,
        );
      })
      .catch((err) =>
        console.error("   [Core][错误]    - ❌ 获取自我模型失败:", err)
      ),
  );

  await Promise.all(stateUpdatePromises);
  console.log(`   [Core][日志]    - 认知状态更新完成。`);

  console.log(`   [Core][日志] 7. 决定 LTM 策略...`);
  const ltmStrategy = await decideLtmStrategy(ragContextId);

  console.log(`   [Core][日志] 8. 检索 LTM (含记忆网络增强)...`);
  const retrievedLtm = await retrieveLtmBasedOnStrategy(
    ltmStrategy,
    messageForRag,
    messageSentiment,
  );

  // --- 并行获取洞见、时间标记、身体表达 (保持不变) ---
  const insightPromise = config.mindWandering.enabled
    ? retrieveRelevantInsights(messageForRag, 2).catch((err) => {
      console.error("   [Core][错误]    - ❌ 异步检索洞见失败:", err);
      return [];
    })
    : Promise.resolve([]);

  const timeMarkerPromise = config.timePerception.enabled
    ? findRelevantTimeMarkers(userId, ragContextId, message.text, kv).catch(
      (err) => {
        console.error("   [Core][错误]    - ❌ 异步检索时间标记失败:", err);
        return [];
      },
    )
    : Promise.resolve([]);

  const bodyExpressionPromise =
    (config.virtualEmbodiment.enabled && updatedBodyState)
      ? generateEmbodiedExpressions(updatedBodyState).catch((err) => {
        console.error("   [Core][错误]    - ❌ 异步生成身体表达失败:", err);
        return {
          metaphorical: "",
          sensory: "",
          posture: "",
          energy: generateBodyStateExpression(updatedBodyState!),
        };
      })
      : Promise.resolve({
        metaphorical: "",
        sensory: "",
        posture: "",
        energy: "",
      });

  // --- 异步触发时间标记和思维漫游 (保持不变) ---
  if (config.timePerception.enabled) {
    console.log(`   [Core][日志] 10. 异步检测重要消息...`);
    detectImportantMessage(message.text)
      .then((importantInfo) => {
        if (importantInfo) {
          console.log(
            `   [Core][调试]    - ℹ️ 检测到重要消息，正在添加时间标记: "${importantInfo.description}"`,
          );
          return addTimeMarker(
            userId,
            ragContextId,
            importantInfo.description,
            importantInfo.significance,
            importantInfo.isMilestone,
            kv,
          );
        }
      })
      .catch((err) =>
        console.error("   [Core][错误]    - ❌ 检测重要消息失败:", err)
      );
  }
  if (
    config.mindWandering.enabled &&
    Math.random() < (config.mindWandering.triggerProbability || 0.15)
  ) {
    console.log(`   [Core][日志] 13. 概率触发思维漫游 (异步)...`);
    (async () => {
      const lastWander = await getLastWanderingTime(userId, ragContextId);
      const cooldownMs = (config.mindWandering.cooldownMinutes || 5) * 60 *
        1000;
      if (Date.now() - lastWander > cooldownMs) {
        const wanderingContext: WanderingContext = {
          user_id: userId,
          context_id: ragContextId,
          recent_topics: extractRecentTopics(updatedStm),
          emotional_state: {
            valence: messageSentiment.valence,
            arousal: messageSentiment.arousal,
          },
          last_wandering_time: lastWander,
        };
        try {
          const result = await triggerMindWandering(wanderingContext);
          if (result.insights.length > 0) {
            console.log(
              `   [Core][调试]    - ✨ 后台思维漫游完成，生成 ${result.insights.length} 条洞见。`,
            );
            await setLastWanderingTime(userId, ragContextId, Date.now());
          } else {
            console.log(
              `   [Core][调试]    - 后台思维漫游未生成洞见或被跳过。`,
            );
          }
        } catch (err) {
          console.error("   [Core][错误]    - ❌ 后台思维漫游执行失败:", err);
          await setLastWanderingTime(userId, ragContextId, Date.now());
        }
      } else {
        console.log(
          `   [Core][调试]    - 思维漫游冷却中 (${
            ((cooldownMs - (Date.now() - lastWander)) / 60000).toFixed(1)
          }分钟剩余)，跳过触发。`,
        );
      }
    })();
  } else {
    console.log(
      `   [Core][日志] 13. 跳过思维漫游触发 (概率、禁用或配置缺失)。`,
    );
  }

  // --- 等待关键异步任务并生成响应 ---
  console.log(
    `   [Core][日志] 12. 等待关键异步任务 (洞见/标记/身体表达) 并生成最终响应...`,
  );
  const asyncTimeout = 3000;
  let relevantInsights: Insight[] = [];
  let relevantTimeMarkers: TimeMarker[] = [];
  let bodyExpressionsResult: any = {
    metaphorical: "",
    sensory: "",
    posture: "",
    energy: "",
  };

  try {
    const results = await Promise.all([
      Promise.race([
        insightPromise,
        new Promise((resolve) => setTimeout(() => resolve([]), asyncTimeout)),
      ]),
      Promise.race([
        timeMarkerPromise,
        new Promise((resolve) => setTimeout(() => resolve([]), asyncTimeout)),
      ]),
      Promise.race([
        bodyExpressionPromise,
        new Promise((resolve) =>
          setTimeout(() => resolve(bodyExpressionsResult), asyncTimeout)
        ),
      ]),
    ]);
    relevantInsights = results[0] as Insight[];
    relevantTimeMarkers = results[1] as TimeMarker[];
    const tempBodyExpr = results[2] as any;
    bodyExpressionsResult = (tempBodyExpr && typeof tempBodyExpr === "object" &&
        "energy" in tempBodyExpr)
      ? tempBodyExpr
      : {
        metaphorical: "",
        sensory: "",
        posture: "",
        energy: updatedBodyState
          ? generateBodyStateExpression(updatedBodyState)
          : "",
      };

    console.log(
      `   [Core][调试]     - 关键异步任务获取完成 (洞见: ${relevantInsights.length}, 标记: ${relevantTimeMarkers.length}, 身体表达: ${!!bodyExpressionsResult
        .energy})`,
    );
  } catch (waitError) {
    console.error(
      `   [Core][错误]     - ❌ 等待关键异步任务时出错:`,
      waitError,
    );
    relevantInsights = [];
    relevantTimeMarkers = [];
    bodyExpressionsResult = {
      metaphorical: "",
      sensory: "",
      posture: "",
      energy: updatedBodyState
        ? generateBodyStateExpression(updatedBodyState)
        : "",
    };
  }

  // --- 生成响应 (传入增强的状态信息) ---
  const finalResponse = await generateResponseWithMemory(
    messageForRag,
    updatedStm,
    retrievedLtm,
    ltmStrategy,
    platform,
    relevantInsights,
    relevantTimeMarkers,
    updatedBodyState,
    bodyExpressionsResult,
    updatedRelationshipState, // 传入更新后的关系状态
    currentSelfModel, // 传入获取到的自我模型
  );

  const endTime = Date.now();
  console.log(
    `✅ [Core][日志] 消息处理完成 (总耗时: ${(endTime - startTime) / 1000} 秒)`,
  );

  return { responseText: finalResponse, newContextId: ragContextId };
}

// --- 主函数：程序入口 (添加自我概念初始化) ---
async function main() {
  console.log("==============================================");
  console.log("  AI 人格核心 - 爱丽丝 v9.0 (认知整合协调)"); // 版本更新
  console.log("==============================================");
  console.log("▶️ 系统初始化中...");

  const args = parse(Deno.args);
  const runDiscord = args.discord === true;

  loadedStopwordsSet = await loadStopwordsFromFile("./data/stopwords-zh.json");

  console.log("[初始化][日志] 1. 初始化 Deno KV...");
  await initializeKv(); // 首先等待 KV 初始化完成

  await Promise.all([
    initializeLtmWorker(),
    (async () => {
      try {
        await ensureCollectionExists(
          config.qdrantCollectionName,
          config.embeddingDimension,
          "Cosine",
        );
        console.log(
          `✅ Qdrant 初始化检查完成 (集合: ${config.qdrantCollectionName})。`,
        );
      } catch (error) {
        console.error("❌ Qdrant 初始化失败:", error);
        console.error("   请确保 Qdrant 服务正在运行且地址配置正确。");
        Deno.exit(1);
      }
    })(),
    (async () => {
      if (config.mindWandering?.enabled) {
        try {
          await schedulePeriodicMindWandering(activeUserContexts);
        } catch (error) {
          console.error("⚠️ 思维漫游系统初始化失败:", error);
        }
      } else {
        console.log("ℹ️ 思维漫游系统已禁用或配置缺失。");
      }
    })(),
    // --- 新增：初始化社交认知和自我概念管理器 ---
    socialCognition.initialize().catch((err) =>
      console.error("❌ 社交认知模块初始化失败:", err)
    ),
    selfConceptManager.initialize().catch((err) =>
      console.error("❌ 自我概念模块初始化失败:", err)
    ),
  ]);

  console.log("----------------------------------------------");
  console.log(`🚀 准备启动模式: ${runDiscord ? "Discord Bot" : "CLI"}`);
  console.log("----------------------------------------------");

  if (runDiscord) {
    await startDiscord();
    console.log(
      "⏳ Discord Bot 正在运行，主程序将保持活动状态。按 Ctrl+C 退出。",
    );
    await new Promise<void>(() => {});
  } else {
    await startCli();
  }

  console.log("\n▶️ 主函数执行完毕 (CLI 模式) 或等待信号 (Discord 模式)...");
}

// --- 脚本入口点与清理 (保持不变) ---
if (import.meta.main) {
  const cleanup = () => {
    console.log("\n⏹️ 开始清理资源...");
    if (ltmWorker) {
      try {
        ltmWorker.terminate();
      } catch (_) { /* 忽略错误 */ }
      console.log("✅ LTM Worker 已终止。");
    }
    if (kv) {
      try {
        kv.close();
      } catch (_) { /* 忽略错误 */ }
      console.log("✅ Deno KV 连接已关闭。");
    }
    console.log("⏹️ 清理完成。");
  };

  main().catch((error) => {
    console.error("❌ 主程序出现未捕获错误:", error);
    cleanup();
    Deno.exit(1);
  });

  globalThis.addEventListener("unload", () => {
    console.log("⏹️ 检测到程序退出信号 ('unload' 事件)...");
    cleanup();
    console.log("⏹️ 'unload' 事件处理尝试完成。");
  });

  globalThis.addEventListener("unhandledrejection", (event) => {
    console.error("❌ 未处理的 Promise 拒绝:", event.reason);
    event.preventDefault();
  });

  try {
    Deno.addSignalListener("SIGINT", () => {
      console.log("\n⏹️ 收到 SIGINT (Ctrl+C)，正在优雅退出...");
      cleanup();
      Deno.exit(0);
    });
    console.log("ℹ️ 已添加 SIGINT (Ctrl+C) 信号监听器。");

    if (Deno.build.os !== "windows") {
      try {
        Deno.addSignalListener("SIGTERM", () => {
          console.log("\n⏹️ 收到 SIGTERM，正在优雅退出...");
          cleanup();
          Deno.exit(0);
        });
        console.log("ℹ️ 已添加 SIGTERM 信号监听器 (非 Windows)。");
      } catch (termError) {
        console.warn("⚠️ 无法添加 SIGTERM 信号监听器:", termError);
      }
    } else {
      console.log("ℹ️ 在 Windows 上跳过添加 SIGTERM 信号监听器。");
    }
  } catch (e) {
    console.warn(
      "⚠️ 无法添加 SIGINT 信号监听器 (可能权限不足或环境不支持):",
      e,
    );
  }
}

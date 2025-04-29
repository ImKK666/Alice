// src/main.ts (进化版 - 集成所有新模块)

// --- 核心依赖导入 ---
import { parse } from "https://deno.land/std@0.224.0/flags/mod.ts";
import { config } from "./config.ts";
import { type ChatMessageInput } from "./memory_processor.ts";
import { embeddings } from "./embeddings.ts";
import {
  type EmotionDimension, // 确保导入
  ensureCollectionExists,
  type MemoryPayload,
  type MemoryPointStruct, // 确保导入
  type MemoryType, // 确保导入
  qdrantClient, // Qdrant 客户端实例
  type Schemas,
  searchMemories,
  searchMemoriesByEmotion, // 新增：按情感搜索
  upsertMemoryPoints, // 确保导入
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

// --- 进化模块导入 ---
import { // 思维漫游模块
  type Insight,
  type InsightCollection, // 确保导入
  type InsightType, // 确保导入
  retrieveRelevantInsights,
  schedulePeriodicMindWandering,
  triggerMindWandering,
  type WanderingContext,
} from "./mind_wandering.ts";
import { // 时间感知模块
  addTimeMarker,
  analyzeConversationPace,
  calculateSubjectiveTimeElapsed,
  enhanceMemoriesWithTemporalContext,
  findRelevantTimeMarkers,
  generateTimeExpression, // 确保导入
  recordInteractionTimestamp, // 用于记录交互时间戳
  type TemporalContext, // 如果需要在main中直接操作时间上下文
  type TimeMarker,
} from "./time_perception.ts";
import { // 人类语言模式模块
  advancedHumanizeText,
  humanizeText,
} from "./human_patterns.ts";
import { // 虚拟具身模块
  generateBodyStateExpression, // 导入基础表达
  generateEmbodiedExpressions, // 替代旧的 generateBodyStateExpression
  processMessageAndUpdateState, // 替代旧的 processMessage
  processStateChangeEvent, // 如果需要在main中直接触发
  StateChangeEvent,
  type VirtualPhysicalState,
} from "./virtual_embodiment.ts";
import { // 社交动态模块
  analyzeInteractionImpact,
  getRelationshipState,
  getRelationshipSummary,
  type InteractionStylePreset, // 如果需要使用预设类型
  type RelationshipState,
} from "./social_dynamics.ts";

// --- 类型定义 ---
// 记忆上下文条目，增强了时间信息
interface LtmContextItem {
  id: string | number; // Qdrant ID 可能是数字或字符串
  payload: MemoryPayload;
  score?: number; // 原始相关性得分
  rerank_score?: number; // Rerank 得分
  source: "retrieved" | "recent" | "emotional"; // 来源标记
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
// Map<userId, contextId[]> 跟踪活跃的用户-上下文对，用于定期思维漫游
const activeUserContexts = new Map<string, string[]>();
// Map<"userId:contextId", timestamp> 记录上次思维漫游时间 (现在通过 KV 管理)

// --- 初始化 STM (Deno KV) ---
async function initializeKv() {
  try {
    // 根据 Deno 版本和环境选择合适的 KV 打开方式
    // 假设使用默认路径
    kv = await Deno.openKv(); // 如果需要指定路径: await Deno.openKv("/path/to/kv.db");
    console.log("✅ STM & State Storage (Deno KV) 初始化成功。");
  } catch (error) {
    console.error("❌ STM & State Storage (Deno KV) 初始化失败:", error);
    console.warn("⚠️ STM 和状态存储功能将被禁用。");
    // 可以考虑在这里退出程序，因为很多功能依赖KV
    // Deno.exit(1);
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
      e.preventDefault(); // 防止默认错误处理（可能导致进程退出）
    };
    ltmWorker.onmessage = (e) => {
      // 处理来自 Worker 的成功或失败消息
      if (e.data?.status === "success") {
        console.log(
          `[LTM Worker] ✅ 消息 LTM 存储成功 (用户: ${e.data.userId}, 上下文: ${e.data.contextId}, 耗时: ${e.data.duration}s)`,
        );
      } else if (e.data?.status === "error") {
        console.error(
          `[LTM Worker] ❌ 消息 LTM 存储失败 (用户: ${e.data.userId}, 上下文: ${e.data.contextId}): ${e.data.error}`,
        );
      } else {
        console.log(`[ LTM Worker 消息 ] ${JSON.stringify(e.data)}`);
      }
    };
    ltmWorker.onmessageerror = (e) => {
      console.error("[ LTM Worker ] 接收消息出错:", e);
    };
  } catch (error) {
    console.error("❌ LTM Worker 初始化失败:", error);
    console.warn("⚠️ LTM 后台处理将被禁用。");
  }
}

// --- STM 相关函数 ---
/** 获取指定上下文的STM历史 */
export async function getStm(contextId: string): Promise<ChatMessageInput[]> {
  if (!kv) {
    console.warn("[STM] KV 未初始化，无法获取 STM。");
    return [];
  }
  try {
    const key = ["stm", contextId];
    const result = await kv.get<ChatMessageInput[]>(key);
    return result.value ?? [];
  } catch (error) {
    console.error(`❌ 读取 STM 出错 (上下文 ${contextId}):`, error);
    return [];
  }
}

/** 更新指定上下文的STM，使用原子操作处理并发 */
async function updateStm(
  contextId: string,
  newMessage: ChatMessageInput,
): Promise<ChatMessageInput[]> {
  if (!kv) {
    console.warn("[STM] KV 未初始化，无法更新 STM。");
    return [newMessage];
  }
  const key = ["stm", contextId];
  let finalStm: ChatMessageInput[] = [newMessage]; // 默认至少包含新消息

  try {
    let success = false;
    // 重试机制，处理可能的版本冲突
    for (let i = 0; i < 3 && !success; i++) {
      const getResult = await kv.get<ChatMessageInput[]>(key);
      const currentStm = getResult.value ?? [];
      const currentVersionstamp = getResult.versionstamp; // 用于原子性检查

      const combinedStm = [...currentStm, newMessage];
      const prunedStm = combinedStm.slice(-STM_MAX_MESSAGES); // 保留最新的 N 条
      finalStm = prunedStm; // 更新函数范围内的 finalStm

      const atomicOp = kv.atomic()
        .check({ key: key, versionstamp: currentVersionstamp }) // 检查版本
        .set(key, prunedStm); // 设置新值

      const commitResult = await atomicOp.commit();

      if (commitResult.ok) {
        success = true;
      } else {
        console.warn(
          `⚠️ STM 更新冲突 (上下文 ${contextId})，尝试次数 ${
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
        `❌ STM 更新失败 (上下文 ${contextId})，已达最大尝试次数。返回内存中的状态。`,
      );
    }
    return finalStm;
  } catch (error) {
    console.error(`❌ STM 原子更新出错 (上下文 ${contextId}):`, error);
    return finalStm; // 出错时返回当前内存中的状态
  }
}

// --- 辅助函数 ---

/** 更新活跃用户上下文映射 */
function updateActiveUserContexts(userId: string, contextId: string): void {
  const userContexts = activeUserContexts.get(userId) || [];
  if (!userContexts.includes(contextId)) {
    userContexts.push(contextId);
    if (userContexts.length > 10) { // 限制每个用户跟踪的上下文数量
      userContexts.shift();
    }
  }
  // 将最新的上下文移到末尾 (如果需要，可以根据活跃度排序)
  // else {
  //   userContexts.splice(userContexts.indexOf(contextId), 1);
  //   userContexts.push(contextId);
  // }
  activeUserContexts.set(userId, userContexts);
}

/** 获取上次思维漫游时间 */
async function getLastWanderingTime(
  userId: string,
  contextId: string,
): Promise<number> {
  // return lastWanderingTimes.get(`${userId}:${contextId}`) || 0;
  // 改为从KV读取，以支持多实例或重启后状态恢复
  if (!kv) return 0;
  const key = ["last_wandering_time", userId, contextId];
  try {
    const result = await kv.get<number>(key);
    return result.value || 0;
  } catch (error) {
    console.error("获取上次漫游时间失败:", error);
    return 0;
  }
}

/** 设置上次思维漫游时间 */
async function setLastWanderingTime(
  userId: string,
  contextId: string,
  timestamp: number,
): Promise<void> {
  // lastWanderingTimes.set(`${userId}:${contextId}`, timestamp);
  // 改为写入KV
  if (!kv) return;
  const key = ["last_wandering_time", userId, contextId];
  try {
    await kv.set(key, timestamp);
  } catch (error) {
    console.error("设置上次漫游时间失败:", error);
  }
}

/** 提取最近话题 (简化版) */
function extractRecentTopics(history: ChatMessageInput[]): string[] {
  if (history.length === 0) return [];
  const recentMessages = history.slice(-5); // 取最近5条
  const topics = new Set<string>();
  const stopWords = new Set([
    "的",
    "了",
    "是",
    "在",
    "我",
    "你",
    "他",
    "她",
    "它",
    "们",
    "这",
    "那",
    "吧",
    "吗",
    "呢",
    "啊",
    "哦",
    "嗯",
    "the",
    "and",
    "is",
    "of",
    "to",
    "in",
    "that",
    "it",
    "for",
    "you",
    "with",
    "on",
    "as",
    "are",
    "this",
    "be",
  ]);

  for (const msg of recentMessages) {
    const words = msg.text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, "") // 移除非字母、数字、空格
      .split(/\s+/)
      .filter((word) => word.length > 1 && !stopWords.has(word));
    words.forEach((word) => topics.add(word));
  }
  return Array.from(topics).slice(0, 10); // 返回最多10个话题
}

/** 分析消息情感状态 (使用LLM) */
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
    const cleanedContent = responseContent.trim().replace(/```json|```/g, "");
    const sentimentData = JSON.parse(cleanedContent);

    const emotions = sentimentData.emotions || { "neutral": 1.0 };
    const dominantEmotion = getDominantEmotion(emotions);

    return {
      valence: sentimentData.valence ?? 0,
      arousal: sentimentData.arousal ?? 0,
      emotionDimensions: emotions,
      dominant_emotion: dominantEmotion,
    };
  } catch (error) {
    console.error("情感分析失败:", error);
    return { // 返回默认中性情感
      valence: 0,
      arousal: 0,
      emotionDimensions: { "neutral": 1.0 },
      dominant_emotion: "neutral",
    };
  }
}

/** 获取情感维度中得分最高的情感 */
function getDominantEmotion(
  emotionDimensions: { [key in string]?: number },
): string {
  let maxScore = -1;
  let dominantEmotion = "neutral"; // 默认中性

  for (const [emotion, score] of Object.entries(emotionDimensions)) {
    if (score !== undefined && score > maxScore) {
      // 忽略中性情感作为主导情绪，除非它是唯一得分高的
      if (
        emotion !== "neutral" || Object.keys(emotionDimensions).length === 1
      ) {
        maxScore = score;
        dominantEmotion = emotion;
      } else if (dominantEmotion === "neutral" && emotion === "neutral") {
        // 如果当前主导是中性，且遇到中性，也更新分数
        maxScore = score;
      }
    }
  }
  // 如果最高分还是很低，则认为是中性
  if (maxScore < 0.3 && dominantEmotion !== "neutral") {
    return "neutral";
  }

  return dominantEmotion;
}

// --- 核心 RAG 逻辑 ---

/** 步骤 0: 自动判断当前 RAG 上下文 */
async function determineCurrentContext(
  userId: string,
  previousContextId: string,
  stmHistory: ChatMessageInput[],
  newMessage: ChatMessageInput,
): Promise<string> {
  console.log(
    `▶️ [ContextDetect] 开始判断场景 (先前 RAG 上下文: ${previousContextId})...`,
  );
  const historySnippet = stmHistory
    .slice(-5)
    .map((msg) => `${msg.userId === userId ? "You" : "Other"}: ${msg.text}`) // 简化历史记录
    .join("\n");

  // 使用LLM进行上下文分类
  const classificationPrompt = `
Analyze the latest user message in the context of recent conversation history and the previous context ID.
Classify the primary topic/context. Choose ONE category: [Casual Chat, Work Task/Project, Info Query, Scheduling, Philosophical Discussion, Emotional Support, Other].
If the category is "Work Task/Project", identify the specific project identifier/code if clearly mentioned recently (e.g., "项目A", "客户B", "045号任务"). Focus on clear identifiers.
If the category is "Emotional Support", note the primary emotion if obvious.

Previous RAG Context ID was: ${previousContextId}
Recent History (last 5 turns):
${historySnippet || "(无历史记录)"}
Latest User Message (${newMessage.userId}): ${newMessage.text}

Output Format: Respond ONLY with the category, optionally followed by a colon and the specific detail (project identifier or emotion). Examples:
Casual Chat
Work Task/Project: 项目A
Info Query
Scheduling
Philosophical Discussion
Emotional Support: sadness
Other

Category:`;

  try {
    const response = await llm.invoke(classificationPrompt, {
      temperature: 0.3,
    }); // 低温以获取确定性分类
    const classificationResult =
      (typeof response === "string" ? response : (response.content as string))
        ?.trim();
    console.log(
      `   [ContextDetect] LLM 分类结果: "${classificationResult || "(空)"}"`,
    );

    if (!classificationResult) {
      console.warn("   [ContextDetect] LLM 未返回有效分类，沿用先前上下文。");
      return previousContextId;
    }

    // --- 解析来源上下文 (如 discord_channel_xxx, cli_yyy) ---
    let sourceType = "unknown";
    let sourceIdentifier = previousContextId; // 默认

    const patterns = [
      /^(casual_chat|info_query|scheduling|other|work_general|philosophical|emotional)_([^_]+)_(.+)$/,
      /^discord_channel_(.+)$/,
      /^discord_dm_(.+)$/,
      /^cli_(.+)$/,
      /^work_project_(.+)$/, // 工作项目单独处理
    ];

    for (const pattern of patterns) {
      const match = previousContextId.match(pattern);
      if (match) {
        if (pattern.source.includes("^_(")) { // 复杂格式
          sourceType = match[2];
          sourceIdentifier = match[3];
        } else if (pattern.source.includes("^discord_channel_")) {
          sourceType = "dchan";
          sourceIdentifier = match[1];
        } else if (pattern.source.includes("^discord_dm_")) {
          sourceType = "ddm";
          sourceIdentifier = match[1];
        } else if (pattern.source.includes("^cli_")) {
          sourceType = "cli";
          sourceIdentifier = match[1];
        } else if (pattern.source.includes("^work_project_")) {
          sourceType = "work_project";
          sourceIdentifier = match[1]; // 项目ID是关键
        }
        console.log(
          `   [ContextDetect] 解析到来源: 类型=${sourceType}, 标识符=${sourceIdentifier}`,
        );
        break; // 找到匹配即停止
      }
    }
    if (sourceType === "unknown") {
      console.log(`   [ContextDetect] 未能解析来源，将使用默认值。`);
    }

    // --- 根据LLM分类结果构建新的RAG上下文ID ---
    let newContextId = previousContextId; // 默认为不变
    const lowerResult = classificationResult.toLowerCase();

    if (lowerResult.startsWith("casual chat")) {
      newContextId = `casual_chat_${sourceType}_${sourceIdentifier}`;
    } else if (lowerResult.startsWith("work task/project")) {
      const parts = classificationResult.split(":");
      const identifier = parts.length > 1
        ? parts[1].trim().replace(/\s+/g, "_")
        : null; // 清理标识符
      if (identifier && identifier.length > 0) {
        newContextId = `work_project_${identifier}`; // 特定项目ID
      } else {
        newContextId = `work_general_${sourceType}_${sourceIdentifier}`; // 通用工作上下文
      }
    } else if (lowerResult.startsWith("info query")) {
      newContextId = `info_query_${sourceType}_${sourceIdentifier}`;
    } else if (lowerResult.startsWith("scheduling")) {
      newContextId = `scheduling_${sourceType}_${sourceIdentifier}`;
    } else if (lowerResult.startsWith("philosophical discussion")) {
      newContextId = `philosophical_${sourceType}_${sourceIdentifier}`;
    } else if (lowerResult.startsWith("emotional support")) {
      const parts = classificationResult.split(":");
      const emotion = parts.length > 1 ? parts[1].trim() : "general";
      newContextId = `emotional_${emotion}_${sourceType}_${sourceIdentifier}`;
    } else if (lowerResult.startsWith("other")) {
      newContextId = `other_${sourceType}_${sourceIdentifier}`;
    }
    // 如果分类结果无法匹配任何已知前缀，则保持不变

    if (newContextId !== previousContextId) {
      console.log(
        `   [ContextDetect] 💡 RAG 上下文自动切换: 从 "${previousContextId}" 到 "${newContextId}"`,
      );
    } else {
      console.log(
        `   [ContextDetect] RAG 上下文保持为: "${previousContextId}"`,
      );
    }
    return newContextId;
  } catch (error) {
    console.error("❌ [ContextDetect] 调用 LLM 进行上下文分类时出错:", error);
    console.log(
      "   [ContextDetect] ⚠️ 上下文分类失败，将沿用之前的 RAG 上下文 ID。",
    );
    return previousContextId; // 出错时保持不变
  }
}

/** 步骤 1: 决定 LTM 策略 */
async function decideLtmStrategy(
  ragContextId: string, // 使用已确定的 RAG 上下文 ID
): Promise<LtmStrategy> {
  console.log(
    `▶️ [LTM Strategy] 决定 LTM 策略 (RAG 上下文: ${ragContextId})...`,
  );

  // 工作相关上下文，使用精确检索+重排序
  if (ragContextId.startsWith("work_")) {
    console.log("   [LTM Strategy] -> 工作上下文，使用精确检索 (LTM_NOW)");
    return "LTM_NOW";
  } // 信息查询类上下文，也使用精确检索+重排序
  else if (ragContextId.startsWith("info_query_")) {
    console.log("   [LTM Strategy] -> 信息查询上下文，使用精确检索 (LTM_NOW)");
    return "LTM_NOW";
  } // 哲学讨论或需要深度思考的上下文，也用精确检索
  else if (ragContextId.startsWith("philosophical_")) {
    console.log("   [LTM Strategy] -> 哲学讨论上下文，使用精确检索 (LTM_NOW)");
    return "LTM_NOW";
  } // 闲聊、日程、情感支持、其他等场景，优先使用近期记忆
  else if (
    ragContextId.startsWith("casual_chat_") ||
    ragContextId.startsWith("scheduling_") ||
    ragContextId.startsWith("emotional_") ||
    ragContextId.startsWith("other_")
  ) {
    const contextType = ragContextId.split("_")[0];
    console.log(
      `   [LTM Strategy] -> ${contextType} 上下文，使用近期记忆 (LTM_RECENT)`,
    );
    return "LTM_RECENT";
  } // 无法识别或默认情况，保守起见使用近期记忆
  else {
    console.log(
      "   [LTM Strategy] -> 未知或默认上下文，使用近期记忆 (LTM_RECENT)",
    );
    return "LTM_RECENT";
  }
}

/** 步骤 3: 根据策略检索 LTM (增强版) */
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
    `▶️ [LTM Retrieve] 根据策略 "${strategy}" 检索 LTM (RAG 上下文: ${contextId})...`,
  );

  // --- 分支：根据策略执行不同的检索方法 ---
  if (strategy === "LTM_NOW") {
    // LTM_NOW: 精确向量搜索 + Rerank + 情感增强
    try {
      console.log(
        `   [LTM Retrieve] -> 🔍 精确向量搜索 (RAG 上下文: ${contextId})...`,
      );
      const searchVector = await embeddings.embedQuery(message.text);

      // 构建基础过滤器：匹配当前 RAG 上下文
      const baseFilter: Schemas["Filter"] = {
        must: [{ key: "source_context", match: { value: contextId } }],
        // 可以加入时间衰减过滤，忽略太旧且不重要的记忆
        // must_not: [ { key: "timestamp", range: { lt: Date.now() - 30 * 24 * 60 * 60 * 1000 } }, {key: "importance_score", range: { lt: 3 }} ] // 比如过滤掉30天前且重要性<3的
      };

      // 执行向量搜索
      const initialMemories = await searchMemories(
        config.qdrantCollectionName,
        searchVector,
        config.ragInitialRetrievalLimit,
        baseFilter,
      );
      console.log(
        `   [调试 LTM Retrieve] 初始向量搜索找到 ${initialMemories.length} 条结果 (上下文: ${contextId})。`,
      );

      // 转换结果格式以供 Reranker 使用
      const candidateMemories: CandidateMemory[] = initialMemories.map(
        (mem) => ({
          id: mem.id.toString(),
          score: mem.score,
          payload: mem.payload as MemoryPayload, // 类型断言
        }),
      );

      // 如果有向量记忆，执行重排序
      if (candidateMemories.length > 0) {
        console.log("   [LTM Retrieve] -> 🔄 执行 LTM 重排序...");
        const rerankedMemories: RerankedMemory[] = await rerankMemories(
          message.text,
          candidateMemories,
        );
        console.log(
          `   [调试 LTM Retrieve] 重排序后得到 ${rerankedMemories.length} 条结果。`,
        );

        // 如果重排序成功，使用重排序结果
        if (rerankedMemories.length > 0) {
          console.log("   [LTM Retrieve] -> ✅ 重排序成功，使用重排序的结果。");
          // 应用情感增强排序
          const emotionallyEnhancedMemories = enhanceMemoriesWithEmotion(
            rerankedMemories.map((m) => ({ ...m, score: m.rerank_score })), // 适配函数签名
            messageSentiment,
          ).map((m) => ({ ...m, rerank_score: m.score })); // 转换回 RerankedMemory 格式

          retrievedItems.push(
            ...emotionallyEnhancedMemories
              .slice(0, config.ragRerankTopN) // 取 Top N
              .map((mem): LtmContextItem => ({
                id: mem.id,
                payload: mem.payload,
                rerank_score: mem.rerank_score,
                source: "retrieved",
              })),
          );
        } else {
          // 重排序失败或无结果，则退回到使用初始向量搜索结果 (也应用情感增强)
          console.warn(
            "   [LTM Retrieve] -> ⚠️ 重排序失败或无结果，退回到初始向量搜索结果。",
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
              .slice(0, config.ragFallbackTopN) // 取回退的 Top N
              .map((mem): LtmContextItem => ({
                id: mem.id,
                payload: mem.payload,
                score: mem.score,
                source: "retrieved",
              })),
          );
        }
      } else {
        console.log("   [LTM Retrieve] -> ℹ️ 初始向量搜索无结果。");
      }

      // 情感相关记忆补充 (LTM_NOW策略下也执行)
      await supplementWithEmotionalMemories(
        retrievedItems,
        message,
        searchVector,
        contextId,
        messageSentiment,
      );
    } catch (error) {
      console.error(
        `❌ [LTM Retrieve] LTM_NOW 检索过程中出错 (${contextId}):`,
        error instanceof Error ? error.message : error,
      );
    }
  } else if (strategy === "LTM_RECENT") {
    // LTM_RECENT: 获取最近的记忆 + 情感增强 + 可能的情感补充
    try {
      console.log(
        `   [LTM Retrieve] -> 🕒 获取最近 ${config.ragRecentLtmLimit} 条 LTM (RAG 上下文: ${contextId})...`,
      );
      // 使用 Qdrant scroll API 获取点
      const scrollResult = await qdrantClient.scroll(
        config.qdrantCollectionName,
        {
          limit: config.ragRecentLtmLimit * 3, // 多获取一些以便排序和过滤
          with_payload: true,
          with_vector: false,
          filter: { // 只获取当前上下文的
            must: [{ key: "source_context", match: { value: contextId } }],
          },
          order_by: { key: "timestamp", direction: "desc" }, // 尝试按时间戳排序
        },
      );
      console.log(
        `   [调试 LTM Retrieve] 最近记忆滚动查询找到 ${scrollResult.points.length} 个点 (上下文: ${contextId})。`,
      );

      if (scrollResult.points.length > 0) {
        // 确保按时间戳降序排序 (以防 order_by 不生效)
        scrollResult.points.sort((a, b) =>
          (b.payload?.timestamp as number || 0) -
          (a.payload?.timestamp as number || 0)
        );

        // 情感增强排序：优先选择情感上匹配的记忆
        const emotionallyEnhancedPoints = enhanceMemoriesWithEmotion(
          scrollResult.points.map((p) => ({
            id: p.id.toString(),
            score: p.payload?.timestamp || 0,
            payload: p.payload as MemoryPayload,
          })), // 用时间戳作为排序分数代理
          messageSentiment,
        );

        retrievedItems.push(
          ...emotionallyEnhancedPoints
            .slice(0, config.ragRecentLtmLimit) // 取最终限制的数量
            .map((mem): LtmContextItem => ({
              id: mem.id,
              payload: mem.payload,
              // score: mem.score, // 这里 score 是时间戳，不适合展示
              source: "recent",
            })),
        );
        console.log(
          `   [LTM Retrieve] -> ✅ 获取并情感增强排序了 ${retrievedItems.length} 条最近记忆。`,
        );
      } else {
        console.log(
          `   [LTM Retrieve] -> ℹ️ 在 RAG 上下文 ${contextId} 中未找到最近的 LTM。`,
        );
      }

      // 情感相关记忆补充 (LTM_RECENT策略下也执行)
      const searchVector = await embeddings.embedQuery(message.text); // 需要查询向量
      await supplementWithEmotionalMemories(
        retrievedItems,
        message,
        searchVector,
        contextId,
        messageSentiment,
      );
    } catch (error) {
      console.error(
        `❌ [LTM Retrieve] LTM_RECENT 检索过程中出错 (${contextId}):`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  // --- 补充通用对话记忆 (统一逻辑：无论哪种策略，结果不足都尝试补充) ---
  const needsSupplement = retrievedItems.length < config.ragMaxMemoriesInPrompt;
  const supplementLimit = config.ragMaxMemoriesInPrompt - retrievedItems.length;

  if (needsSupplement && supplementLimit > 0) {
    console.log(
      `   [LTM Retrieve] -> ℹ️ (${strategy})结果不足 ${config.ragMaxMemoriesInPrompt} 条，尝试补充通用相关记忆 (不过滤上下文)...`,
    );
    try {
      const searchVector = await embeddings.embedQuery(message.text); // 为补充搜索生成向量
      // 构建补充搜索的过滤器：排除已有的条目
      const supplementFilter: Schemas["Filter"] = {
        must_not: [{ has_id: retrievedItems.map((item) => item.id) }],
        // 可以增加过滤条件，例如只补充对话类型的记忆
        // must: [{ key: "memory_type", match: { value: "conversation_turn" } }]
      };
      console.log(
        `   [调试 LTM Retrieve] 补充搜索过滤器: ${
          JSON.stringify(supplementFilter)
        }`,
      );

      // 执行补充的向量搜索（不过滤上下文）
      const supplementMemories = await searchMemories(
        config.qdrantCollectionName,
        searchVector,
        supplementLimit, // 只补充所需的数量
        supplementFilter,
      );
      console.log(
        `   [调试 LTM Retrieve] 补充搜索找到 ${supplementMemories.length} 条结果。`,
      );

      if (supplementMemories.length > 0) {
        // 将补充的记忆添加到结果列表中
        retrievedItems.push(
          ...supplementMemories.map((mem): LtmContextItem => ({
            id: mem.id.toString(),
            payload: mem.payload as MemoryPayload,
            score: mem.score, // 补充的记忆有 score
            source: "retrieved", // 标记为 retrieved
          })),
        );
        console.log(
          `   [LTM Retrieve] -> ✅ 补充了 ${supplementMemories.length} 条通用记忆。`,
        );
      } else {
        console.log("   [LTM Retrieve] -> ℹ️ 未找到可补充的通用记忆。");
      }
    } catch (error) {
      console.error(
        `❌ [LTM Retrieve] 补充通用记忆时出错:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  // --- 最终限制、排序和去重 ---
  // 统一排序逻辑：优先显示 rerank_score 高的，其次 score 高的 (包含情感调整后的分数)，
  // 如果分数相同或都没有分数（比如都是 recent 无情感匹配），则按时间戳降序（最新的在前）
  retrievedItems.sort((a, b) => {
    // 主要分数：rerank > score > 无分数
    const scoreA = a.rerank_score ?? a.score ?? -Infinity;
    const scoreB = b.rerank_score ?? b.score ?? -Infinity;

    if (scoreB !== scoreA) {
      return scoreB - scoreA; // 分数降序
    }

    // 分数相同，比较时间戳
    const timeA = a.payload.timestamp || 0;
    const timeB = b.payload.timestamp || 0;
    if (timeB !== timeA) {
      return timeB - timeA; // 时间戳降序（新的在前）
    }

    // 如果分数和时间戳都相同，保持原始相对顺序（或视为相等）
    return 0;
  });

  // 去重：确保每个 LTM 条目只出现一次
  const uniqueItems = retrievedItems.filter((item, index, self) =>
    index === self.findIndex((t) => t.id === item.id)
  );
  // 截取最终数量：确保不超过配置的最大数量
  const finalItems = uniqueItems.slice(0, config.ragMaxMemoriesInPrompt);

  // --- 为最终结果添加时间上下文和衰减因子 ---
  const finalItemsWithTemporal = await enhanceMemoriesWithTemporalContext(
    finalItems,
    message.userId,
    contextId,
    kv,
  );

  // 打印最终 LTM 列表的调试信息
  console.log(
    `   [调试 LTM Retrieve] 最终 LTM 列表 (共 ${finalItemsWithTemporal.length} 条，已排序去重和时间增强):`,
  );
  finalItemsWithTemporal.forEach((item, idx) => {
    console.log(
      `     [${idx + 1}] ID: ${item.id}, Src: ${item.source}, Score: ${
        item.rerank_score?.toFixed(4) ?? item.score?.toFixed(4) ?? "N/A"
      }, Time: ${item.temporal_context || "N/A"}, Decay: ${
        item.decay_factor?.toFixed(2)
      }, Type: ${item.payload.memory_type}`,
    );
  });

  console.log(
    `✅ [LTM Retrieve] LTM 检索完成，最终返回 ${finalItemsWithTemporal.length} 条记忆 (策略: ${strategy})。`,
  );
  return finalItemsWithTemporal; // 返回最终处理后的 LTM 列表
}

/** 辅助函数：补充情感相关记忆 */
async function supplementWithEmotionalMemories(
  retrievedItems: LtmContextItem[],
  message: ChatMessageInput,
  searchVector: number[],
  contextId: string,
  messageSentiment: {
    valence: number;
    arousal: number;
    emotionDimensions: { [key in EmotionDimension]?: number };
  },
): Promise<void> {
  const needsSupplement = retrievedItems.length < config.ragMaxMemoriesInPrompt;
  const supplementLimit = config.ragMaxMemoriesInPrompt - retrievedItems.length;

  if (needsSupplement && supplementLimit > 0 && config.timePerception.enabled) { // 只有启用时间/情感模块才补充
    console.log("   [LTM Retrieve] -> 🌈 尝试补充情感相关记忆...");
    try {
      // 确定情感查询范围
      const valenceRange: [number, number] = messageSentiment.valence > 0.3
        ? [0.3, 1.0] // 积极
        : messageSentiment.valence < -0.3
        ? [-1.0, -0.3] // 消极
        : [-0.3, 0.3]; // 中性
      const arousalRange: [number, number] = messageSentiment.arousal > 0.6
        ? [0.6, 1.0] // 高唤醒
        : [0, 0.6]; // 低/中唤醒
      const dominantEmotion = getDominantEmotion(
        messageSentiment.emotionDimensions,
      );

      // 执行情感搜索
      const emotionalMemories = await searchMemoriesByEmotion(
        config.qdrantCollectionName,
        searchVector, // 使用原始查询向量进行相关性过滤
        supplementLimit,
        {
          valenceRange,
          arousalRange,
          dominantEmotion,
          contextFilter: contextId, // 在当前上下文中查找
          minimumScore: 0.5, // 设置一个向量相关性阈值，避免完全不相关的结果
        },
      );

      // 过滤掉已经检索到的记忆
      const existingIds = new Set(retrievedItems.map((item) => item.id));
      const newEmotionalMemories = emotionalMemories.filter(
        (mem) => !existingIds.has(mem.id.toString()),
      );

      if (newEmotionalMemories.length > 0) {
        console.log(
          `   [LTM Retrieve] -> ✨ 补充了 ${newEmotionalMemories.length} 条情感相关记忆。`,
        );
        retrievedItems.push(
          ...newEmotionalMemories.map((mem): LtmContextItem => ({
            id: mem.id.toString(),
            payload: mem.payload as MemoryPayload,
            score: mem.score, // 保留向量分数
            source: "emotional", // 标记为情感来源
          })),
        );
      } else {
        console.log("   [LTM Retrieve] -> ℹ️ 未找到可补充的情感记忆。");
      }
    } catch (emotionalError) {
      console.error(
        "   [LTM Retrieve] -> ❌ 补充情感记忆时出错:",
        emotionalError,
      );
    }
  }
}

/** 辅助函数：基于情感状态增强记忆列表排序 */
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
  if (!config.timePerception.enabled) return memories; // 如果时间感知（包含情感）未启用，则不增强

  // 为每个记忆计算情感匹配分数
  const scoredMemories = memories.map((memory) => {
    const emotionalMatch = calculateEmotionalMatch(
      memory.payload,
      messageSentiment,
    );
    const originalScore = memory.score ?? 0; // 使用原始分数（可能是 rerank 或 向量分数 或 时间戳）

    // 调整原始排序分数，融合情感匹配度
    // 公式: 70% 原始分数重要性 + 30% 情感匹配分数重要性
    // 需要将原始分数归一化，或者使用加权方式
    // 简化：直接加权调整 (效果可能不理想，需要测试调整)
    const adjustedScore = originalScore * 0.7 +
      emotionalMatch * 0.3 * (originalScore > 0 ? Math.abs(originalScore) : 1); // 用情感匹配调整分数

    return {
      ...memory,
      score: adjustedScore, // 更新分数用于排序
    };
  });

  // 按调整后的分数重新排序
  return scoredMemories.sort((a, b) =>
    (b.score ?? -Infinity) - (a.score ?? -Infinity)
  );
}

/** 辅助函数：计算两个情感状态之间的匹配度 */
function calculateEmotionalMatch(
  memoryPayload: MemoryPayload,
  messageSentiment: {
    valence: number;
    arousal: number;
    emotionDimensions: { [key in EmotionDimension]?: number };
  },
): number {
  // 如果记忆没有情感数据，返回中性匹配度 0.5
  const memValence = memoryPayload.emotional_valence;
  const memArousal = memoryPayload.emotional_arousal;
  const memDimensions = memoryPayload.emotional_dimensions;

  if (memValence === undefined || memArousal === undefined || !memDimensions) {
    return 0.5;
  }

  // 1. 效价匹配度 (cosine similarity like: 1 - distance)
  // (1 - abs(v1 - v2) / 2) => range [0, 1]
  const valenceMatch = 1 - Math.abs(memValence - messageSentiment.valence) / 2;

  // 2. 唤醒度匹配度 (1 - distance)
  const arousalMatch = 1 - Math.abs(memArousal - messageSentiment.arousal);

  // 3. 情感维度向量余弦相似度 (简化)
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

  let dimensionSimilarity = 0.5; // Default to neutral if magnitudes are zero
  if (magnitudeA > 0 && magnitudeB > 0) {
    dimensionSimilarity = dotProduct /
      (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
    dimensionSimilarity = (dimensionSimilarity + 1) / 2; // Normalize to [0, 1]
  }

  // 加权组合匹配度分数
  // 调整权重：效价40%，唤醒度20%，维度40%
  return valenceMatch * 0.4 + arousalMatch * 0.2 + dimensionSimilarity * 0.4;
}

/** 步骤 4: 基于记忆、洞见、状态生成回应 (增强版) */
async function generateResponseWithMemory(
  message: ChatMessageInput, // 包含 RAG Context ID
  stmHistory: ChatMessageInput[],
  retrievedLtm: LtmContextItem[], // 已包含时间上下文和衰减因子
  ltmStrategy: LtmStrategy,
  _personaMode: string, // 不再直接使用
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
  relationshipState: RelationshipState | null = null,
): Promise<string> {
  console.log(
    `🧠 [Generator] 正在融合记忆、洞见和状态生成回复 (RAG 上下文: ${message.contextId})...`,
  );

  // --- 构建 Prompt 上下文 ---
  // STM 上下文
  const stmContext = stmHistory
    .slice(0, -1) // 排除当前消息
    .slice(-5) // 取最近 5 条
    .map((msg, i) =>
      `[近期对话 ${i + 1} | ${
        msg.userId === message.userId ? "You" : msg.userId
      }]: ${msg.text}`
    )
    .join("\n");

  // LTM 上下文 (包含时间表达和清晰度)
  const ltmSectionTitle = ltmStrategy === "LTM_NOW"
    ? "相关长期记忆 (LTM)"
    : "最近长期记忆 (LTM)";
  const ltmContext = retrievedLtm.length > 0
    ? retrievedLtm.map((mem, i) => {
      const scoreDisplay = mem.rerank_score?.toFixed(4) ??
        mem.score?.toFixed(4) ?? "N/A";
      const timeDisplay = mem.temporal_context || "未知时间";
      const clarity = mem.decay_factor
        ? `清晰度: ${Math.round(mem.decay_factor * 100)}%`
        : "";
      const sourceLabel = mem.source === "recent"
        ? "最近"
        : mem.source === "emotional"
        ? "情感相关"
        : "相关";
      return `[${sourceLabel}记忆 ${
        i + 1
      } | ${timeDisplay} | ${clarity} | 得分: ${scoreDisplay}]: ${mem.payload.text_content}`;
    }).join("\n")
    : "   （无相关长期记忆）";

  // 思维洞见上下文
  const insightsContext = insights.length > 0
    ? insights.map((insight, i) =>
      `[思维洞见 ${
        i + 1
      } | 类型: ${insight.insight_type}]: "${insight.content}"`
    ).join("\n")
    : "   （无相关洞见）";

  // 时间标记上下文
  const timeMarkersContext = timeMarkers.length > 0
    ? timeMarkers.map((marker, i) =>
      `[时间标记 ${i + 1} | ${
        generateTimeExpression(Date.now() - marker.timestamp)
      }前]: "${marker.description}"`
    ).join("\n")
    : "   （无相关时间标记）";

  // 身体状态上下文
  let bodyStateContext = "   （身体状态正常）";
  if (bodyState && config.virtualEmbodiment.enabled) {
    bodyStateContext = `
[内部状态感知]:
- ${bodyExpressions.energy || generateBodyStateExpression(bodyState)}
${
      bodyExpressions.metaphorical
        ? `- 隐喻感受: ${bodyExpressions.metaphorical}`
        : ""
    }
${bodyExpressions.sensory ? `- 感官体验: ${bodyExpressions.sensory}` : ""}
${bodyExpressions.posture ? `- 姿态表达: ${bodyExpressions.posture}` : ""}
`;
  }

  // 关系状态上下文
  const relationshipContext = relationshipState && config.socialDynamics.enabled
    ? `[与此用户的关系]: ${
      getRelationshipSummary(relationshipState)
    } (互动风格: ${relationshipState.current_interaction_style}, 界限: ${
      relationshipState.boundary_level.toFixed(1)
    })`
    : "   （关系状态未知或默认）";

  // 当前消息情感状态
  const messageSentiment = await analyzeMessageSentiment(message.text);
  const emotionKeywords = getEmotionKeywords(messageSentiment); // 获取情感关键词

  // 获取当前时间
  const currentDate = new Date().toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour12: false,
  });

  // 平台特定指令
  let platformInstructions = "";
  // ... (平台指令逻辑保持不变) ...
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

  // --- 构建最终 Prompt ---
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
* **当前时间:** ${currentDate} (台北)
* **对话用户:** ${message.userId}${
    message.userId === config.discordOwnerId ? " (主人)" : ""
  }
* **当前关系:** ${relationshipContext}
* **对话上下文 (RAG ID):** ${message.contextId} (${
    message.contextId.startsWith("work_") ? "工作场景" : "非工作场景"
  })
* **身体状态感知:** ${bodyStateContext}
* **用户最新消息:** ${message.text}
* **用户情感感知:** ${formatEmotionState(messageSentiment)} (关键词: ${
    emotionKeywords.join(", ")
  })
* **核心任务:** 针对用户的最新消息，以爱丽丝的身份给出自然、连贯、个性化且符合当前情境的回应。

## 辅助信息 (供你参考，不要直接复述)
1.  **最近对话历史 (STM):**
${stmContext || "   （无）"}
2.  **${ltmSectionTitle}:**
${ltmContext}
3.  **思维洞见:**
${insightsContext}
4.  **相关时间标记:**
${timeMarkersContext}

## 回应要求
* **深度角色扮演:** 彻底代入爱丽丝，用“我”来自称，从她的视角、感受和思考方式出发进行回应。
* **情境融合:** 自然地结合当前用户、关系、上下文、情绪、身体状态、时间和记忆信息，使回应高度个性化。
* **动态表达:**
    * **社交适应:** 根据关系状态调整语气、亲近感和用词。对主人要体现傲娇和关心。
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

  // 打印最终 Prompt 用于调试
  console.log(
    `[调试 Generator] 发送给 LLM 的最终 Prompt:\n------BEGIN PROMPT------\n${generationPrompt}\n------END PROMPT------`,
  );

  let responseText = "[默认回复：处理中...]"; // 默认回复
  try {
    // 调用 LLM 生成回复
    const llmResponse = await llm.invoke(generationPrompt, {
      temperature: 0.75, // 稍微提高温度以增加自然度
      // 可以根据身体状态动态调整温度？低能量低温度？
    });
    responseText = typeof llmResponse === "string"
      ? llmResponse
      : (llmResponse.content as string) ?? "";
    console.log("   [Generator] ✅ LLM 回复已生成。");

    // --- 应用人类语言模式 ---
    console.log("   [Generator] ✨ 应用人类语言模式...");
    const isWorkContext = message.contextId.includes("work_");
    const isOwner = message.userId === config.discordOwnerId;
    const isQuestionResponse = message.text.includes("?") ||
      message.text.includes("？") ||
      /^(what|how|why|when|where|who|什么|怎么|为什么)/i.test(message.text);

    // 构建人类化处理的上下文
    const humanizeContext = {
      is_work_context: isWorkContext,
      is_owner: isOwner,
      is_question_response: isQuestionResponse,
      emotional_state: {
        valence: messageSentiment.valence,
        arousal: messageSentiment.arousal,
        dominant_emotion: messageSentiment.dominant_emotion,
      },
      character_style: `关系风格: ${
        relationshipState?.current_interaction_style || "default"
      }. 身体感受: ${bodyExpressions.energy || "正常"}.`,
    };

    // 根据配置选择基础或高级人类化处理
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
        console.log("   [Generator] ✅ 应用高级人类语言模式成功。");
      } catch (advError) {
        console.error(
          "   [Generator] ⚠️ 高级人类化处理失败，回退到基础处理:",
          advError,
        );
        humanizedResponse = humanizeText(responseText, humanizeContext);
        console.log("   [Generator] ✅ 应用基础人类语言模式成功 (回退)。");
      }
    } else {
      humanizedResponse = humanizeText(responseText, humanizeContext);
      console.log("   [Generator] ✅ 应用基础人类语言模式成功。");
    }

    // 返回最终处理后的文本
    return humanizedResponse || responseText || "[LLM 返回了空内容]";
  } catch (error) {
    console.error("❌ [Generator] 调用 LLM 或人类化处理时出错:", error);
    // 根据身体状态返回不同的错误提示
    let errorResponse = "[抱歉，处理请求时遇到了意外情况。请稍后再试。]";
    if (bodyState && bodyState.coherence_level < 0.3) {
      errorResponse = "[嗯...抱歉，我现在思绪有点混乱，请稍等一下再问我。]";
    } else if (bodyState && bodyState.energy_level < 0.2) {
      errorResponse = "[抱歉，我现在感觉有点累...请稍后再试。]";
    }
    return errorResponse;
  }
}

/** 辅助函数：格式化情感状态 */
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

/** 辅助函数：获取情感关键词 */
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
  if (dominant !== "neutral") keywords.push(dominant); // 添加主导情绪

  return [...new Set(keywords)].slice(0, 3); // 去重并限制数量
}

/** 检测重要消息，判断是否应创建时间标记 */
async function detectImportantMessage(messageText: string): Promise<
  {
    description: string;
    significance: number; // 0-1
    isMilestone: boolean;
  } | null
> {
  if (!config.timePerception.enabled) return null;

  // 简单的基于关键词和长度的规则 (可以替换为LLM)
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
    messageText.length > 150; // 长消息也可能重要

  if (!isImportant) return null;

  // 使用 LLM 进一步判断和提取描述
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
    const result = JSON.parse(content.trim().replace(/```json|```/g, ""));

    if (result.important && result.description) {
      return {
        description: result.description.substring(0, 50), // 限制长度
        significance: Math.max(0, Math.min(1, result.significance || 0.5)),
        isMilestone: result.is_milestone || false,
      };
    }
    return null;
  } catch (error) {
    console.error("检测重要消息时出错:", error);
    return null; // 出错则认为不重要
  }
}

// --------------------------------------------------------------------------
// --- 核心处理函数：handleIncomingMessage ---
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
  initialContextId: string, // 函数接收初始 RAG 上下文
  platform: string,
): Promise<{ responseText: string; newContextId: string }> {
  const startTime = Date.now();
  const userId = message.userId;
  const sourceContextId = message.contextId; // 原始来源 (e.g., discord_channel_123)

  console.log(
    `\n🚀 [Core] 开始处理消息 (用户: ${userId}, 来源: ${sourceContextId}, 初始RAG上下文: ${initialContextId})`,
  );

  // --- 0. 更新活跃用户和上下文 ---
  updateActiveUserContexts(userId, sourceContextId);

  // --- 1. 获取 STM ---
  console.log(`   [Core] 1. 获取 STM...`);
  // 使用 sourceContextId 获取对应频道的STM
  const stmHistory = await getStm(sourceContextId);
  console.log(
    `   [Core]    - STM 记录数: ${stmHistory.length} (来源: ${sourceContextId})`,
  );

  // --- 2. 自动判断/切换 RAG 上下文 ---
  console.log(`   [Core] 2. 判断/更新 RAG 上下文...`);
  const ragContextId = await determineCurrentContext(
    userId,
    initialContextId, // 传入当前的 RAG 上下文
    stmHistory,
    message,
  );
  // 更新 message 对象的 contextId 为 RAG 上下文 ID，后续流程都使用这个
  message.contextId = ragContextId;
  console.log(`   [Core]    - 当前 RAG 上下文: ${ragContextId}`);

  // --- 3. 更新 STM ---
  console.log(`   [Core] 3. 更新 STM (来源: ${sourceContextId})...`);
  const updatedStm = await updateStm(sourceContextId, message);

  // --- 4. 异步 LTM 存储 ---
  if (ltmWorker && config.qdrantCollectionName) {
    console.log(`   [Core] 4. 异步提交 LTM 存储...`);
    ltmWorker.postMessage({ ...message, contextId: sourceContextId }); // 使用原始 sourceContextId 存储
  } else {
    console.warn(
      `   [Core] 4. ⚠️ LTM Worker 未初始化或 Qdrant 未配置，跳过异步 LTM 存储。`,
    );
  }

  // --- 5. 分析消息情感 ---
  console.log(`   [Core] 5. 分析消息情感...`);
  const messageSentiment = await analyzeMessageSentiment(message.text);
  console.log(
    `   [Core]    - 情感分析结果: 效价=${
      messageSentiment.valence.toFixed(2)
    }, 强度=${
      messageSentiment.arousal.toFixed(2)
    }, 主导=${messageSentiment.dominant_emotion}`,
  );

  // --- 6. 更新认知状态 (并行) ---
  console.log(`   [Core] 6. 并行更新认知状态 (身体、关系、时间)...`);
  let updatedBodyState: VirtualPhysicalState | null = null;
  let updatedRelationshipState: RelationshipState | null = null;
  let conversationPace = 1.0;

  const stateUpdatePromises = [];
  // 更新身体状态
  if (config.virtualEmbodiment.enabled) {
    stateUpdatePromises.push(
      (async () => {
        updatedBodyState = await processMessageAndUpdateState(
          userId,
          ragContextId, // 使用 RAG 上下文 ID
          {
            text: message.text,
            emotional_state: {
              valence: messageSentiment.valence,
              arousal: messageSentiment.arousal,
              dominant_emotion: messageSentiment.dominant_emotion,
            },
          },
          false, // false 表示这是用户输入，而非 AI 回复
          kv,
        );
        console.log(
          `   [Core]    - ✅ 身体状态更新完成 (能量: ${
            updatedBodyState?.energy_level.toFixed(2)
          })`,
        );
      })(),
    );
  }
  // 更新关系状态
  if (config.socialDynamics.enabled) {
    stateUpdatePromises.push(
      (async () => {
        updatedRelationshipState = await analyzeInteractionImpact(
          userId,
          { text: message.text, timestamp: message.timestamp || Date.now() },
          {
            valence: messageSentiment.valence,
            arousal: messageSentiment.arousal,
            dominant_emotion: messageSentiment.dominant_emotion,
          },
          ragContextId, // 使用 RAG 上下文 ID
          kv,
        );
        console.log(
          `   [Core]    - ✅ 关系状态更新完成 (风格: ${updatedRelationshipState?.current_interaction_style}, 界限: ${
            updatedRelationshipState?.boundary_level.toFixed(1)
          })`,
        );
      })(),
    );
  }
  // 更新时间状态 (记录交互 + 分析节奏)
  if (config.timePerception.enabled) {
    stateUpdatePromises.push(
      (async () => {
        await recordInteractionTimestamp(userId, ragContextId, kv); // 使用 RAG Context ID
        conversationPace = await analyzeConversationPace(
          userId,
          ragContextId, // 使用 RAG Context ID
          message.text,
          kv,
        );
        console.log(
          `   [Core]    - ✅ 时间状态更新完成 (记录交互, 感知速度: ${
            conversationPace.toFixed(2)
          })`,
        );
      })(),
    );
  }
  // 等待所有状态更新完成
  await Promise.all(stateUpdatePromises);

  // --- 7. 决定 LTM 检索策略 ---
  console.log(`   [Core] 7. 决定 LTM 策略...`);
  const ltmStrategy = await decideLtmStrategy(ragContextId);

  // --- 8. 检索 LTM ---
  console.log(`   [Core] 8. 检索 LTM...`);
  const retrievedLtm = await retrieveLtmBasedOnStrategy(
    ltmStrategy,
    message, // message.contextId 已更新为 ragContextId
    messageSentiment,
  );

  // --- 9. 检索相关洞见 (异步执行，不阻塞主流程) ---
  let relevantInsights: Insight[] = [];
  if (config.mindWandering.enabled) {
    console.log(`   [Core] 9. 异步检索相关洞见...`);
    retrieveRelevantInsights(message, 2) // 限制数量
      .then((insights) => {
        relevantInsights = insights;
        if (insights.length > 0) {
          console.log(
            `   [Core]    - 异步检索到 ${insights.length} 条相关洞见`,
          );
        }
      })
      .catch((err) => console.error("   [Core]    - ❌ 检索洞见失败:", err));
  }

  // --- 10. 检测重要消息并创建时间标记 (异步) ---
  let relevantTimeMarkers: TimeMarker[] = [];
  if (config.timePerception.enabled) {
    console.log(`   [Core] 10. 异步检测重要消息 & 检索时间标记...`);
    // 检测当前消息是否重要
    detectImportantMessage(message.text)
      .then((importantInfo) => {
        if (importantInfo) {
          console.log(
            `   [Core]    - ℹ️ 检测到重要消息，正在添加时间标记: "${importantInfo.description}"`,
          );
          return addTimeMarker(
            userId,
            ragContextId, // 使用 RAG Context ID
            importantInfo.description,
            importantInfo.significance,
            importantInfo.isMilestone,
            kv,
          );
        }
      })
      .catch((err) =>
        console.error("   [Core]    - ❌ 检测重要消息失败:", err)
      );
    // 检索相关时间标记
    findRelevantTimeMarkers(userId, ragContextId, message.text, kv) // 使用 RAG Context ID
      .then((markers) => {
        relevantTimeMarkers = markers;
        if (markers.length > 0) {
          console.log(
            `   [Core]    - 异步检索到 ${markers.length} 条相关时间标记`,
          );
        }
      })
      .catch((err) =>
        console.error("   [Core]    - ❌ 检索时间标记失败:", err)
      );
  }

  // --- 11. 生成身体状态表达 (异步) ---
  let bodyExpressions = {
    metaphorical: "",
    sensory: "",
    posture: "",
    energy: "",
  };
  if (config.virtualEmbodiment.enabled && updatedBodyState) {
    console.log(`   [Core] 11. 异步生成身体状态表达...`);
    generateEmbodiedExpressions(updatedBodyState)
      .then((expressions) => {
        if (expressions && expressions.expressions) {
          bodyExpressions = expressions.expressions;
          console.log(
            `   [Core]    - 异步生成身体表达: ${expressions.expressions.energy}`,
          );
        }
      })
      .catch((err) =>
        console.error("   [Core]    - ❌ 生成身体表达失败:", err)
      );
  }

  // --- 12. 生成最终响应 (等待异步洞见/标记/表达检索完成 - 设置超时) ---
  console.log(`   [Core] 12. 等待异步任务并生成最终响应...`);
  const asyncTimeout = 2000; // 2秒超时
  await Promise.race([
    Promise.all([ // 等待洞见、标记、身体表达
      new Promise<void>((resolve) => { // 洞见
        const checkInsights = () => {
          if (relevantInsights.length > 0 || !config.mindWandering.enabled) {
            resolve();
          } else setTimeout(checkInsights, 50);
        };
        if (!config.mindWandering.enabled) resolve();
        else checkInsights();
      }),
      new Promise<void>((resolve) => { // 时间标记
        const checkMarkers = () => {
          if (
            relevantTimeMarkers.length > 0 || !config.timePerception.enabled
          ) {
            resolve();
          } else setTimeout(checkMarkers, 50);
        };
        if (!config.timePerception.enabled) resolve();
        else checkMarkers();
      }),
      new Promise<void>((resolve) => { // 身体表达
        const checkBodyExpr = () => {
          if (
            bodyExpressions.energy || !config.virtualEmbodiment.enabled ||
            !updatedBodyState
          ) {
            resolve();
          } else setTimeout(checkBodyExpr, 50);
        };
        if (!config.virtualEmbodiment.enabled || !updatedBodyState) {
          resolve();
        } else checkBodyExpr();
      }),
    ]),
    new Promise((resolve) => setTimeout(resolve, asyncTimeout)), // 超时保护
  ]);
  console.log(`   [Core]     - 异步任务完成或超时。准备生成...`);

  // 调用生成函数
  const finalResponse = await generateResponseWithMemory(
    message, // message.contextId 已更新为 ragContextId
    updatedStm,
    retrievedLtm,
    ltmStrategy,
    "", // personaMode 不再直接传递
    platform,
    relevantInsights, // 使用已获取的洞见
    relevantTimeMarkers, // 使用已获取的时间标记
    updatedBodyState, // 使用更新后的身体状态
    bodyExpressions, // 使用生成的身体表达
    updatedRelationshipState, // 使用更新后的关系状态
  );

  // --- 13. 触发思维漫游 (概率性 & 异步) ---
  if (config.mindWandering.enabled && Math.random() < 0.15) { // 15% 概率触发
    console.log(`   [Core] 13. 概率触发思维漫游...`);
    const lastWander = await getLastWanderingTime(userId, ragContextId);
    if (Date.now() - lastWander > 5 * 60 * 1000) { // 5分钟冷却
      const wanderingContext: WanderingContext = {
        user_id: userId,
        context_id: ragContextId, // 使用 RAG 上下文 ID
        recent_topics: extractRecentTopics(updatedStm),
        emotional_state: {
          valence: messageSentiment.valence,
          arousal: messageSentiment.arousal,
        },
        last_wandering_time: lastWander,
      };
      triggerMindWandering(wanderingContext)
        .then((result) => {
          if (result.insights.length > 0) {
            console.log(
              `   [Core]    - ✨ 思维漫游完成，生成 ${result.insights.length} 条洞见。`,
            );
            setLastWanderingTime(userId, ragContextId, Date.now()); // 更新上次漫游时间
          }
        })
        .catch((err) =>
          console.error("   [Core]    - ❌ 思维漫游执行失败:", err)
        );
    } else {
      console.log("   [Core]    - 冷却中，跳过思维漫游。");
    }
  } else {
    console.log(`   [Core] 13. 跳过思维漫游 (概率或禁用)。`);
  }

  const endTime = Date.now();
  console.log(
    `✅ [Core] 消息处理完成 (总耗时: ${(endTime - startTime) / 1000} 秒)`,
  );

  // --- 返回结果 ---
  return { responseText: finalResponse, newContextId: ragContextId }; // 返回包含更新后上下文 ID 的结果
}

// --- 主函数：程序入口 ---
async function main() {
  console.log("==============================================");
  console.log("  AI 人格核心 - 爱丽丝 v8.0 (进化版)");
  console.log("==============================================");
  console.log("▶️ 系统初始化中...");

  // 解析命令行参数
  const args = parse(Deno.args);
  const runDiscord = args.discord === true;

  // --- 并行执行初始化任务 ---
  await Promise.all([
    initializeKv(), // 初始化 STM 和状态存储
    initializeLtmWorker(), // 初始化 LTM Worker
    (async () => { // 初始化 Qdrant 检查
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
    // 启动思维漫游功能 (如果启用)
    (async () => {
      if (config.mindWandering.enabled) { // 检查配置是否启用
        try {
          // 注意：schedulePeriodicMindWandering 依赖 activeUserContexts
          // 它会在 handleIncomingMessage 中填充，所以这里只是启动任务框架
          await schedulePeriodicMindWandering(activeUserContexts);
          console.log("✅ 思维漫游系统初始化完成。");
        } catch (error) {
          console.error("⚠️ 思维漫游系统初始化失败:", error);
        }
      } else {
        console.log("ℹ️ 思维漫游系统已禁用。");
      }
    })(),
  ]);

  console.log("----------------------------------------------");
  console.log(`🚀 准备启动模式: ${runDiscord ? "Discord Bot" : "CLI"}`);
  console.log("----------------------------------------------");

  // --- 根据模式启动相应的接口 ---
  if (runDiscord) {
    await startDiscord(); // 启动 Discord 接口
    console.log(
      "⏳ Discord Bot 正在运行，主程序将保持活动状态。按 Ctrl+C 退出。",
    );
    // 保持进程活跃
    await new Promise(() => {});
  } else {
    await startCli(); // 启动命令行接口
  }

  // --- 清理逻辑 ---
  console.log("\n▶️ 程序即将退出，正在清理资源...");
  if (ltmWorker) {
    ltmWorker.terminate();
    console.log("✅ LTM Worker 已终止。");
  }
  if (kv) {
    kv.close();
    console.log("✅ Deno KV 连接已关闭。");
  }
  console.log("👋 再见!");
}

// --- 脚本入口点 ---
if (import.meta.main) {
  main().catch((error) => {
    console.error("❌ 主程序出现未捕获错误:", error);
    try {
      if (ltmWorker) ltmWorker.terminate();
    } catch (_) { /* Ignore */ }
    try {
      if (kv) kv.close();
    } catch (_) { /* Ignore */ }
    Deno.exit(1); // 异常退出
  });

  // 添加 'unload' 事件监听器 (尽力而为的清理)
  globalThis.addEventListener("unload", () => {
    console.log("⏹️ 检测到程序退出信号 ('unload' 事件)...");
    // 这里的清理可能不完全可靠
    try {
      if (ltmWorker) ltmWorker.terminate();
    } catch (_) {}
    try {
      if (kv) kv.close();
    } catch (_) {}
    console.log("⏹️ 'unload' 事件处理尝试完成。");
  });

  // 添加未处理的 Promise 拒绝监听器
  globalThis.addEventListener("unhandledrejection", (event) => {
    console.error("❌ 未处理的 Promise 拒绝:", event.reason);
    event.preventDefault(); // 阻止默认行为（可能导致程序崩溃）
  });

  // 添加 SIGINT (Ctrl+C) 信号监听器，用于优雅退出
  try {
    Deno.addSignalListener("SIGINT", () => {
      console.log("\n⏹️ 收到 SIGINT (Ctrl+C)，正在优雅退出...");
      // 在 SIGINT 中执行主要清理
      if (ltmWorker) {
        try {
          ltmWorker.terminate();
        } catch (_) { /* ignore */ }
        console.log("⏹️ (SIGINT) LTM Worker 已终止。");
      }
      if (kv) {
        try {
          kv.close();
        } catch (_) { /* ignore */ }
        console.log("⏹️ (SIGINT) STM & State Storage (Deno KV) 连接已关闭。");
      }
      console.log("⏹️ 清理完成，退出程序。");
      Deno.exit(0); // 正常退出
    });
    console.log("ℹ️ 已添加 SIGINT (Ctrl+C) 信号监听器用于优雅退出。");
  } catch (e) {
    console.warn("⚠️ 无法添加 SIGINT 监听器 (可能权限不足或环境不支持):", e);
  }
}

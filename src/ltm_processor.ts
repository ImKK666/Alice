// src/ltm_processor.ts

import type {
  MemoryPayload,
  EmotionDimension,
  Schemas,
} from "./qdrant_client.ts";
import {
  qdrantClient,
  searchMemories,
  searchMemoriesByEmotion,
} from "./qdrant_client.ts";
import { config } from "./config.ts";
import { embeddings } from "./embeddings.ts";
import type { CandidateMemory, RerankedMemory } from "./reranker.ts";
import { rerankMemories } from "./reranker.ts";
import { memoryNetwork } from "./memory_network.ts";
import { enhanceMemoriesWithTemporalContext } from "./time_perception.ts";
import { kvHolder } from "./main.ts"; // Used by enhanceMemoriesWithTemporalContext
import { getDominantEmotion } from "./cognitive_utils.ts";
import type { ChatMessageInput } from "./memory_processor.ts";

// --- 类型定义 ---
// 记忆上下文条目，增强了时间信息
export interface LtmContextItem {
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
export type LtmStrategy = "LTM_NOW" | "LTM_RECENT"; // LTM_NOW: 精确搜索+Rerank, LTM_RECENT: 获取近期

/** 步骤 1: 决定 LTM 策略 */
export async function decideLtmStrategy(
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
export async function retrieveLtmBasedOnStrategy(
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
      seedMemoryIds = initialMemories.slice(0, 2).map((m) => m.id.toString());

      const candidateMemories: CandidateMemory[] = initialMemories.map(
        (mem) => ({
          id: mem.id.toString(),
          score: mem.score,
          payload: mem.payload as MemoryPayload,
        }),
      );

      if (candidateMemories.length > 0) {
        console.log("   [LTM Retrieve][调试] -> 🔄 执行 LTM 重排序...");
        const rerankedMemoriesData: RerankedMemory[] = await rerankMemories(
          message.text,
          candidateMemories,
        );
        console.log(
          `   [LTM Retrieve][调试] 重排序后得到 ${rerankedMemoriesData.length} 条结果。`,
        );

        if (rerankedMemoriesData.length > 0) {
          console.log(
            "   [LTM Retrieve][调试] -> ✅ 重排序成功，使用重排序的结果。",
          );
          const emotionallyEnhancedMemories = enhanceMemoriesWithEmotion(
            rerankedMemoriesData.map((m) => ({ ...m, score: m.rerank_score })),
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
      initialMemories = scrollResult.points as any;
      seedMemoryIds = initialMemories.slice(0, 2).map((m) => m.id.toString());

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

  if (seedMemoryIds.length > 0) {
    console.log(
      `   [LTM Retrieve][调试] -> 🕸️ 开始记忆网络激活 (种子: ${
        seedMemoryIds.join(", ")
      })...`,
    );
    try {
      const activationResult = await memoryNetwork.activateMemoryNetwork(
        seedMemoryIds[0],
        2,
        0.4,
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
          )
          .map((actMem) => ({
            id: actMem.memoryId,
            payload: actMem.payload,
            activation_score: actMem.activationStrength,
            source: "activated" as "activated",
          }));

        console.log(
          `   [LTM Retrieve][调试] -> 🕸️ 新增 ${activatedLtmItems.length} 条来自记忆网络的记忆。`,
        );
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
      
      const supplementMemories = await searchMemories(
        config.qdrantCollectionName,
        searchVector,
        supplementLimit,
        supplementFilter,
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

  retrievedItems.sort((a, b) => {
    const scoreA = a.rerank_score ?? a.activation_score ?? a.score ?? -Infinity;
    const scoreB = b.rerank_score ?? b.activation_score ?? b.score ?? -Infinity;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return (b.payload.timestamp || 0) - (a.payload.timestamp || 0);
  });

  const uniqueItems = retrievedItems.filter((item, index, self) =>
    index === self.findIndex((t) => t.id === item.id)
  );
  const finalItems = uniqueItems.slice(0, config.ragMaxMemoriesInPrompt);

  const finalItemsWithTemporal = await enhanceMemoriesWithTemporalContext(
    finalItems,
    message.userId,
    contextId, 
    kvHolder.instance, // Pass Deno.Kv instance from main.ts via kvHolder
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
  if (!config.timePerception.enabled || memories.length === 0) return memories;

  const scoredMemories = memories.map((memory) => {
    const emotionalMatch = calculateEmotionalMatch(
      memory.payload,
      messageSentiment,
    );
    const originalScore = memory.score ?? 0;
    // const emotionalWeight = 0.3; // Not used
    // const baseScore = Math.max(0, originalScore); // Not used
    const boostFactor = 1 + (emotionalMatch - 0.5) * 0.4;
    const adjustedScore = originalScore * boostFactor;

    return { ...memory, score: adjustedScore };
  });

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

// src/reranker.ts
/**
 * Reranker 模块 - 提供对检索结果进行重排序的功能
 *
 * 实现功能：
 * 1. 调用配置的 Reranker API (例如 SiliconFlow)
 * 2. 对输入的候选文档列表根据查询进行重排序
 * 3. 处理 API 调用错误
 */

import { config } from "./config.ts";
import type { MemoryPayload } from "./qdrant_client.ts"; // 导入所需类型

// --- Reranker API 相关接口定义 ---
// (从main.ts移动过来)
interface RerankInputDocument {
  text: string;
}

interface RerankResponseItem {
  index: number;
  relevance_score: number;
  document?: RerankInputDocument; // API 可能返回这个，我们主要用 score 和 index
}

interface RerankApiResponse {
  results: RerankResponseItem[];
  // ... 可能还有其他字段，如 usage
}

// 定义rerankMemories函数的输入结构
export interface CandidateMemory {
  id: string;
  score: number; // 原始检索分数
  payload: MemoryPayload;
}

// 定义rerankMemories函数的返回结构
export interface RerankedMemory {
  id: string;
  payload: MemoryPayload;
  rerank_score: number;
}

/**
 * 使用配置的 Rerank API 对候选记忆进行重排序
 * @param query 当前的用户查询/消息文本
 * @param candidateMemories 初始检索到的候选记忆列表 (包含 id, score, payload)
 * @returns 返回根据 rerank_score 降序排列的记忆列表，并附加了 rerank_score。如果API调用失败则返回空数组。
 */
export async function rerankMemories(
  query: string,
  candidateMemories: CandidateMemory[],
): Promise<RerankedMemory[]> {
  if (!candidateMemories || candidateMemories.length === 0) {
    return []; // 没有候选记忆，直接返回空
  }

  // 使用配置的API URL和模型名称
  const apiUrl = `${config.siliconflowBaseUrl}${config.rerankPath}`;
  const modelName = config.rerankerModel;
  // 使用SiliconFlow API密钥
  const apiKey = config.siliconflowApiKey;

  console.log(
    `   -> 🔄 调用 Reranker (模型: ${modelName}) 对 ${candidateMemories.length} 条候选记忆进行重排序... (API: ${apiUrl})`,
  );

  // 准备 Rerank API 的输入
  const documentsToRerank = candidateMemories.map((mem) =>
    mem.payload.text_content // 提取文本内容用于重排序
  );

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`, // 使用SiliconFlow API密钥
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        model: modelName, // 使用配置的模型名称
        query: query,
        documents: documentsToRerank,
        return_documents: false, // 我们不需要返回文档内容
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      // 抛出错误，由调用者或下面的catch块处理
      throw new Error(
        `❌ Rerank API请求失败: ${response.status} ${response.statusText} - ${errorBody}`,
      );
    }

    const rerankResult: RerankApiResponse = await response.json();

    // 将 rerank 分数匹配回原始记忆对象
    // 确保results存在且是数组，然后再进行映射
    if (!rerankResult || !Array.isArray(rerankResult.results)) {
      console.error("   -> ❌ Rerank API 返回了无效的结果格式:", rerankResult);
      return []; // 格式无效时返回空数组
    }

    const rerankedMemories = rerankResult.results.map(
      (item): RerankedMemory => {
        // 基本验证item结构
        if (
          item.index === undefined || item.relevance_score === undefined ||
          !candidateMemories[item.index]
        ) {
          console.warn(
            `   -> ⚠️ Rerank API 返回了无效的 item 结构或索引:`,
            item,
          );
          // 返回一个占位符或后续过滤。这里我们创建一个可能有问题的条目。
          // 更健壮的方法是将这些过滤掉。
          return {
            id: "invalid",
            payload: {} as MemoryPayload,
            rerank_score: -1,
          };
        }
        const originalMemory = candidateMemories[item.index]; // 通过 index 找到原始记忆
        return {
          id: originalMemory.id,
          payload: originalMemory.payload,
          rerank_score: item.relevance_score,
        };
      },
    ).filter((mem) => mem.id !== "invalid"); // 过滤无效条目

    // 按 rerank_score 降序排序
    rerankedMemories.sort((a, b) => b.rerank_score - a.rerank_score);

    console.log(
      `   -> ✅ Reranker 完成。Top 结果分数: ${
        rerankedMemories.length > 0
          ? rerankedMemories[0].rerank_score.toFixed(4)
          : "N/A"
      }`,
    );
    return rerankedMemories;
  } catch (error) {
    console.error("   -> ❌ 调用 Rerank API 时出错:", error);
    // 返回空列表表示下游出现故障，在main.ts中处理回退
    return [];
  }
}

/**
 * 输出初始化信息
 */
console.log(
  `🔄 重排序模块初始化完成。使用模型: ${config.rerankerModel}，接口: ${config.siliconflowBaseUrl}${config.rerankPath}`,
);

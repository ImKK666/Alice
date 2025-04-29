// src/mind_wandering.ts

/**
 * 思维漫游模块 - 让爱丽丝在对话间隙产生自发联想与灵感
 *
 * 实现了人类大脑"默认网络"模式的数字模拟，使AI能够：
 * 1. 在对话间隙进行自由联想
 * 2. 发现记忆之间隐藏的联系
 * 3. 生成创造性的洞见和隐喻
 * 4. 发展独特的思维方式和观点
 */

import { llm } from "./llm.ts";
import { embeddings } from "./embeddings.ts";
import {
  type MemoryPayload,
  type MemoryPointStruct,
  qdrantClient, // 确保 qdrantClient 已导出或在此处导入
  type Schemas,
  searchMemories,
  upsertMemoryPoints,
} from "./qdrant_client.ts";
import { config } from "./config.ts";

/**
 * 思维联想的类型
 */
export type InsightType =
  | "connection" // 连接两个看似不相关的概念
  | "pattern" // 识别模式或趋势
  | "metaphor" // 生成隐喻或类比
  | "question" // 提出深度思考问题
  | "reflection" // 对过往交互的反思
  | "hypothesis" // 形成假设或理论
  | "perspective"; // 形成独特观点或视角;

/**
 * 思维漫游产生的洞见结构
 */
export interface Insight {
  id: string; // 唯一ID
  insight_type: InsightType; // 洞见类型
  content: string; // 洞见内容
  context_ids: string[]; // 相关的上下文ID
  source_memories: string[]; // 启发此洞见的记忆ID
  confidence: number; // 信心度 (0.0-1.0)
  timestamp: number; // 创建时间
  last_used?: number; // 上次在对话中使用的时间
  use_count?: number; // 使用次数
}

/**
 * 思维漫游会话上下文
 */
export interface WanderingContext {
  user_id: string; // 用户ID
  context_id: string; // 对话上下文ID
  recent_topics: string[]; // 最近讨论的主题
  emotional_state: { // 当前情感状态
    valence: number; // 效价
    arousal: number; // 唤醒度
  };
  last_wandering_time?: number; // 上次思维漫游的时间
}

/**
 * 思维漫游的结果集合
 */
export interface InsightCollection {
  insights: Insight[]; // 生成的洞见列表
  wandering_focus?: string; // 本次漫游的焦点
  wandering_duration?: number; // 漫游持续时间(ms)
}

// 阈值：两次思维漫游之间的最小时间间隔(ms)
const MIN_WANDERING_INTERVAL = 5 * 60 * 1000; // 5分钟

// 思维漫游的最大记忆检索数量
const MAX_MEMORIES_FOR_WANDERING = 15;

/**
 * 触发思维漫游，在后台异步进行
 *
 * @param context 思维漫游的上下文
 * @returns 异步的Promise，完成后返回洞见集合
 */
export async function triggerMindWandering(
  context: WanderingContext,
): Promise<InsightCollection> {
  console.log(
    `✨ [MindWander] 开始思维漫游过程 (用户: ${context.user_id}, 上下文: ${context.context_id})...`,
  );

  // 检查是否距离上次漫游时间过短
  if (
    context.last_wandering_time &&
    Date.now() - context.last_wandering_time < MIN_WANDERING_INTERVAL
  ) {
    console.log(`🌙 [MindWander] 距上次漫游时间过短，跳过本次思维漫游。`);
    return { insights: [] };
  }

  const startTime = Date.now();

  try {
    // 1. 获取当前上下文的相关记忆
    const relevantMemories = await retrieveMemoriesForWandering(context);

    if (relevantMemories.length === 0) {
      console.log(`📭 [MindWander] 没有找到足够的记忆用于思维漫游。`);
      return { insights: [] };
    }

    console.log(
      `🧠 [MindWander] 检索到 ${relevantMemories.length} 条记忆用于思维漫游。`,
    );

    // 2. 生成思维漫游焦点 (这是漫游的种子)
    const wanderingFocus = await generateWanderingFocus(
      context,
      relevantMemories,
    );
    console.log(`🔍 [MindWander] 生成思维漫游焦点: "${wanderingFocus}"`);

    // 3. 从焦点出发，生成多种类型的洞见
    const insights = await generateInsightsFromFocus(
      wanderingFocus,
      context,
      relevantMemories,
    );

    const duration = Date.now() - startTime;
    console.log(
      `✅ [MindWander] 思维漫游完成，生成了 ${insights.length} 条洞见 (用时: ${duration}ms)`,
    );

    // 4. 存储生成的洞见到向量数据库
    await storeInsights(insights, context);

    // 返回结果
    return {
      insights,
      wandering_focus: wanderingFocus,
      wandering_duration: duration,
    };
  } catch (error) {
    console.error(`❌ [MindWander] 思维漫游过程中出错:`, error);
    return { insights: [] };
  }
}

/**
 * 检索用于思维漫游的相关记忆
 *
 * @param context 漫游上下文
 * @returns 相关记忆数组
 */
async function retrieveMemoriesForWandering(
  context: WanderingContext,
): Promise<Array<Schemas["ScoredPoint"] & { payload: MemoryPayload }>> {
  // 构建查询向量 - 基于最近话题和上下文
  const queryText = [
    context.context_id,
    ...context.recent_topics,
  ].join(" ");

  try {
    // 生成查询向量
    const vector = await embeddings.embedQuery(queryText);

    // 构建过滤器 - 获取当前用户和上下文的记忆
    // 但不限制太严格，允许一定的关联发散
    const filter: Schemas["Filter"] = {
      should: [
        { key: "source_user", match: { value: context.user_id } },
        { key: "source_context", match: { value: context.context_id } },
        // 可以加入相关主题的过滤条件
        // { key: "associative_triggers", match: { any: context.recent_topics } }
      ],
      must_not: [ // 排除AI自己的反思，避免循环
        { key: "memory_type", match: { value: "reflection" } },
      ],
    };

    // 执行向量搜索
    const memories = await searchMemories(
      config.qdrantCollectionName,
      vector,
      MAX_MEMORIES_FOR_WANDERING,
      filter,
    );

    return memories;
  } catch (error) {
    console.error(`❌ [MindWander] 检索思维漫游记忆时出错:`, error);
    return [];
  }
}

/**
 * 根据上下文和记忆生成思维漫游的焦点
 *
 * @param context 漫游上下文
 * @param memories 相关记忆
 * @returns 思维漫游焦点
 */
async function generateWanderingFocus(
  context: WanderingContext,
  memories: Array<Schemas["ScoredPoint"] & { payload: MemoryPayload }>,
): Promise<string> {
  // 提取记忆内容用于焦点生成
  const memoryExcerpts = memories
    .slice(0, 5) // 取最相关的5条
    .map((mem) =>
      `[${mem.payload.memory_type} from ${mem.payload.source_user}]: ${mem.payload.text_content}`
    )
    .join("\n- ");

  // 构建焦点生成提示
  const focusPrompt = `
你是一位富有创造力的思想者，正在进行"思维漫游"——一种介于冥想和自由联想之间的思维活动。
基于以下背景信息和记忆片段，生成一个深刻、有趣的思维漫游焦点。这个焦点应该是一个引人深思的概念、问题或观察，能够触发进一步的联想和洞见。

背景信息:
- 对话上下文ID: ${context.context_id}
- 最近讨论的话题: ${context.recent_topics.join(", ") || "无"}
- 当前情感状态: 效价=${context.emotional_state.valence.toFixed(2)}, 唤醒度=${
    context.emotional_state.arousal.toFixed(2)
  }

相关记忆片段:
- ${memoryExcerpts || "暂无相关记忆片段"}

你的任务是创建一个思维漫游焦点，它可以是:
1. 记忆中隐含的模式或主题
2. 记忆之间的意外联系
3. 源自记忆但更深层次的问题
4. 关于记忆中概念的新颖隐喻
5. 对记忆内容的反思性观察

请只返回思维漫游焦点本身，不要包含解释或前缀。保持简洁但深刻，通常在一到两句话之间。
焦点应避免过于个人化，更侧重于普遍性或概念性的思考。
`;

  try {
    // 调用LLM生成焦点
    const response = await llm.invoke(focusPrompt);
    const focusContent = typeof response === "string"
      ? response
      : (response.content as string);

    return focusContent.trim() || "记忆与经验如何塑造我们对世界的理解"; // 提供默认焦点
  } catch (error) {
    console.error(`❌ [MindWander] 生成思维漫游焦点时出错:`, error);
    // 返回一个默认焦点
    return "探索不同观点之间的联系";
  }
}

/**
 * 从焦点出发生成多种洞见
 *
 * @param focus 思维漫游焦点
 * @param context 漫游上下文
 * @param memories 相关记忆
 * @returns 生成的洞见数组
 */
async function generateInsightsFromFocus(
  focus: string,
  context: WanderingContext,
  memories: Array<Schemas["ScoredPoint"] & { payload: MemoryPayload }>,
): Promise<Insight[]> {
  // 洞见类型与描述
  const insightTypes: { [key in InsightType]: string } = {
    connection: "连接两个看似不相关的概念或记忆",
    pattern: "识别对话或记忆中的模式或趋势",
    metaphor: "创造一个有关焦点的新颖隐喻或类比",
    question: "提出一个深度思考的哲学性问题",
    reflection: "对过往交互或经验的反思",
    hypothesis: "提出一个关于用户或对话的假设或理论",
    perspective: "从独特角度看待焦点或记忆",
  };

  // 提取记忆ID与内容的映射关系，并包含记忆类型
  const memoryMap = new Map(
    memories.map(
      (mem) => [
        mem.id.toString(),
        `[${mem.payload.memory_type}] ${mem.payload.text_content}`,
      ],
    ),
  );

  // 准备记忆内容用于洞见生成
  const memoryContext = memories
    .slice(0, 7) // 限制数量以避免提示过长
    .map((mem, idx) =>
      `记忆 ${
        idx + 1
      } [ID: ${mem.id} | 类型: ${mem.payload.memory_type}]: ${mem.payload.text_content}`
    )
    .join("\n");

  // 构建生成洞见的提示
  const insightPrompt = `
你是一位富有创造力的思想者，正在从特定焦点出发，进行"思维漫游"，生成各种深刻的洞见。
基于以下思维漫游焦点、背景信息和记忆片段，生成多种类型的洞见。

思维漫游焦点: "${focus}"

背景信息:
- 对话上下文ID: ${context.context_id}
- 最近讨论的话题: ${context.recent_topics.join(", ") || "无"}
- 当前情感状态: 效价=${context.emotional_state.valence.toFixed(2)}, 唤醒度=${
    context.emotional_state.arousal.toFixed(2)
  }

相关记忆片段:
${memoryContext || "暂无相关记忆片段"}

请生成至少4种不同类型的洞见，每种类型至少1个。可选类型及其描述:
${
    Object.entries(insightTypes).map(([type, desc]) => `- ${type}: ${desc}`)
      .join("\n")
  }

对于每个洞见，请使用以下JSON格式:
{
  "insight_type": "洞见类型", // 必须是上面列表中的一个
  "content": "洞见内容 (简洁、深刻)",
  "source_memories": ["相关记忆ID1", "相关记忆ID2"], // 引用相关的记忆ID，留空数组[]如果没有直接相关的记忆
  "confidence": 0.85 // 信心度，从0.0到1.0，表示你对这个洞见的把握程度
}

每个洞见应该是深刻、有洞察力的，避免平淡或一般性的陈述。你的洞见应该展现创造性思维的火花，能够引发进一步的思考。
确保内容与焦点相关，并尽可能利用提供的记忆片段。
请以JSON数组的形式返回所有洞见，确保格式正确无误。
`;

  try {
    // 调用LLM生成洞见
    const response = await llm.invoke(insightPrompt);
    const insightContent = typeof response === "string"
      ? response
      : (response.content as string);

    // 清理和解析JSON响应
    const cleanedContent = insightContent.trim().replace(/```json|```/g, "");
    let parsedInsights: Array<{
      insight_type: string; // 先接收字符串类型
      content: string;
      source_memories: string[];
      confidence: number;
    }>;

    try {
      parsedInsights = JSON.parse(cleanedContent);
      // 确保是数组
      if (!Array.isArray(parsedInsights)) {
        // 尝试修复常见的LLM错误：返回单个对象而不是数组
        if (
          typeof parsedInsights === "object" && parsedInsights !== null &&
          parsedInsights.insight_type
        ) {
          parsedInsights = [parsedInsights];
        } else {
          throw new Error("解析结果不是有效的数组");
        }
      }
    } catch (parseError) {
      console.error(`❌ [MindWander] 解析洞见JSON时出错:`, parseError);
      console.log(`   原始响应 (清理后): ${cleanedContent}`);
      return []; // 解析失败返回空数组
    }

    // 构建完整的洞见对象，并验证类型
    const validInsightTypes = Object.keys(insightTypes) as InsightType[];
    const fullInsights: Insight[] = parsedInsights
      .filter((insight) =>
        insight.insight_type && insight.content &&
        insight.confidence !== undefined
      ) // 过滤掉无效结构
      .map((insight) => {
        // 验证 insight_type 是否有效
        const validatedType =
          validInsightTypes.includes(insight.insight_type as InsightType)
            ? insight.insight_type as InsightType
            : "reflection"; // 如果类型无效，默认为 reflection

        return {
          id: crypto.randomUUID(), // 生成唯一ID
          insight_type: validatedType,
          content: insight.content,
          context_ids: [context.context_id],
          source_memories: insight.source_memories || [],
          confidence: Math.max(0, Math.min(1, insight.confidence || 0.7)), // 确保信心度在0-1之间
          timestamp: Date.now(),
          use_count: 0,
        };
      })
      .filter((insight) => insight.content.length > 5); // 过滤掉内容过短的洞见

    return fullInsights;
  } catch (error) {
    console.error(`❌ [MindWander] 生成洞见时出错:`, error);
    return [];
  }
}

/**
 * 将生成的洞见存储到向量数据库
 *
 * @param insights 洞见数组
 * @param context 漫游上下文
 */
async function storeInsights(
  insights: Insight[],
  context: WanderingContext,
): Promise<void> {
  if (insights.length === 0) return;

  try {
    // 对每个洞见生成向量
    const insightPoints: MemoryPointStruct[] = await Promise.all(
      insights.map(async (insight) => {
        // 生成洞见的向量表示
        const vector = await embeddings.embedQuery(insight.content);

        // 构建存储结构
        const payload: MemoryPayload = {
          memory_type: "reflection", // 使用reflection作为记忆类型
          timestamp: insight.timestamp,
          source_user: "AI", // 这是AI自己生成的
          source_context: context.context_id, // 关联到触发漫游的上下文
          text_content: insight.content,
          importance_score: Math.round(insight.confidence * 4) + 1, // 将信心度转换为1-5的重要性
          // 附加情感状态
          emotional_valence: context.emotional_state.valence,
          emotional_arousal: context.emotional_state.arousal,
          // 思维漫游特有元数据
          insight_metadata: {
            insight_type: insight.insight_type,
            source_memories: insight.source_memories,
            wandering_context: {
              user_id: context.user_id,
              recent_topics: context.recent_topics,
            },
            use_count: 0, // 初始化使用次数
            last_used: 0, // 初始化上次使用时间
          },
          // 关联触发词可以设置为焦点或最近话题
          associative_triggers: [focus || "", ...context.recent_topics].slice(
            0,
            5,
          ),
        };

        return {
          id: insight.id,
          vector,
          payload,
        };
      }),
    );

    // 存储到Qdrant
    await upsertMemoryPoints(config.qdrantCollectionName, insightPoints);
    console.log(
      `✅ [MindWander] 成功存储 ${insights.length} 条思维漫游洞见到向量数据库。`,
    );
  } catch (error) {
    console.error(`❌ [MindWander] 存储洞见时出错:`, error);
  }
}

/**
 * 检索适合当前对话的洞见
 *
 * @param message 当前消息
 * @param limit 返回的最大洞见数量
 * @returns 相关洞见数组
 */
export async function retrieveRelevantInsights(
  message: { text: string; contextId: string; userId: string }, // 添加userId用于可能的用户特定洞见过滤
  limit: number = 2,
): Promise<Insight[]> {
  try {
    // 生成查询向量
    const vector = await embeddings.embedQuery(message.text);

    // 构建过滤器 - 只获取reflection类型的记忆
    // 可以增加过滤条件，比如只获取与当前用户或上下文相关的洞见
    const filter: Schemas["Filter"] = {
      must: [
        { key: "memory_type", match: { value: "reflection" } },
      ],
      // 增加 should 条件，优先匹配当前上下文或用户的洞见
      // should: [
      //   { key: "source_context", match: { value: message.contextId } },
      //   { key: "insight_metadata.wandering_context.user_id", match: { value: message.userId } }
      // ],
      // minimum_should: 1 // 至少满足一个 should 条件 (如果启用了should)
    };

    // 执行向量搜索
    const searchResults = await searchMemories(
      config.qdrantCollectionName,
      vector,
      limit * 2, // 多检索一些，以便后续过滤和排序
      filter,
    );

    if (searchResults.length === 0) {
      return [];
    }

    // 过滤和排序：优先选择信心度高、使用次数少、最近未使用的洞见
    const insights: Insight[] = searchResults
      .map((result) => {
        const payload = result.payload;
        const metadata = payload.insight_metadata || {};
        return {
          id: result.id.toString(),
          insight_type: (metadata.insight_type || "reflection") as InsightType,
          content: payload.text_content,
          context_ids: [payload.source_context],
          source_memories: metadata.source_memories || [],
          confidence: result.score ||
            (payload.importance_score
              ? (payload.importance_score - 1) / 4
              : 0.7), // 使用相关性分数或重要性
          timestamp: payload.timestamp,
          use_count: metadata.use_count || 0,
          last_used: metadata.last_used || 0,
        };
      })
      .sort((a, b) => {
        // 1. 优先未使用过或很久未使用的
        const usageDiff = (a.last_used || 0) - (b.last_used || 0);
        if (Math.abs(usageDiff) > 1000 * 60 * 60) { // 超过1小时未使用优先
          return usageDiff; // last_used 小的优先
        }
        // 2. 优先使用次数少的
        const useCountDiff = (a.use_count || 0) - (b.use_count || 0);
        if (useCountDiff !== 0) {
          return useCountDiff; // use_count 小的优先
        }
        // 3. 优先信心度/相关性高的
        return (b.confidence || 0) - (a.confidence || 0);
      });

    // 返回最终限制数量的洞见
    return insights.slice(0, limit);
  } catch (error) {
    console.error(`❌ [MindWander] 检索相关洞见时出错:`, error);
    return [];
  }
}

/**
 * 定期进行思维漫游的后台任务
 *
 * @param userContextMap 用户-上下文映射
 */
export async function schedulePeriodicMindWandering(
  userContextMap: Map<string, string[]>, // Map<userId, contextId[]>
): Promise<void> {
  // 注意：在 Deno Deploy 或类似环境中，长时间运行的 setInterval 可能不可靠或受限。
  // 可能需要外部调度器（如 Cron Job）来触发此任务。
  console.log(
    `🌊 [MindWander] 启动定期思维漫游任务... (注意: 长时间运行可能受环境限制)`,
  );

  // 记录上次漫游时间的映射 Map<"userId:contextId", timestamp>
  const lastWanderingTimes = new Map<string, number>();

  // 定义执行漫游的函数
  const performWandering = async () => {
    console.log(`🌀 [MindWander] 执行定期思维漫游检查...`);
    // 获取所有活跃的用户-上下文对
    for (const [userId, contextIds] of userContextMap.entries()) {
      for (const contextId of contextIds) {
        const key = `${userId}:${contextId}`;
        const lastTime = lastWanderingTimes.get(key) || 0;

        // 检查是否应该进行漫游
        if (Date.now() - lastTime >= MIN_WANDERING_INTERVAL) {
          try {
            // --- 获取必要信息 ---
            // TODO: 实现获取最近话题和情感状态的逻辑
            // 这可能需要从 Deno KV 或其他地方读取 STM 或最近的情感分析结果
            const recentTopics: string[] = []; // 示例：需要实际实现
            const emotionalState = { valence: 0, arousal: 0 }; // 示例：需要实际实现

            // 构建漫游上下文
            const wanderingContext: WanderingContext = {
              user_id: userId,
              context_id: contextId,
              recent_topics: recentTopics,
              emotional_state: emotionalState,
              last_wandering_time: lastTime,
            };

            // 异步执行思维漫游
            console.log(
              `   -> 为用户 ${userId} 上下文 ${contextId} 触发思维漫游...`,
            );
            triggerMindWandering(wanderingContext)
              .then((result) => {
                if (result.insights.length > 0) {
                  console.log(
                    `   ✨ [MindWander] 用户 ${userId} 上下文 ${contextId} 漫游成功生成 ${result.insights.length} 条洞见。`,
                  );
                }
                // 更新上次漫游时间
                lastWanderingTimes.set(key, Date.now());
              })
              .catch((err) => {
                console.error(
                  `   ❌ [MindWander] 用户 ${userId} 上下文 ${contextId} 思维漫游出错:`,
                  err,
                );
                // 即使出错也更新时间，避免短时间内反复失败
                lastWanderingTimes.set(key, Date.now());
              });
            // 短暂延迟避免请求过于密集
            await new Promise((resolve) => setTimeout(resolve, 500));
          } catch (error) {
            console.error(
              `   ❌ [MindWander] 触发用户 ${userId} 上下文 ${contextId} 定期思维漫游时出错:`,
              error,
            );
            // 即使出错也更新时间
            lastWanderingTimes.set(key, Date.now());
          }
        }
      }
    }
    console.log(`🌀 [MindWander] 定期思维漫游检查完成。`);
  };

  // 首次执行
  await performWandering();

  // 定期执行
  setInterval(performWandering, 15 * 60 * 1000); // 每15分钟检查一次

  console.log(`🌊 [MindWander] 定期思维漫游任务已启动，每15分钟检查一次。`);
}

// 导出辅助函数及类型
export { Insight, InsightCollection, InsightType, WanderingContext };

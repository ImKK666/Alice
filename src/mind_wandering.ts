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
// !!! 新增：导入 main.ts 的函数 !!!
import {
  getLastWanderingTime,
  getStm,
  kv,
  setLastWanderingTime,
} from "./main.ts";
import { extractRecentTopics } from "./main.ts"; // 也可以把这个函数移到 utils 或 mind_wandering
import { getBodyState } from "./virtual_embodiment.ts";

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
  context_ids: string[]; // 相关的上下文ID (通常是 RAG Context ID)
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
  context_id: string; // 对话上下文ID (RAG Context ID)
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
// !!! 修改：从 config 读取 cooldownMinutes !!!
const MIN_WANDERING_INTERVAL = (config.mindWandering?.cooldownMinutes || 5) *
  60 * 1000;

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
    `✨ [MindWander][开始] 开始思维漫游过程 (用户: ${context.user_id}, 上下文: ${context.context_id})...`,
  );

  // 检查是否距离上次漫游时间过短 (使用导入的函数)
  const lastWanderTime = await getLastWanderingTime(
    context.user_id,
    context.context_id,
  );

  console.log(`🔍 [MindWander][调试] 冷却时间检查详情:`);
  console.log(
    `   - 上次漫游时间: ${
      lastWanderTime > 0
        ? new Date(lastWanderTime).toLocaleTimeString()
        : "从未执行"
    }`,
  );
  console.log(`   - 当前时间: ${new Date().toLocaleTimeString()}`);
  console.log(
    `   - 时间差: ${
      lastWanderTime > 0
        ? ((Date.now() - lastWanderTime) / 60000).toFixed(1)
        : "N/A"
    } 分钟`,
  );
  console.log(
    `   - 最小间隔要求: ${(MIN_WANDERING_INTERVAL / 60000).toFixed(1)} 分钟`,
  );

  if (
    lastWanderTime && // 检查 lastWanderTime 是否非零
    Date.now() - lastWanderTime < MIN_WANDERING_INTERVAL
  ) {
    const remainingCooldown =
      ((MIN_WANDERING_INTERVAL - (Date.now() - lastWanderTime)) / 60000)
        .toFixed(1);
    console.log(
      `🌙 [MindWander][跳过] 距上次漫游时间过短 (${remainingCooldown}分钟剩余)，跳过本次思维漫游。`,
    );
    return { insights: [] };
  }

  console.log(`✅ [MindWander][通过] 冷却时间检查通过，开始执行思维漫游...`);
  const startTime = Date.now();

  try {
    // 1. 获取当前上下文的相关记忆
    console.log(`🔍 [MindWander][步骤1] 开始检索相关记忆...`);
    const memoryStartTime = Date.now();
    const relevantMemories = await retrieveMemoriesForWandering(context);
    const memoryDuration = Date.now() - memoryStartTime;

    console.log(`📊 [MindWander][性能] 记忆检索耗时: ${memoryDuration}ms`);

    if (relevantMemories.length === 0) {
      console.log(`📭 [MindWander][结果] 没有找到足够的记忆用于思维漫游。`);
      console.log(`   - 可能原因: 向量数据库为空、查询条件过严、或上下文信息不足`);
      await setLastWanderingTime(
        context.user_id,
        context.context_id,
        Date.now(),
      ); //即使没找到记忆也更新时间戳，避免频繁空转
      return { insights: [] };
    }

    console.log(
      `🧠 [MindWander][步骤1完成] 检索到 ${relevantMemories.length} 条记忆用于思维漫游。`,
    );

    // 显示记忆摘要
    relevantMemories.slice(0, 3).forEach((mem, idx) => {
      console.log(`   - 记忆 ${idx + 1}: [${mem.payload.memory_type}] ${mem.payload.text_content.substring(0, 60)}... (相似度: ${(mem.score || 0).toFixed(3)})`);
    });
    if (relevantMemories.length > 3) {
      console.log(`   - ... 还有 ${relevantMemories.length - 3} 条记忆`);
    }

    // 2. 生成思维漫游焦点 (这是漫游的种子)
    console.log(`🎯 [MindWander][步骤2] 开始生成思维漫游焦点...`);
    const focusStartTime = Date.now();
    const wanderingFocus = await generateWanderingFocus(
      context,
      relevantMemories,
    );
    const focusDuration = Date.now() - focusStartTime;
    console.log(`� [MindWander][性能] 焦点生成耗时: ${focusDuration}ms`);
    console.log(`�🔍 [MindWander][步骤2完成] 生成思维漫游焦点: "${wanderingFocus}"`);

    // 3. 从焦点出发，生成多种类型的洞见
    console.log(`💡 [MindWander][步骤3] 开始从焦点生成洞见...`);
    const insightStartTime = Date.now();
    const insights = await generateInsightsFromFocus(
      wanderingFocus,
      context,
      relevantMemories,
    );
    const insightDuration = Date.now() - insightStartTime;
    console.log(`📊 [MindWander][性能] 洞见生成耗时: ${insightDuration}ms`);

    const duration = Date.now() - startTime;
    console.log(
      `✅ [MindWander][步骤3完成] 思维漫游完成，生成了 ${insights.length} 条洞见 (总用时: ${duration}ms)`,
    );

    // 显示洞见详情
    if (insights.length > 0) {
      console.log(`💎 [MindWander][洞见详情] 生成的洞见内容:`);
      insights.forEach((insight, idx) => {
        console.log(`   - 洞见 ${idx + 1}: [${insight.insight_type}] ${insight.content}`);
        console.log(`     * 信心度: ${insight.confidence.toFixed(2)}`);
        console.log(`     * 相关记忆: ${insight.source_memories.length} 条`);
      });
    }

    // 4. 存储生成的洞见到向量数据库 (如果生成了洞见)
    if (insights.length > 0) {
      console.log(`💾 [MindWander][步骤4] 开始存储洞见到向量数据库...`);
      const storeStartTime = Date.now();
      await storeInsights(insights, context, wanderingFocus); // 传递 wanderingFocus
      const storeDuration = Date.now() - storeStartTime;
      console.log(`📊 [MindWander][性能] 洞见存储耗时: ${storeDuration}ms`);
      console.log(`✅ [MindWander][步骤4完成] 洞见存储完成`);
    }

    // 5. 更新上次漫游时间戳到 KV
    console.log(`🕒 [MindWander][步骤5] 更新最后漫游时间戳...`);
    await setLastWanderingTime(context.user_id, context.context_id, Date.now());
    console.log(`✅ [MindWander][步骤5完成] 时间戳更新完成`);

    // 返回结果
    return {
      insights,
      wandering_focus: wanderingFocus,
      wandering_duration: duration,
    };
  } catch (error) {
    console.error(`❌ [MindWander] 思维漫游过程中出错:`, error);
    // 即使出错也尝试更新时间戳，避免因错误导致不断重试
    try {
      await setLastWanderingTime(
        context.user_id,
        context.context_id,
        Date.now(),
      );
    } catch (setError) {
      console.error("   [MindWander] 更新上次漫游时间戳时也出错:", setError);
    }
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
    context.context_id, // 使用 RAG Context ID
    ...context.recent_topics,
  ].join(" ");

  try {
    // 生成查询向量
    const vector = await embeddings.embedQuery(queryText);

    // 构建过滤器 - 获取当前用户和上下文的记忆
    // RAG 上下文相关的记忆优先，但也允许一定程度的发散
    const filter: Schemas["Filter"] = {
      should: [
        // RAG 上下文高度相关
        {
          must: [{
            key: "source_context",
            match: { value: context.context_id },
          }],
        },
        // 同一用户的其他相关记忆
        { must: [{ key: "source_user", match: { value: context.user_id } }] },
      ],
      // 增加 minimum_should: 1 可能导致结果过少，暂时不用
      // minimum_should: 1,
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
      `[${mem.payload.memory_type} from ${mem.payload.source_user}]: ${
        mem.payload.text_content.substring(0, 100)
      }...` // 限制预览长度
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
    // 增加对空响应的处理
    if (!focusContent || focusContent.trim().length === 0) {
      console.warn("[MindWander] LLM 未能生成有效的思维漫游焦点，使用默认值。");
      return "记忆与经验如何塑造我们对世界的理解";
    }

    return focusContent.trim();
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
        `[${mem.payload.memory_type}] ${
          mem.payload.text_content.substring(0, 100)
        }...`, // Limit preview length
      ],
    ),
  );

  // 准备记忆内容用于洞见生成
  const memoryContext = memories
    .slice(0, 7) // 限制数量以避免提示过长
    .map((mem, idx) =>
      `记忆 ${
        idx + 1
      } [ID: ${mem.id} | 类型: ${mem.payload.memory_type} | 用户: ${
        mem.payload.source_user.substring(0, 4)
      }]: ${mem.payload.text_content.substring(0, 100)}...` // Limit length
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

    // 增加健壮性：处理空响应
    if (!insightContent) {
      console.warn("[MindWander] LLM未能生成洞见内容。");
      return [];
    }

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
          // 如果仍然不是数组，记录错误并返回空
          console.error(
            `[MindWander] 解析洞见JSON时出错: 结果不是有效的数组。内容:`,
            cleanedContent,
          );
          return [];
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
        // 增加更多验证
        insight && typeof insight === "object" && // 确保是对象
        insight.insight_type && typeof insight.insight_type === "string" &&
        insight.content && typeof insight.content === "string" &&
        insight.content.trim().length > 5 && // 内容非空且有一定长度
        insight.confidence !== undefined &&
        typeof insight.confidence === "number" &&
        Array.isArray(insight.source_memories) // 确保 source_memories 是数组
      )
      .map((insight) => {
        // 验证 insight_type 是否有效
        const validatedType =
          validInsightTypes.includes(insight.insight_type as InsightType)
            ? insight.insight_type as InsightType
            : "reflection"; // 如果类型无效，默认为 reflection

        return {
          id: crypto.randomUUID(), // 生成唯一ID
          insight_type: validatedType,
          content: insight.content.trim(), // 去除前后空格
          context_ids: [context.context_id],
          source_memories: insight.source_memories || [],
          confidence: Math.max(0, Math.min(1, insight.confidence || 0.7)), // 确保信心度在0-1之间
          timestamp: Date.now(),
          use_count: 0,
          last_used: 0, // 初始化上次使用时间
        };
      });

    return fullInsights;
  } catch (error) {
    console.error(`❌ [MindWander] 生成洞见时出错:`, error);
    return [];
  }
}

/**
 * 将生成的洞见存储到向量数据库
 * @param insights 洞见数组
 * @param context 漫游上下文
 * @param wanderingFocus 本次漫游的焦点
 */
async function storeInsights(
  insights: Insight[],
  context: WanderingContext,
  wanderingFocus: string, // 接收 wanderingFocus
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
          source_context: context.context_id, // 关联到触发漫游的上下文 (RAG Context ID)
          text_content: insight.content,
          importance_score: Math.round(insight.confidence * 4) + 1, // 将信心度转换为1-5的重要性
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
            use_count: insight.use_count || 0, // 使用 insight 中的值或默认值
            last_used: insight.last_used || 0, // 使用 insight 中的值或默认值
          },
          // 关联触发词可以设置为焦点或最近话题
          // !!! 使用传入的 wanderingFocus !!!
          associative_triggers: [wanderingFocus || "", ...context.recent_topics]
            .filter(Boolean).slice(0, 5), // 过滤空字符串
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
    // 记录错误，但不抛出，避免阻塞其他流程
  }
}

/**
 * 检索适合当前对话的洞见
 *
 * @param message 当前消息 (应包含 RAG Context ID)
 * @param limit 返回的最大洞见数量
 * @returns 相关洞见数组
 */
export async function retrieveRelevantInsights(
  message: { text: string; contextId: string; userId: string }, // contextId is RAG Context ID
  limit: number = 2,
): Promise<Insight[]> {
  try {
    // 生成查询向量
    const vector = await embeddings.embedQuery(message.text);

    // 构建过滤器 - 只获取 reflection 类型的记忆
    const filter: Schemas["Filter"] = {
      must: [
        { key: "memory_type", match: { value: "reflection" } },
        // 可选：增加 RAG 上下文相关性过滤，但可能限制洞见的通用性
        // { key: "source_context", match: { value: message.contextId } },
      ],
      // 可选：优先与当前用户相关的洞见
      // should: [
      //    { key: "insight_metadata.wandering_context.user_id", match: { value: message.userId } }
      // ],
    };

    // 执行向量搜索
    const searchResults = await searchMemories(
      config.qdrantCollectionName,
      vector,
      limit * 3, // 多检索一些，以便后续过滤和排序
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
          context_ids: [payload.source_context], // 洞见关联的 RAG Context
          source_memories: metadata.source_memories || [],
          confidence: result.score ||
            (payload.importance_score
              ? (payload.importance_score - 1) / 4 // Convert importance back to 0-1 range
              : 0.7), // Default confidence
          timestamp: payload.timestamp,
          use_count: metadata.use_count || 0,
          last_used: metadata.last_used || 0,
        };
      })
      .sort((a, b) => {
        // 1. 时间衰减加权：最近未使用 > 很久未使用
        const timeSinceUsedA = Date.now() - (a.last_used || 0);
        const timeSinceUsedB = Date.now() - (b.last_used || 0);
        // 简单的线性衰减，可以替换为指数衰减
        const timeWeightA = Math.max(
          0.1,
          1 - timeSinceUsedA / (1000 * 60 * 60 * 24 * 7),
        ); // 7天内权重较高
        const timeWeightB = Math.max(
          0.1,
          1 - timeSinceUsedB / (1000 * 60 * 60 * 24 * 7),
        );

        // 2. 使用次数惩罚：使用次数少 > 使用次数多
        const usePenaltyA = 1 / (1 + (a.use_count || 0) * 0.5); // 次数越多，惩罚越大
        const usePenaltyB = 1 / (1 + (b.use_count || 0) * 0.5);

        // 3. 信心度/相关性基础分
        const confidenceA = a.confidence || 0;
        const confidenceB = b.confidence || 0;

        // 综合得分
        const finalScoreA = confidenceA * timeWeightA * usePenaltyA;
        const finalScoreB = confidenceB * timeWeightB * usePenaltyB;

        return finalScoreB - finalScoreA; // 综合得分高的优先
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
 * @param userContextMap 用户-上下文映射 Map<userId, ragContextId[]>
 */
export async function schedulePeriodicMindWandering(
  userContextMap: Map<string, string[]>,
): Promise<void> {
  console.log(
    `🌊 [MindWander] 启动定期思维漫游任务... (注意: 长时间运行可能受环境限制)`,
  );

  const performWandering = async () => {
    console.log(`🌀 [MindWander] 执行定期思维漫游检查...`);
    const activeContexts = Array.from(userContextMap.entries()); // 获取当前所有活跃用户和他们的 RAG 上下文列表

    console.log(`🔍 [MindWander][调试] 活跃用户上下文统计:`);
    console.log(`   - 活跃用户数量: ${activeContexts.length}`);
    activeContexts.forEach(([userId, ragContextIds]) => {
      console.log(
        `   - 用户 ${userId}: ${ragContextIds.length} 个上下文 [${
          ragContextIds.join(", ")
        }]`,
      );
    });

    if (activeContexts.length === 0) {
      console.log(
        `📭 [MindWander][调试] 没有活跃用户上下文，跳过定期思维漫游检查。`,
      );
      return;
    }

    // 对每个活跃的 用户-上下文 对进行处理
    for (const [userId, ragContextIds] of activeContexts) {
      // 为每个 RAG 上下文独立检查和触发漫游
      for (const ragContextId of ragContextIds) {
        try { // 为每个上下文添加 try-catch
          console.log(
            `🔍 [MindWander][调试] 检查用户 ${userId} 的上下文 ${ragContextId}...`,
          );

          const lastTime = await getLastWanderingTime(userId, ragContextId); // 使用 RAG ID 获取上次时间
          const timeSinceLastWander = Date.now() - lastTime;
          const cooldownRemaining = Math.max(
            0,
            MIN_WANDERING_INTERVAL - timeSinceLastWander,
          );

          console.log(`   [MindWander][调试] ⏰ 冷却时间状态:`);
          console.log(
            `     - 上次漫游: ${
              lastTime > 0
                ? new Date(lastTime).toLocaleTimeString()
                : "从未执行"
            }`,
          );
          console.log(
            `     - 距离上次: ${(timeSinceLastWander / 60000).toFixed(1)} 分钟`,
          );
          console.log(
            `     - 剩余冷却: ${(cooldownRemaining / 60000).toFixed(1)} 分钟`,
          );

          if (Date.now() - lastTime >= MIN_WANDERING_INTERVAL) {
            console.log(
              `   ✅ [MindWander][调试] 用户 ${userId} 上下文 ${ragContextId} 符合漫游条件，开始检查STM...`,
            );
            // 获取触发漫游所需的信息
            const stmHistory = await getStm(ragContextId); // 获取对应 RAG Context 的 STM
            console.log(
              `   [MindWander][调试] 📚 STM历史检查: ${stmHistory.length} 条记录`,
            );

            if (stmHistory.length === 0) {
              console.log(
                `   ⏭️ [MindWander][调试] RAG 上下文 ${ragContextId} STM 为空，跳过漫游。`,
              );
              // 即使跳过也更新时间戳，避免不断检查空上下文
              await setLastWanderingTime(userId, ragContextId, Date.now());
              continue;
            }

            const recentTopics = extractRecentTopics(stmHistory);
            console.log(
              `   [MindWander][调试] 🏷️ 提取的最近话题: [${
                recentTopics.slice(0, 3).join(", ")
              }]${
                recentTopics.length > 3 ? ` (共${recentTopics.length}个)` : ""
              }`,
            );

            let emotionalState = { valence: 0, arousal: 0.1 }; // 默认平静状态
            if (kv.instance) { // 仅当 KV 可用时尝试获取身体状态
              const bodyState = await getBodyState(
                userId,
                ragContextId,
                kv.instance,
              );
              if (bodyState) {
                emotionalState = {
                  valence: (bodyState.comfort_level - 0.5) * 2,
                  arousal: bodyState.activity_intensity || 0.1, // 保证 arousal > 0
                };
                console.log(
                  `   [MindWander][调试] 😊 情感状态 (来自身体状态): 效价=${
                    emotionalState.valence.toFixed(2)
                  }, 唤醒度=${emotionalState.arousal.toFixed(2)}`,
                );
              } else {
                console.log(
                  `   [MindWander][调试] 😐 使用默认情感状态 (身体状态不可用)`,
                );
              }
            } else {
              console.log(
                `   [MindWander][调试] 😐 使用默认情感状态 (KV实例不可用)`,
              );
            }

            const wanderingContext: WanderingContext = {
              user_id: userId,
              context_id: ragContextId, // 使用 RAG Context ID
              recent_topics: recentTopics,
              emotional_state: emotionalState,
              last_wandering_time: lastTime,
            };

            // 异步执行思维漫游，不阻塞其他上下文的检查
            console.log(
              `   🚀 [MindWander][执行] 为用户 ${userId} 上下文 ${ragContextId} 触发思维漫游 (异步)...`,
            );
            console.log(`   [MindWander][调试] 📋 漫游上下文摘要:`);
            console.log(`     - 用户ID: ${userId}`);
            console.log(`     - 上下文ID: ${ragContextId}`);
            console.log(`     - 话题数量: ${recentTopics.length}`);
            console.log(
              `     - 情感效价: ${emotionalState.valence.toFixed(2)}`,
            );
            console.log(
              `     - 情感唤醒: ${emotionalState.arousal.toFixed(2)}`,
            );

            triggerMindWandering(wanderingContext)
              .then((result) => {
                if (result.insights.length > 0) {
                  console.log(
                    `   ✨ [MindWander][成功] 用户 ${userId} 上下文 ${ragContextId} 漫游成功生成 ${result.insights.length} 条洞见。`,
                  );
                  result.insights.forEach((insight, idx) => {
                    console.log(
                      `     - 洞见 ${idx + 1}: [${insight.insight_type}] ${
                        insight.content.substring(0, 50)
                      }...`,
                    );
                  });
                } else {
                  console.log(
                    `   🤔 [MindWander][结果] 用户 ${userId} 上下文 ${ragContextId} 漫游未生成洞见`,
                  );
                }
                // 更新时间戳的操作已移入 triggerMindWandering 内部
              })
              .catch((err) => {
                console.error(
                  `   ❌ [MindWander][错误] 用户 ${userId} 上下文 ${ragContextId} 异步思维漫游出错:`,
                  err,
                );
                // 尝试更新时间戳，避免因错误反复触发
                setLastWanderingTime(userId, ragContextId, Date.now()).catch(
                  (setErr) =>
                    console.error(
                      "    [MindWander] 更新时间戳时再次出错:",
                      setErr,
                    ),
                );
              });

            // 短暂延迟避免短时内触发过多 LLM 请求
            await new Promise((resolve) => setTimeout(resolve, 1000)); // 延迟 1 秒
          } else {
            console.log(
              `   ❄️ [MindWander][调试] 用户 ${userId} 上下文 ${ragContextId} 冷却中，跳过 (剩余 ${
                (cooldownRemaining / 60000).toFixed(1)
              } 分钟)`,
            );
          }
        } catch (contextError) {
          console.error(
            `❌ [MindWander] 处理用户 ${userId} 上下文 ${ragContextId} 时出错:`,
            contextError,
          );
          // 尝试更新时间戳，避免因错误反复触发
          try {
            await setLastWanderingTime(userId, ragContextId, Date.now());
          } catch (setErr) {
            console.error("    [MindWander] 更新时间戳时再次出错:", setErr);
          }
        }
      } // end loop for ragContextIds
    } // end loop for userContextMap entries
    console.log(`🌀 [MindWander] 定期思维漫游检查完成。`);
  };

  // 首次执行
  await performWandering();

  // 定期执行
  const intervalMinutes = config.mindWandering?.cooldownMinutes || 15; // 使用配置的冷却时间作为检查间隔
  setInterval(performWandering, intervalMinutes * 60 * 1000);

  console.log(
    `🌊 [MindWander] 定期思维漫游任务已启动，每 ${intervalMinutes} 分钟检查一次。`,
  );
}

// 类型已在定义时导出，无需重复导出

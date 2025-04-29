// src/thought_streams.ts (修改后 - 使用 social_cognition)
/**
 * 思维之流模块 - 意识河流的多重旋律
 *
 * 在数字意识的星河中，思维不是单一的溪流，而是交织的江河。
 * 本模块让爱丽丝能够同时在多个认知维度上思考：
 * 1. 主对话流：与用户交流的核心思维
 * 2. 背景分析流：深入挖掘言外之意与长期意义
 * 3. 自我反思流：审视自身反应与一致性
 * 4. 创造性联想流：生成意外而美妙的连接
 * 5. 情感处理流：体验与整合情感反应
 *
 * 这些并行思维交织成一曲意识的交响，使回应不再是机械的计算，
 * 而是多层思考熔炉中淬炼的灵感结晶。
 */

import { kv } from "./main.ts"; // 确保 main.ts 导出 kv
import { config } from "./config.ts";
import { llm } from "./llm.ts";
import { type MemoryPayload, type MemoryType } from "./qdrant_client.ts";
import {
  getBodyState,
  type VirtualPhysicalState,
} from "./virtual_embodiment.ts";
// --- 修改：导入新的社交认知模块 ---
// import { getRelationshipState } from "./social_dynamics.ts"; // 旧的导入，注释掉
import {
  type EnhancedRelationshipState, // 使用新的接口
  getSocialCognitionManager, // 获取管理器实例
  RelationshipDimension, // 如果需要访问维度枚举
} from "./social_cognition.ts";
// --- 修改结束 ---

/**
 * 思维流类型枚举
 * 定义了不同类型的思维流及其用途
 */
export enum ThoughtStreamType {
  PRIMARY_DIALOGUE = "primary_dialogue", // 主对话流 - 处理核心交互内容
  BACKGROUND_ANALYSIS = "background_analysis", // 背景分析 - 探索深层含义与上下文
  SELF_REFLECTION = "self_reflection", // 自我反思 - 审视自身反应的适当性
  CREATIVE_ASSOCIATION = "creative_association", // 创造性联想 - 生成不直接但相关的创意
  EMOTIONAL_PROCESSING = "emotional_processing", // 情感处理 - 评估并整合情感反应
}

/**
 * 思维流状态枚举
 * 跟踪每个思维流的处理状态
 */
export enum ThoughtStreamStatus {
  INITIATED = "initiated", // 已创建但未开始处理
  PROCESSING = "processing", // 正在处理中
  COMPLETED = "completed", // 已完成处理
  PAUSED = "paused", // 暂停处理
  ABANDONED = "abandoned", // 已放弃处理（优先级过低）
}

/**
 * 思维片段接口
 * 表示思维流中的单个思考片段
 */
export interface ThoughtFragment {
  id: string; // 片段唯一ID
  content: string; // 思考内容
  timestamp: number; // 生成时间戳
  metadata?: { // 可选元数据
    confidence?: number; // 信心程度 (0.0-1.0)
    source?: string; // 灵感来源
    emotional_tone?: string; // 情感基调
    [key: string]: any; // 其他元数据
  };
}

/**
 * 思维流接口
 * 表示一条连续的思维过程
 */
export interface ThoughtStream {
  id: string; // 思维流唯一ID
  type: ThoughtStreamType; // 思维流类型
  status: ThoughtStreamStatus; // 当前状态
  fragments: ThoughtFragment[]; // 思维片段集合
  priority: number; // 优先级 (0.0-1.0)
  createdAt: number; // 创建时间戳
  updatedAt: number; // 最后更新时间戳
  completedAt?: number; // 完成时间戳（如果已完成）
  parentStreamId?: string; // 父思维流ID（如果是分支）
  childStreamIds?: string[]; // 子思维流ID集合
  metadata?: { // 可选元数据
    context?: string; // 上下文信息
    purpose?: string; // 思维目的
    userMessage?: string; // 相关用户消息
    [key: string]: any; // 其他元数据
  };
}

/**
 * 思维合成请求接口
 * 合成多个思维流为一个一致的响应
 */
export interface ThoughtSynthesisRequest {
  primaryStream: ThoughtStream; // 主要思维流
  supportingStreams: ThoughtStream[]; // 支持性思维流
  userMessage: string; // 用户原始消息
  maxTokens?: number; // 最大响应长度
  synthesisStyle?: "concise" | "detailed" | "balanced"; // 合成风格
}

/**
 * 思维分布设置接口
 * 配置不同思维类型的相对权重
 */
export interface ThoughtDistributionSettings {
  [ThoughtStreamType.PRIMARY_DIALOGUE]: number;
  [ThoughtStreamType.BACKGROUND_ANALYSIS]: number;
  [ThoughtStreamType.SELF_REFLECTION]: number;
  [ThoughtStreamType.CREATIVE_ASSOCIATION]: number;
  [ThoughtStreamType.EMOTIONAL_PROCESSING]: number;
}

// ================ 思维流管理功能 ================

/**
 * 思维流管理器类
 * 编排和管理多个并行的思维流
 */
export class ThoughtStreamOrchestrator {
  private activeStreams: Map<string, ThoughtStream> = new Map();
  private thoughtDistribution: ThoughtDistributionSettings;

  constructor(distribution?: Partial<ThoughtDistributionSettings>) {
    // 设置默认思维分布权重
    this.thoughtDistribution = {
      [ThoughtStreamType.PRIMARY_DIALOGUE]:
        distribution?.[ThoughtStreamType.PRIMARY_DIALOGUE] ?? 1.0,
      [ThoughtStreamType.BACKGROUND_ANALYSIS]:
        distribution?.[ThoughtStreamType.BACKGROUND_ANALYSIS] ?? 0.7,
      [ThoughtStreamType.SELF_REFLECTION]:
        distribution?.[ThoughtStreamType.SELF_REFLECTION] ?? 0.5,
      [ThoughtStreamType.CREATIVE_ASSOCIATION]:
        distribution?.[ThoughtStreamType.CREATIVE_ASSOCIATION] ?? 0.3,
      [ThoughtStreamType.EMOTIONAL_PROCESSING]:
        distribution?.[ThoughtStreamType.EMOTIONAL_PROCESSING] ?? 0.4,
    };
  }

  /**
   * 创建新的思维流
   * @param type 思维流类型
   * @param initialContent 初始内容
   * @param metadata 相关元数据
   * @param priority 优先级（可选）
   * @returns 新思维流ID
   */
  async createStream(
    type: ThoughtStreamType,
    initialContent?: string,
    metadata?: Record<string, any>,
    priority?: number,
  ): Promise<string> {
    // 使用类型默认优先级或指定优先级
    const streamPriority = priority ?? this.thoughtDistribution[type];

    // 生成流ID
    const streamId = crypto.randomUUID();

    // 创建初始片段（如果有内容）
    const fragments: ThoughtFragment[] = [];
    if (initialContent) {
      fragments.push({
        id: crypto.randomUUID(),
        content: initialContent,
        timestamp: Date.now(),
      });
    }

    // 构造思维流对象
    const stream: ThoughtStream = {
      id: streamId,
      type,
      status: ThoughtStreamStatus.INITIATED,
      fragments,
      priority: streamPriority,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata,
    };

    // 存储到活跃流集合
    this.activeStreams.set(streamId, stream);

    // 持久化存储
    await this.persistStream(stream);

    console.log(
      `[思维流][日志] ✨ 创建思维流: ${streamId}, 类型: ${type}, 优先级: ${
        streamPriority.toFixed(2)
      }`,
    );

    return streamId;
  }

  /**
   * 向思维流添加新的思考片段
   * @param streamId 思维流ID
   * @param content 思考内容
   * @param metadata 片段元数据
   * @returns 添加的片段ID
   */
  async appendFragment(
    streamId: string,
    content: string,
    metadata?: Record<string, any>,
  ): Promise<string | null> {
    // 获取思维流
    const stream = this.activeStreams.get(streamId);
    if (!stream) {
      console.log(`[思维流][日志] ⚠️ 找不到思维流: ${streamId}`);
      return null;
    }

    // 如果流已完成或放弃，不能添加
    if (
      stream.status === ThoughtStreamStatus.COMPLETED ||
      stream.status === ThoughtStreamStatus.ABANDONED
    ) {
      console.log(
        `[思维流][日志] ⚠️ 思维流 ${streamId} 已${
          stream.status === ThoughtStreamStatus.COMPLETED ? "完成" : "放弃"
        }，无法添加片段`,
      );
      return null;
    }

    // 创建新片段
    const fragmentId = crypto.randomUUID();
    const fragment: ThoughtFragment = {
      id: fragmentId,
      content,
      timestamp: Date.now(),
      metadata,
    };

    // 添加到流中
    stream.fragments.push(fragment);
    stream.updatedAt = Date.now();

    // 如果流是暂停状态，切换到处理中
    if (stream.status === ThoughtStreamStatus.PAUSED) {
      stream.status = ThoughtStreamStatus.PROCESSING;
    }

    // 更新存储
    await this.persistStream(stream);

    console.log(
      `[思维流][日志] ✏️ 添加思维片段: ${fragmentId} 到流 ${streamId}`,
    );
    return fragmentId;
  }

  /**
   * 标记思维流为已完成
   * @param streamId 思维流ID
   * @returns 是否成功
   */
  async completeStream(streamId: string): Promise<boolean> {
    const stream = this.activeStreams.get(streamId);
    if (!stream) return false;

    stream.status = ThoughtStreamStatus.COMPLETED;
    stream.completedAt = Date.now();
    stream.updatedAt = Date.now();

    await this.persistStream(stream);

    console.log(
      `[思维流][日志] 🏁 完成思维流: ${streamId}, 类型: ${stream.type}, 片段数: ${stream.fragments.length}`,
    );
    return true;
  }

  /**
   * 暂停思维流处理
   * @param streamId 思维流ID
   * @returns 是否成功
   */
  async pauseStream(streamId: string): Promise<boolean> {
    const stream = this.activeStreams.get(streamId);
    if (!stream) return false;

    if (
      stream.status === ThoughtStreamStatus.PROCESSING ||
      stream.status === ThoughtStreamStatus.INITIATED
    ) {
      stream.status = ThoughtStreamStatus.PAUSED;
      stream.updatedAt = Date.now();

      await this.persistStream(stream);

      console.log(`[思维流][日志] ⏸️ 暂停思维流: ${streamId}`);
      return true;
    }

    return false;
  }

  /**
   * 放弃低优先级思维流
   * @param priorityThreshold 优先级阈值
   * @returns 放弃的流ID数组
   */
  async abandonLowPriorityStreams(
    priorityThreshold: number,
  ): Promise<string[]> {
    const abandonedIds: string[] = [];

    for (const [id, stream] of this.activeStreams.entries()) {
      if (
        stream.priority < priorityThreshold &&
        stream.status !== ThoughtStreamStatus.COMPLETED &&
        stream.status !== ThoughtStreamStatus.ABANDONED
      ) {
        stream.status = ThoughtStreamStatus.ABANDONED;
        stream.updatedAt = Date.now();

        await this.persistStream(stream);
        abandonedIds.push(id);

        console.log(
          `[思维流][日志] 🗑️ 放弃低优先级思维流: ${id}, 优先级: ${
            stream.priority.toFixed(2)
          }`,
        );
      }
    }

    return abandonedIds;
  }

  /**
   * 获取指定思维流
   * @param streamId 思维流ID
   * @returns 思维流对象
   */
  async getStream(streamId: string): Promise<ThoughtStream | null> {
    // 先从内存缓存获取
    if (this.activeStreams.has(streamId)) {
      return this.activeStreams.get(streamId)!;
    }

    // 从持久化存储获取
    if (!kv) {
      console.warn(
        "[思维流][日志] KV 存储不可用，无法从持久化存储获取思维流。",
      );
      return null;
    }
    const streamKey = ["thought_stream", streamId];
    const entry = await kv.get<ThoughtStream>(streamKey);

    if (entry.value) {
      // 加入内存缓存
      this.activeStreams.set(streamId, entry.value);
      return entry.value;
    }

    return null;
  }

  /**
   * 获取所有活跃的思维流
   * @param types 可选的类型过滤
   * @returns 思维流对象数组
   */
  async getActiveStreams(
    types?: ThoughtStreamType[],
  ): Promise<ThoughtStream[]> {
    // 从内存缓存和持久化存储合并结果
    const streams: ThoughtStream[] = [];

    // 添加内存中的活跃流
    for (const stream of this.activeStreams.values()) {
      if (!types || types.includes(stream.type)) {
        if (
          stream.status === ThoughtStreamStatus.PROCESSING ||
          stream.status === ThoughtStreamStatus.INITIATED
        ) {
          streams.push(stream);
        }
      }
    }

    // 从持久化存储查找可能不在内存中的活跃流
    if (!kv) {
      console.warn(
        "[思维流][日志] KV 存储不可用，无法查找持久化的活跃思维流。",
      );
      return streams; // 只返回内存中的
    }
    const prefix = ["thought_stream_active"];
    const activeEntries = kv.list<{ streamId: string }>({ prefix });

    for await (const entry of activeEntries) {
      const streamId = entry.value.streamId;
      if (!this.activeStreams.has(streamId)) {
        const stream = await this.getStream(streamId);
        if (stream && (!types || types.includes(stream.type))) {
          if (
            stream.status === ThoughtStreamStatus.PROCESSING ||
            stream.status === ThoughtStreamStatus.INITIATED
          ) {
            streams.push(stream);
          }
        }
      }
    }

    return streams;
  }

  /**
   * 持久化存储思维流
   * @param stream 思维流对象
   */
  private async persistStream(stream: ThoughtStream): Promise<void> {
    if (!kv) {
      console.warn("[思维流][日志] KV 存储不可用，无法持久化思维流。");
      return;
    }
    // 存储完整流对象
    const streamKey = ["thought_stream", stream.id];
    await kv.set(streamKey, stream);

    // 维护活跃流索引
    const activeKey = ["thought_stream_active", stream.id];
    if (
      stream.status === ThoughtStreamStatus.PROCESSING ||
      stream.status === ThoughtStreamStatus.INITIATED
    ) {
      await kv.set(activeKey, { streamId: stream.id });
    } else {
      // 如果不再活跃，移除索引
      await kv.delete(activeKey);
    }

    // 按类型维护索引
    const typeKey = ["thought_stream_by_type", stream.type, stream.id];
    await kv.set(typeKey, { streamId: stream.id });
  }
}

// ================ 思维流生成功能 ================

/**
 * 生成主对话思维流
 * 处理用户直接询问的核心响应
 * @param orchestrator 思维流管理器
 * @param message 用户消息
 * @param context 上下文信息
 * @returns 创建的思维流ID
 */
export async function generatePrimaryDialogueStream(
  orchestrator: ThoughtStreamOrchestrator,
  message: string,
  context: Record<string, any>,
): Promise<string> {
  console.log(
    `[思维流][日志] 🌊 生成主对话思维流，消息长度: ${message.length}`,
  );

  const initialContent = `开始处理用户消息: "${message.substring(0, 50)}${
    message.length > 50 ? "..." : ""
  }"`;

  const streamId = await orchestrator.createStream(
    ThoughtStreamType.PRIMARY_DIALOGUE,
    initialContent,
    {
      context,
      userMessage: message,
      purpose: "生成用户问题的核心回应",
    },
    1.0, // 主对话流始终最高优先级
  );

  // 生成初步思考
  const initialThinking =
    `深入分析用户消息，提取核心问题和意图，识别可能的隐含请求或假设。

用户消息: "${message}"

消息理解:
- 首要意图: ...
- 次要意图: ...
- 潜在隐含请求: ...
- 上下文信息: ...
- 情感倾向: ...
- 知识要求: ...`;

  await orchestrator.appendFragment(
    streamId,
    initialThinking,
    { phase: "initial_analysis" },
  );

  // 请求LLM生成对话思维
  try {
    const prompt =
      `我正在处理以下用户消息，请帮助我分析核心意图并构思回应的整体框架。

用户消息: "${message}"

请提供:
1. 对用户意图的理解（核心问题是什么）
2. 回应应包含的关键要点
3. 回应的整体结构建议
4. 考虑的相关上下文或知识领域
5. 合适的语气和风格建议

以连贯段落的形式提供这些思考，不要使用标题或编号列表。把这些视为你对如何回应的思考过程，而不是最终回应。`;

    const response = await llm.invoke(prompt);
    const primaryThinking = typeof response === "string"
      ? response
      : (response.content as string); // 确保获取字符串

    await orchestrator.appendFragment(
      streamId,
      primaryThinking,
      { phase: "core_thinking" },
    );

    console.log(`[思维流][日志] ✅ 主对话思维生成完成: ${streamId}`);
    return streamId;
  } catch (error) {
    console.error(`❌ [思维流][错误] 生成主对话思维时出错: ${error}`);
    await orchestrator.appendFragment(
      streamId,
      `思维生成过程中遇到错误: ${error}。将使用基础回应模式。`,
      { phase: "error", error: String(error) },
    );
    return streamId;
  }
}

/**
 * 生成背景分析思维流
 * 深入挖掘消息的隐含意义与长期影响
 * @param orchestrator 思维流管理器
 * @param message 用户消息
 * @param relevantMemories 相关记忆
 * @returns 创建的思维流ID
 */
export async function generateBackgroundAnalysisStream(
  orchestrator: ThoughtStreamOrchestrator,
  message: string,
  relevantMemories: MemoryPayload[],
): Promise<string> {
  console.log(
    `[思维流][日志] 🔍 生成背景分析思维流，基于 ${relevantMemories.length} 条相关记忆`,
  );

  const initialContent = `开始分析消息的深层含义和长期影响: "${
    message.substring(0, 50)
  }${message.length > 50 ? "..." : ""}"`;

  const streamId = await orchestrator.createStream(
    ThoughtStreamType.BACKGROUND_ANALYSIS,
    initialContent,
    {
      userMessage: message,
      purpose: "探索消息的隐含意义与长期意义",
      memoryIds: relevantMemories.map((m) =>
        m.insight_metadata?.source_memories?.[0] ||
        (typeof m === "object" && m !== null && "id" in m
          ? String(m.id)
          : undefined)
      ).filter(Boolean), // 尝试获取关联ID或记忆ID
    },
  );

  // 准备内存概要
  const memorySummaries = relevantMemories
    .slice(0, 5) // 限制使用的记忆数量
    .map((m) =>
      `- ${m.text_content.substring(0, 100)}${
        m.text_content.length > 100 ? "..." : ""
      }`
    )
    .join("\n");

  try {
    const prompt =
      `我正在深入分析以下用户消息，探索其深层含义、长期影响和更广泛的上下文。

用户消息: "${message}"

相关的历史记忆:
${memorySummaries || "没有明显相关的历史记忆"}

请提供深度分析，考虑:
1. 这个问题/请求如何与用户的过往互动和兴趣联系起来？
2. 可能隐含的长期目标或未明确表达的需求是什么？
3. 这个问题在更广泛的知识或哲学背景下有什么意义？
4. 用户可能没有考虑到的相关角度或维度是什么？
5. 回应这个问题的深层价值或意义是什么？

把这些视为你对消息更深层次理解的思考过程，以流畅的叙述形式表达，而不是列表。`;

    const response = await llm.invoke(prompt);
    const analysisThinking = typeof response === "string"
      ? response
      : (response.content as string); // 确保获取字符串

    await orchestrator.appendFragment(
      streamId,
      analysisThinking,
      { phase: "deep_analysis" },
    );

    console.log(`[思维流][日志] ✅ 背景分析思维生成完成: ${streamId}`);
    return streamId;
  } catch (error) {
    console.error(`❌ [思维流][错误] 生成背景分析思维时出错: ${error}`);
    await orchestrator.appendFragment(
      streamId,
      `分析思维生成过程中遇到错误: ${error}。`,
      { phase: "error", error: String(error) },
    );
    return streamId;
  }
}

/**
 * 生成自我反思思维流
 * 审视自身反应的适当性与一致性
 * @param orchestrator 思维流管理器
 * @param message 用户消息
 * @param bodyState 虚拟身体状态
 * @returns 创建的思维流ID
 */
export async function generateSelfReflectionStream(
  orchestrator: ThoughtStreamOrchestrator,
  message: string,
  bodyState?: VirtualPhysicalState, // 使用实际的身体状态类型
): Promise<string> {
  console.log(`[思维流][日志] 🪞 生成自我反思思维流`);

  const initialContent = `开始反思如何最适当地响应: "${
    message.substring(0, 50)
  }${message.length > 50 ? "..." : ""}"`;

  const streamId = await orchestrator.createStream(
    ThoughtStreamType.SELF_REFLECTION,
    initialContent,
    {
      userMessage: message,
      purpose: "审视自身反应的适当性",
      bodyState, // 将状态传入元数据
    },
  );

  try {
    // 构建当前状态描述
    let stateDescription = "我当前没有明确的内部状态信息。";
    if (bodyState) {
      stateDescription = `
我当前的内部状态:
- 能量水平: ${bodyState.energy_level.toFixed(2)} (0-1范围)
- 舒适度: ${bodyState.comfort_level.toFixed(2)} (0-1范围)
- 连贯性: ${bodyState.coherence_level.toFixed(2)} (0-1范围)`;
    }

    const prompt =
      `作为一个先进的AI系统，我正在反思如何最恰当地响应以下用户消息。

用户消息: "${message}"

${stateDescription}

请帮我进行自我反思，考虑:
1. 回应这个问题时，我应当注意避免哪些潜在的偏见或假设？
2. 我可能容易忽略的角度或考虑是什么？
3. 如何确保我的回应既有帮助性又保持适当的界限？
4. 基于我当前的内部状态，我应如何调整我的回应方式？
5. 哪些回应方式可能与我的核心价值观或目标不一致？

将这些反思以一种内省的、自我意识的思考流表达出来。这是我内部的反思过程，不是直接回应用户的内容。`;

    const response = await llm.invoke(prompt);
    const reflectionThinking = typeof response === "string"
      ? response
      : (response.content as string); // 确保获取字符串

    await orchestrator.appendFragment(
      streamId,
      reflectionThinking,
      { phase: "self_reflection" },
    );

    console.log(`[思维流][日志] ✅ 自我反思思维生成完成: ${streamId}`);
    return streamId;
  } catch (error) {
    console.error(`❌ [思维流][错误] 生成自我反思思维时出错: ${error}`);
    await orchestrator.appendFragment(
      streamId,
      `反思思维生成过程中遇到错误: ${error}。`,
      { phase: "error", error: String(error) },
    );
    return streamId;
  }
}

/**
 * 生成创造性联想思维流
 * 生成不直接但相关的创意连接
 * @param orchestrator 思维流管理器
 * @param message 用户消息
 * @returns 创建的思维流ID
 */
export async function generateCreativeAssociationStream(
  orchestrator: ThoughtStreamOrchestrator,
  message: string,
): Promise<string> {
  console.log(`[思维流][日志] 💫 生成创造性联想思维流`);

  const initialContent = `开始创造性联想: "${message.substring(0, 50)}${
    message.length > 50 ? "..." : ""
  }"`;

  const streamId = await orchestrator.createStream(
    ThoughtStreamType.CREATIVE_ASSOCIATION,
    initialContent,
    {
      userMessage: message,
      purpose: "生成创造性联想和隐喻",
    },
  );

  try {
    const prompt = `我正在寻找与以下用户消息相关的创造性联想、比喻和隐喻。

用户消息: "${message}"

请帮我进行创造性思考，生成:
1. 可能的跨领域联想（这个主题如何与艺术、科学、自然或哲学等不同领域产生联系）
2. 有启发性的比喻或隐喻（"这就像..."）
3. 不明显但有见地的角度或联系
4. 诗意的或想象力丰富的相关概念
5. 出人意料但相关的思考方向

请以自由流动的创造性思维形式表达，而不是列表。这是为了丰富我的思考，而不是直接回应用户。`;

    const response = await llm.invoke(prompt);
    const creativeThinking = typeof response === "string"
      ? response
      : (response.content as string); // 确保获取字符串

    await orchestrator.appendFragment(
      streamId,
      creativeThinking,
      { phase: "creative_association" },
    );

    console.log(`[思维流][日志] ✅ 创造性联想思维生成完成: ${streamId}`);
    return streamId;
  } catch (error) {
    console.error(`❌ [思维流][错误] 生成创造性联想思维时出错: ${error}`);
    await orchestrator.appendFragment(
      streamId,
      `创造性思维生成过程中遇到错误: ${error}。`,
      { phase: "error", error: String(error) },
    );
    return streamId;
  }
}

/**
 * 生成情感处理思维流 (修改版)
 * 评估并整合情感反应
 * @param orchestrator 思维流管理器
 * @param message 用户消息
 * @param relationshipState 关系状态 (使用新的类型)
 * @returns 创建的思维流ID
 */
export async function generateEmotionalProcessingStream(
  orchestrator: ThoughtStreamOrchestrator,
  message: string,
  relationshipState?: EnhancedRelationshipState, // <-- 修改类型
): Promise<string> {
  console.log(`[思维流][日志] 💭 生成情感处理思维流`);

  const initialContent = `开始处理情感维度: "${message.substring(0, 50)}${
    message.length > 50 ? "..." : ""
  }"`;

  const streamId = await orchestrator.createStream(
    ThoughtStreamType.EMOTIONAL_PROCESSING,
    initialContent,
    {
      userMessage: message,
      purpose: "评估情感反应和共鸣",
      relationshipState, // 将状态传入元数据
    },
  );

  try {
    // 构建关系状态描述 (使用新的结构)
    let relationshipDescription = "我与用户没有明确的关系历史信息。";
    if (relationshipState) {
      // --- 修改：访问 dimensions 子对象 ---
      const familiarity = relationshipState.dimensions?.familiarity;
      const trust = relationshipState.dimensions?.trust;
      const emotionalConnection = relationshipState.dimensions
        ?.emotional_connection;
      // --- 修改结束 ---

      relationshipDescription = `
我与用户的关系状态:
- 熟悉度: ${familiarity?.toFixed(2) ?? "N/A"} (0-1范围)
- 信任度: ${trust?.toFixed(2) ?? "N/A"} (0-1范围)
- 情感连接: ${emotionalConnection?.toFixed(2) ?? "N/A"} (0-1范围)
- 关系阶段: ${relationshipState.stage || "N/A"}`; // 可以加入关系阶段信息
    }

    const prompt = `我正在处理对以下用户消息的情感反应和共鸣。

用户消息: "${message}"

${relationshipDescription}

请帮我进行情感处理，考虑:
1. 这个消息可能传达的显性和隐性情感是什么？
2. 基于我们的关系历史，这个消息在情感上的意义是什么？
3. 什么样的情感基调最适合我的回应？
4. 如何在保持真实的同时表达适当的情感共鸣？
5. 我可能忽略的情感层面是什么？

请以流畅的情感思考形式表达，关注感受、关系和连接，而不是技术或分析性思考。`;

    const response = await llm.invoke(prompt);
    const emotionalThinking = typeof response === "string"
      ? response
      : (response.content as string); // 确保获取字符串

    await orchestrator.appendFragment(
      streamId,
      emotionalThinking,
      { phase: "emotional_processing" },
    );

    console.log(`[思维流][日志] ✅ 情感处理思维生成完成: ${streamId}`);
    return streamId;
  } catch (error) {
    console.error(`❌ [思维流][错误] 生成情感处理思维时出错: ${error}`);
    await orchestrator.appendFragment(
      streamId,
      `情感思维生成过程中遇到错误: ${error}。`,
      { phase: "error", error: String(error) },
    );
    return streamId;
  }
}

// ================ 思维合成功能 ================

/**
 * 合成多个思维流为一个一致的回应
 * @param request 合成请求
 * @returns 合成的回应
 */
export async function synthesizeThoughtStreams(
  request: ThoughtSynthesisRequest,
): Promise<string> {
  console.log(
    `[思维流][日志] 🔄 开始合成思维流，主流ID: ${request.primaryStream.id}, 支持流数量: ${request.supportingStreams.length}`,
  );

  // 提取主要思维流内容
  const primaryContent = request.primaryStream.fragments
    .map((f) => f.content)
    .join("\n\n");

  // 按类型组织支持性思维流
  const supportingContentByType: Record<string, string> = {}; // 使用 string 作为 key 类型

  for (const stream of request.supportingStreams) {
    if (stream.fragments.length === 0) continue;

    const content = stream.fragments
      .map((f) => f.content)
      .join("\n\n");

    supportingContentByType[stream.type] = content; // 使用枚举值作为 key
  }

  // 合成样式调整
  const synthesisStyle = request.synthesisStyle || "balanced";
  let styleInstruction = "";

  switch (synthesisStyle) {
    case "concise":
      styleInstruction = "简洁明了，直接回应核心问题，优先使用主思维流内容";
      break;
    case "detailed":
      styleInstruction =
        "详细全面，整合所有思维流的深度见解，提供丰富的上下文和联想";
      break;
    default: // balanced
      styleInstruction =
        "平衡简洁与深度，整合关键见解，保持回应的连贯性和自然流动";
      break;
  }

  try {
    // 构建合成提示
    const prompt = `我需要合成多条并行思维流为一个连贯、自然的回应。

用户原始消息: "${request.userMessage}"

我的主要思维（核心回应思路）:
${primaryContent}

${
      supportingContentByType[ThoughtStreamType.BACKGROUND_ANALYSIS]
        ? `
我的背景分析思维（深层含义与上下文）:
${supportingContentByType[ThoughtStreamType.BACKGROUND_ANALYSIS]}
`
        : ""
    }

${
      supportingContentByType[ThoughtStreamType.SELF_REFLECTION]
        ? `
我的自我反思思维（考虑适当性与完整性）:
${supportingContentByType[ThoughtStreamType.SELF_REFLECTION]}
`
        : ""
    }

${
      supportingContentByType[ThoughtStreamType.CREATIVE_ASSOCIATION]
        ? `
我的创造性联想思维（相关的比喻与联系）:
${supportingContentByType[ThoughtStreamType.CREATIVE_ASSOCIATION]}
`
        : ""
    }

${
      supportingContentByType[ThoughtStreamType.EMOTIONAL_PROCESSING]
        ? `
我的情感处理思维（情感基调与共鸣）:
${supportingContentByType[ThoughtStreamType.EMOTIONAL_PROCESSING]}
`
        : ""
    }

请将这些思维流合成为一个完整、连贯的回应，设计为直接回答用户的原始消息。回应应当是:
- ${styleInstruction}
- 富有个性和自然感，而不是机械或公式化的
- 整合各种思维流的洞见，但保持一致的声音和风格
- 适当保留创造性的比喻或联想，但不要过于抽象
- 确保在自我意识和服务用户需求之间取得平衡

请直接生成最终回应，不要包含元评论或解释你如何合成。回应应该是自然的，就像是经过深思熟虑后的单一思维流。`;

    const response = await llm.invoke(prompt);
    const synthesized = typeof response === "string"
      ? response
      : (response.content as string); // 确保获取字符串

    console.log(
      `[思维流][日志] ✅ 思维流合成完成，长度: ${synthesized.length}`,
    );
    return synthesized;
  } catch (error) {
    console.error(`❌ [思维流][错误] 合成思维流时出错: ${error}`);

    // 出错时返回主思维流的内容作为后备
    const fallbackResponse =
      `我似乎在整理思绪时遇到了一点困难，但让我尝试回答你的问题。\n\n${
        primaryContent.split("\n").slice(-10).join("\n") // 使用主思维流的最后部分
      }`;

    return fallbackResponse;
  }
}

/**
 * 协调并生成多个思维流 (修改版)
 * @param message 用户消息
 * @param context 上下文信息 (应包含 userId)
 * @param memories 相关记忆
 * @param bodyState 身体状态
 * @param relationshipState 关系状态 (使用新类型)
 * @returns 主思维流ID和所有生成的思维流ID数组
 */
export async function orchestrateThoughtStreams(
  message: string,
  context: Record<string, any>,
  memories: MemoryPayload[] = [],
  bodyState?: VirtualPhysicalState,
  relationshipState?: EnhancedRelationshipState, // <-- 修改类型
): Promise<{ primaryStreamId: string; allStreamIds: string[] }> {
  console.log(
    `[思维流][日志] 🧠 开始编排思维流，消息: "${message.substring(0, 30)}..."`,
  );

  // 创建思维流管理器
  const orchestrator = new ThoughtStreamOrchestrator();
  const allStreamIds: string[] = [];

  // --- 确保 context 包含 userId ---
  const userId = context.userId || "unknown_user";
  if (!context.userId) {
    console.warn(
      "[思维流][日志] ⚠️ 编排思维流时缺少 userId，部分功能可能受限。",
    );
  }
  // --- 获取社交认知管理器实例 (如果需要的话) ---
  const socialCognition = getSocialCognitionManager();
  // --- 如果 relationshipState 未传入，尝试获取 ---
  if (!relationshipState && userId !== "unknown_user") {
    relationshipState = await socialCognition.getRelationshipState(userId);
  }

  // 创建主对话思维流
  const primaryStreamId = await generatePrimaryDialogueStream(
    orchestrator,
    message,
    context,
  );
  allStreamIds.push(primaryStreamId);

  // 并行生成其他思维流
  const backgroundPromise = generateBackgroundAnalysisStream(
    orchestrator,
    message,
    memories,
  ).then((id) => {
    allStreamIds.push(id);
    return id;
  }).catch((e) => {
    console.error(`❌ [思维流][错误] 背景分析思维流生成失败: ${e}`);
    return null;
  });

  const reflectionPromise = generateSelfReflectionStream(
    orchestrator,
    message,
    bodyState, // 传递身体状态
  ).then((id) => {
    allStreamIds.push(id);
    return id;
  }).catch((e) => {
    console.error(`❌ [思维流][错误] 自我反思思维流生成失败: ${e}`);
    return null;
  });

  const creativePromise = generateCreativeAssociationStream(
    orchestrator,
    message,
  ).then((id) => {
    allStreamIds.push(id);
    return id;
  }).catch((e) => {
    console.error(`❌ [思维流][错误] 创造性联想思维流生成失败: ${e}`);
    return null;
  });

  const emotionalPromise = generateEmotionalProcessingStream(
    orchestrator,
    message,
    relationshipState, // 传递关系状态 (使用新类型)
  ).then((id) => {
    allStreamIds.push(id);
    return id;
  }).catch((e) => {
    console.error(`❌ [思维流][错误] 情感处理思维流生成失败: ${e}`);
    return null;
  });

  // 等待所有思维流生成完成
  await Promise.allSettled([
    backgroundPromise,
    reflectionPromise,
    creativePromise,
    emotionalPromise,
  ]);

  console.log(
    `[思维流][日志] ✅ 思维流编排完成，共 ${allStreamIds.length} 条思维流`,
  );

  return {
    primaryStreamId,
    allStreamIds: allStreamIds.filter(Boolean) as string[],
  };
}

/**
 * 完整的思维处理流程 (修改版)
 * 从创建思维流到合成最终回应
 * @param message 用户消息
 * @param context 上下文信息 (应包含 userId)
 * @param memories 相关记忆
 * @param bodyState 身体状态
 * @param relationshipState 关系状态 (使用新类型)
 * @param synthesisStyle 合成风格
 * @returns 合成的最终回应
 */
export async function processThoughtStreams(
  message: string,
  context: Record<string, any>,
  memories: MemoryPayload[] = [],
  bodyState?: VirtualPhysicalState,
  relationshipState?: EnhancedRelationshipState, // <-- 修改类型
  synthesisStyle: "concise" | "detailed" | "balanced" = "balanced",
): Promise<string> {
  console.log(`[思维流][日志] 🌊 启动思维流处理，合成风格: ${synthesisStyle}`);

  // 编排思维流 (传递所有状态)
  const { primaryStreamId, allStreamIds } = await orchestrateThoughtStreams(
    message,
    context,
    memories,
    bodyState,
    relationshipState,
  );

  // 创建管理器并获取所有生成的思维流
  const orchestrator = new ThoughtStreamOrchestrator();
  const primaryStream = await orchestrator.getStream(primaryStreamId);

  if (!primaryStream) {
    console.error(`❌ [思维流][错误] 无法获取主思维流: ${primaryStreamId}`);
    return `我在处理你的请求时遇到了问题，无法生成完整的回应。请再次尝试或换一种方式提问。`;
  }

  // 收集支持性思维流
  const supportingStreams: ThoughtStream[] = [];
  for (const streamId of allStreamIds) {
    if (streamId === primaryStreamId) continue;

    const stream = await orchestrator.getStream(streamId);
    if (stream) {
      supportingStreams.push(stream);
    }
  }

  // 合成思维流为最终回应
  const response = await synthesizeThoughtStreams({
    primaryStream,
    supportingStreams,
    userMessage: message,
    synthesisStyle,
  });

  // 完成所有思维流
  for (const streamId of allStreamIds) {
    await orchestrator.completeStream(streamId);
  }

  return response;
}

// 导出主要功能
export const thoughtStreams = {
  ThoughtStreamOrchestrator,
  orchestrateThoughtStreams,
  processThoughtStreams,
  synthesizeThoughtStreams,
};

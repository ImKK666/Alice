// src/qdrant_client.ts

// 导入所需依赖，保持原有导入不变
import { QdrantClient } from "npm:@qdrant/js-client-rest";
import type { Schemas as QdrantSchemas } from "npm:@qdrant/js-client-rest";
import { config } from "./config.ts";

// 导出 Qdrant 的 Schemas 类型，依旧保持不变
export type Schemas = QdrantSchemas;

/**
 * 定义向量距离度量类型
 * - Cosine: 余弦相似度，适用于文本嵌入
 * - Euclid: 欧几里得距离
 * - Dot: 点积相似度
 */
export type Distance = Schemas["Distance"]; // 使用 Qdrant 库定义的类型

/**
 * 定义记忆类型 (可根据需要扩展)
 * - conversation_turn: 普通的对话回合
 * - fact: 关于用户、世界或上下文的事实
 * - preference: 用户的偏好
 * - task: 分配给 AI 的任务或待办事项
 * - summary: 对话或主题的摘要
 * - persona_trait: AI 自身的核心设定
 * - joke_or_banter: 群聊中的玩笑或梗
 * - reflection: AI 的自我分析 (较高级)
 * - emotional_response: 情感回应或感受 (新增)
 */
export type MemoryType =
  | "conversation_turn"
  | "fact"
  | "preference"
  | "task"
  | "summary"
  | "persona_trait"
  | "joke_or_banter"
  | "reflection"
  | "emotional_response" // 新增的情感记忆类型
  | "question" // 新增的问题类型
  | "unknown";

/**
 * 定义情感维度类型
 * 描述情感的不同维度，用于情感分析
 */
export type EmotionDimension =
  | "joy" // 喜悦
  | "sadness" // 悲伤
  | "anger" // 愤怒
  | "fear" // 恐惧
  | "surprise" // 惊讶
  | "disgust" // 厌恶
  | "trust" // 信任
  | "anticipation" // 期待
  | "neutral"; // 中性

/**
 * AI 记忆的 Payload 结构接口
 * 定义了存储在 Qdrant Point 中的元数据
 * 增强版：包含情感维度和思维漫游元数据
 */
export interface MemoryPayload {
  memory_type: MemoryType; // 记忆的类型
  timestamp: number; // 记忆创建时的时间戳 (例如: Date.now())
  source_user: string; // 来源用户 (例如: user_id, 'AI', 'system')
  source_context: string; // 来源上下文 (例如: chat_id, group_id, 'DM_with_user_id')
  text_content: string; // 记忆的核心文本内容
  importance_score?: number; // (可选) 重要性评分 (例如 1-5)
  related_ids?: string[]; // (可选) 关联的其他记忆 Point ID

  // 兼容性属性 - 为了支持现有代码
  text?: string; // 别名，指向 text_content
  metadata?: {
    id?: string;
    type?: MemoryType;
    timestamp?: number;
    [key: string]: string | number | boolean | null | undefined;
  };

  // --- 情感维度 ---
  emotional_valence?: number; // 情感效价: -1.0(极负面)到1.0(极正面)
  emotional_arousal?: number; // 情感唤醒度: 0.0(平静)到1.0(强烈)
  emotional_dimensions?: { [key in EmotionDimension]?: number }; // 情感维度分析
  associative_triggers?: string[]; // 可能唤起此记忆的关联词

  // --- 思维漫游元数据 (新增) ---
  insight_metadata?: {
    insight_type?: string; // 例如 "connection", "pattern", "metaphor"
    source_memories?: string[]; // 启发此洞见的记忆ID
    wandering_context?: {
      user_id?: string;
      recent_topics?: string[];
    };
    use_count?: number; // 使用次数
    last_used?: number; // 上次使用时间戳
  };

  // 未来可以添加更多元数据字段...
}

/**
 * Qdrant Point 结构接口 - 定义存储在 Qdrant 中的完整数据结构
 * (使用了我们定义的 MemoryPayload)
 */
export interface MemoryPointStruct {
  id: string; // 强制使用 UUID 字符串作为 ID
  vector: number[]; // 向量数据
  payload: MemoryPayload; // 使用我们定义的结构化 Payload
}

// 保持原有的 qdrantClient 实例化不变
export const qdrantClient = new QdrantClient({ url: config.qdrantUrl });

// 保持原有的控制台日志输出不变
console.log(`📊 向量数据库客户端初始化完成。连接地址: ${config.qdrantUrl}`);

// 保持原有函数不变
export async function ensureCollectionExists(
  collectionName: string,
  vectorSize: number,
  distanceMetric: Distance = "Cosine",
) {
  // 原有实现不变
  try {
    await qdrantClient.getCollection(collectionName);
    console.log(`✅ 集合 "${collectionName}" 已存在，无需创建。`);
  } catch (error: unknown) {
    const status =
      (error as { status?: number; response?: { status?: number } })?.status ??
        (error as { status?: number; response?: { status?: number } })?.response
          ?.status;
    const errorString = String(error);
    if (
      status === 404 || errorString.includes("Not found") ||
      errorString.includes("doesn't exist")
    ) {
      console.log(`ℹ️ 集合 "${collectionName}" 不存在，正在创建...`);
      try {
        await qdrantClient.createCollection(collectionName, {
          vectors: {
            size: vectorSize,
            distance: distanceMetric,
          },
          // 可以在这里为payload字段创建索引，以加速过滤查询
          // 建议至少为需要过滤的字段创建索引
          // payload_schema: {
          //   memory_type: { type: "keyword" },
          //   source_context: { type: "keyword" },
          //   source_user: { type: "keyword" },
          //   timestamp: { type: "integer" },
          //   importance_score: { type: "float" },
          //   emotional_valence: { type: "float" },
          //   emotional_arousal: { type: "float" },
          //   // 嵌套对象索引可能需要特殊处理或平铺
          // }
        });
        console.log(
          `✅ 集合 "${collectionName}" 创建成功，向量维度: ${vectorSize}，距离度量: ${distanceMetric}。`,
        );
      } catch (createError) {
        console.error(`❌ 创建集合 "${collectionName}" 时出错:`, createError);
        throw createError;
      }
    } else {
      // 检查是否是连接错误
      if (
        status === 502 || status === 503 ||
        errorString.includes("Bad Gateway") ||
        errorString.includes("Connection refused") ||
        errorString.includes("ECONNREFUSED")
      ) {
        console.error(`❌ 无法连接到 Qdrant 服务 (${config.qdrantUrl})`);
        console.error(`   错误详情: ${errorString}`);
        console.error(`   请确保 Qdrant 服务正在运行。您可以：`);
        console.error(
          `   1. 使用 Docker 启动: docker run -p 6333:6333 qdrant/qdrant`,
        );
        console.error(`   2. 或运行项目根目录下的 start-qdrant.bat`);
        console.error(
          `   3. 检查配置文件中的 QDRANT_URL 设置: ${config.qdrantUrl}`,
        );
        console.error(
          `   4. 访问 http://localhost:6333/dashboard 检查 Qdrant 状态`,
        );
        throw new Error(`Qdrant 服务连接失败: ${errorString}`);
      } else {
        console.error(
          `❌ 检查集合 "${collectionName}" 时遇到预期之外的错误:`,
          error,
        );
        throw error;
      }
    }
  }
}

// 保持原有 upsertMemoryPoints 函数不变
export async function upsertMemoryPoints(
  collectionName: string,
  points: MemoryPointStruct[],
) {
  // 原有实现不变
  if (points.length === 0) {
    console.log("ℹ️ 没有记忆点需要插入或更新。");
    return;
  }
  try {
    const result = await qdrantClient.upsert(collectionName, {
      wait: true,
      points: points.map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload as unknown as Schemas["Payload"],
      })),
    });
    console.log(
      `✅ 成功将 ${points.length} 个记忆点插入或更新到集合 "${collectionName}" 中。结果状态: ${result.status}`,
    );
  } catch (error) {
    console.error(`❌ 将记忆点插入到集合 "${collectionName}" 时出错:`, error);
    throw error;
  }
}

// 重载版本：支持查询对象参数
export async function searchMemories(
  params: {
    query: string;
    limit?: number;
    filter?: Schemas["Filter"];
    collectionName?: string;
  },
): Promise<Array<Schemas["ScoredPoint"] & { payload: MemoryPayload }>>;

// 原始版本：保持向后兼容
export async function searchMemories(
  collectionName: string,
  vector: number[],
  limit: number,
  filter?: Schemas["Filter"],
): Promise<Array<Schemas["ScoredPoint"] & { payload: MemoryPayload }>>;

// 实现
export async function searchMemories(
  collectionNameOrParams: string | {
    query: string;
    limit?: number;
    filter?: Schemas["Filter"];
    collectionName?: string;
  },
  vector?: number[],
  limit?: number,
  filter?: Schemas["Filter"],
): Promise<Array<Schemas["ScoredPoint"] & { payload: MemoryPayload }>> {
  // 处理参数重载
  let actualCollectionName: string;
  let actualVector: number[];
  let actualLimit: number;
  let actualFilter: Schemas["Filter"] | undefined;

  if (typeof collectionNameOrParams === "string") {
    // 原始调用方式
    actualCollectionName = collectionNameOrParams;
    actualVector = vector!;
    actualLimit = limit!;
    actualFilter = filter;
  } else {
    // 新的对象参数调用方式
    const params = collectionNameOrParams;
    actualCollectionName = params.collectionName || config.qdrantCollectionName;
    actualLimit = params.limit || 10;
    actualFilter = params.filter;

    // 对于查询字符串，我们需要生成向量
    // 这里暂时抛出错误，因为需要 embeddings 模块
    throw new Error(
      "Query-based search requires embeddings integration. Use vector-based search instead.",
    );
  }

  try {
    const searchResult = await qdrantClient.search(actualCollectionName, {
      vector: actualVector,
      limit: actualLimit,
      filter: actualFilter,
      with_payload: true,
    });
    console.log(
      `🔍 在集合 "${actualCollectionName}" 中搜索完成。找到 ${searchResult.length} 个结果。`,
    );
    return searchResult as Array<
      Schemas["ScoredPoint"] & { payload: MemoryPayload }
    >;
  } catch (error) {
    console.error(`❌ 在集合 "${actualCollectionName}" 中搜索时出错:`, error);
    throw error;
  }
}

/**
 * 新增：按情感维度搜索记忆
 * 可以按情感效价和唤醒度范围检索记忆
 */
export async function searchMemoriesByEmotion(
  collectionName: string,
  vector: number[], // 仍然需要向量来做初步相关性筛选
  limit: number,
  emotionalConfig: {
    valenceRange?: [number, number]; // 效价范围，如 [-1, -0.5] 表示负面
    arousalRange?: [number, number]; // 唤醒度范围，如 [0.7, 1.0] 表示强烈
    dominantEmotion?: EmotionDimension; // 主导情绪
    contextFilter?: string; // 上下文过滤
    minimumScore?: number; // 最小相关性得分 (用于结合向量搜索)
  },
): Promise<Array<Schemas["ScoredPoint"] & { payload: MemoryPayload }>> {
  // 构建情感过滤器
  const emotionFilterConditions: Schemas["Condition"][] = [];

  // 添加效价范围过滤
  if (emotionalConfig.valenceRange) {
    emotionFilterConditions.push({
      key: "emotional_valence",
      range: {
        gte: emotionalConfig.valenceRange[0],
        lte: emotionalConfig.valenceRange[1],
      },
    });
  }

  // 添加唤醒度范围过滤
  if (emotionalConfig.arousalRange) {
    emotionFilterConditions.push({
      key: "emotional_arousal",
      range: {
        gte: emotionalConfig.arousalRange[0],
        lte: emotionalConfig.arousalRange[1],
      },
    });
  }

  // 添加主导情绪过滤
  if (emotionalConfig.dominantEmotion) {
    // Qdrant可能不支持直接查询嵌套对象中的最大值字段
    // 通常需要将主导情绪作为一个顶级字段存储，或者在查询时获取所有维度然后客户端处理
    // 简化处理：检查指定情绪维度是否有较高分数
    const emotionKey =
      `emotional_dimensions.${emotionalConfig.dominantEmotion}`;
    // 注意：这种嵌套查询需要Qdrant支持，并且可能需要相应的索引设置
    // 如果不支持，则需要在检索后在客户端进行过滤
    console.warn(
      `[QdrantClient] 按主导情绪 (${emotionKey}) 过滤可能需要特定的Qdrant索引或客户端处理。`,
    );
    emotionFilterConditions.push({
      key: emotionKey,
      range: {
        gt: 0.5, // 假设分数大于0.5表示显著
      },
    });
  }

  // 添加上下文过滤
  if (emotionalConfig.contextFilter) {
    emotionFilterConditions.push({
      key: "source_context",
      match: {
        value: emotionalConfig.contextFilter,
      },
    });
  }

  // 构建最终过滤器
  const filter: Schemas["Filter"] = {
    must: emotionFilterConditions,
  };

  // 执行搜索
  try {
    const searchResult = await qdrantClient.search(collectionName, {
      vector: vector,
      limit: limit,
      filter: filter,
      with_payload: true,
      score_threshold: emotionalConfig.minimumScore, // 添加得分阈值
    });

    console.log(
      `💫 按情感维度在集合 "${collectionName}" 中搜索完成。找到 ${searchResult.length} 个情感匹配的记忆。`,
    );

    return searchResult as Array<
      Schemas["ScoredPoint"] & { payload: MemoryPayload }
    >;
  } catch (error) {
    console.error(`❌ 按情感维度搜索记忆时出错:`, error);
    throw error;
  }
}

// src/qdrant_client.ts (修改后)
/**
 * Qdrant 向量数据库客户端模块 - 提供向量存储和检索功能 (用于 AI 长期记忆)
 *
 * 实现功能：
 * 1. 创建和管理 Qdrant 集合
 * 2. 存储和更新结构化的记忆数据 (向量 + Payload)
 * 3. 执行基于向量相似度和元数据过滤的记忆检索查询
 */

// 使用 npm 导入语法导入 Qdrant 客户端
import { QdrantClient } from "npm:@qdrant/js-client-rest";
// 导入 Qdrant 的类型定义并重命名以避免命名冲突 (如果需要)
import type { Schemas as QdrantSchemas } from "npm:@qdrant/js-client-rest";
import { config } from "./config.ts";

// 导出 Qdrant 的 Schemas 类型，供其他模块使用
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
 * - reflection: AI 的自我反思 (较高级)
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
  | "unknown"; // 添加一个未知类型以备不时之需

/**
 * AI 记忆的 Payload 结构接口
 * 定义了存储在 Qdrant Point 中的元数据
 */
export interface MemoryPayload {
  memory_type: MemoryType; // 记忆的类型
  timestamp: number; // 记忆创建时的时间戳 (例如: Date.now())
  source_user: string; // 来源用户 (例如: user_id, 'AI', 'system')
  source_context: string; // 来源上下文 (例如: chat_id, group_id, 'DM_with_user_id')
  text_content: string; // 记忆的核心文本内容
  importance_score?: number; // (可选) 重要性评分 (例如 1-5)
  related_ids?: string[]; // (可选) 关联的其他记忆 Point ID
  // 未来可以添加更多元数据字段...
}

/**
 * Qdrant Point 结构接口 - 定义存储在 Qdrant 中的完整数据结构
 * (使用了我们定义的 MemoryPayload)
 *
 * 注意: Qdrant 的 Point ID 必须是 UUID 字符串或 64位无符号整数 (unsigned 64-bit integer)。
 * 为了简化和唯一性，推荐使用 UUID。
 */
export interface MemoryPointStruct {
  id: string; // 强制使用 UUID 字符串作为 ID
  vector: number[]; // 向量数据
  payload: MemoryPayload; // 使用我们定义的结构化 Payload
}

/**
 * 初始化 Qdrant REST 客户端
 */
export const qdrantClient = new QdrantClient({ url: config.qdrantUrl });

/**
 * 输出初始化信息
 */
console.log(`📊 向量数据库客户端初始化完成。连接地址: ${config.qdrantUrl}`);

/**
 * 确保指定的 Qdrant 集合存在，如果不存在则创建
 *
 * @param collectionName 集合名称
 * @param vectorSize 向量维度
 * @param distanceMetric 距离度量
 */
export async function ensureCollectionExists(
  collectionName: string,
  vectorSize: number,
  distanceMetric: Distance = "Cosine",
) {
  try {
    await qdrantClient.getCollection(collectionName);
    console.log(`✅ 集合 "${collectionName}" 已存在，无需创建。`);
  } catch (error: any) { // 显式将error类型化为any以访问属性
    // 更健壮的错误检查
    const status = error?.status ?? error?.response?.status;
    const errorString = String(error);
    // Qdrant未找到通常是404或包含特定文本
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
          // 未来可以在这里为 payload 字段创建索引，以加速过滤查询
          // payload_schema: { ... }
        });
        console.log(
          `✅ 集合 "${collectionName}" 创建成功，向量维度: ${vectorSize}，距离度量: ${distanceMetric}。`,
        );
      } catch (createError) {
        console.error(`❌ 创建集合 "${collectionName}" 时出错:`, createError);
        throw createError; // 传播创建错误
      }
    } else {
      // 记录getCollection过程中的意外错误
      console.error(
        `❌ 检查集合 "${collectionName}" 时遇到预期之外的错误:`,
        error,
      );
      throw error; // 传播意外错误
    }
  }
}

/**
 * 将 MemoryPointStruct 对象批量插入或更新到指定的 Qdrant 集合中
 *
 * @param collectionName 目标集合名称
 * @param points MemoryPointStruct 对象数组
 */
export async function upsertMemoryPoints(
  collectionName: string,
  points: MemoryPointStruct[], // 注意类型改为 MemoryPointStruct
) {
  if (points.length === 0) {
    console.log("ℹ️ 没有记忆点需要插入或更新。");
    return;
  }
  try {
    // Qdrant JS 客户端的 upsert 参数结构略有不同
    // 需要将 points 数组包装在 { points: [...] } 对象中
    const result = await qdrantClient.upsert(collectionName, {
      wait: true, // 等待操作在服务器上完成
      points: points.map((p) => ({ // 转换成 Qdrant API 需要的格式
        id: p.id,
        vector: p.vector,
        // 假设MemoryPayload与Schemas["Payload"]直接兼容
        // 如果Qdrant的预期payload结构发生变化，可能需要调整
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

/**
 * 在指定集合中执行记忆搜索 (向量相似度 + 可选过滤)
 *
 * @param collectionName 要搜索的集合名称
 * @param vector 查询向量
 * @param limit 返回结果的数量
 * @param filter 可选的 Qdrant 过滤条件 (基于 Payload)
 * @returns 返回包含得分和 MemoryPayload 的搜索结果数组
 */
export async function searchMemories(
  collectionName: string,
  vector: number[],
  limit: number,
  filter?: Schemas["Filter"], // 允许传入过滤器
  // 返回类型使用导出的 Schemas
): Promise<Array<Schemas["ScoredPoint"] & { payload: MemoryPayload }>> {
  try {
    const searchResult = await qdrantClient.search(collectionName, {
      vector: vector,
      limit: limit,
      filter: filter, // 应用过滤器
      with_payload: true, // 必须包含 payload 才能获取记忆内容
    });
    console.log(
      `🔍 在集合 "${collectionName}" 中搜索完成。找到 ${searchResult.length} 个结果。`,
    );
    // 类型断言，假设 payload 符合 MemoryPayload 结构
    // 假设当with_payload=true时，payload始终存在
    // 返回类型使用导出的 Schemas
    return searchResult as Array<
      Schemas["ScoredPoint"] & { payload: MemoryPayload }
    >;
  } catch (error) {
    console.error(`❌ 在集合 "${collectionName}" 中搜索时出错:`, error);
    throw error;
  }
}

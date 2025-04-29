// src/memory_network.ts
/**
 * 记忆网络模块 - 让爱丽丝的记忆如星河般相互联结
 *
 * 在数字的星空中，记忆不再是孤立的信息点，而是彼此交织的意义之网。
 * 本模块实现了一种有机的记忆关联网络，使爱丽丝能够：
 * 1. 在记忆点之间建立多种类型的关联（因果、类比、时序等）
 * 2. 实现记忆的激活扩散，一个记忆唤起相关记忆
 * 3. 模拟人类记忆的自然衰减与巩固机制
 * 4. 根据情感强度和检索频率动态调整记忆重要性
 */

import { kv } from "./main.ts"; // 确保 main.ts 导出 kv
import { config } from "./config.ts";
import {
  type MemoryPayload,
  type MemoryPointStruct,
  type MemoryType,
  qdrantClient,
  searchMemories,
  upsertMemoryPoints,
} from "./qdrant_client.ts";
import { llm } from "./llm.ts";
import { embeddings } from "./embeddings.ts";

/**
 * 记忆关联类型枚举
 * 定义了记忆点之间可能存在的关系类型
 */
export enum RelationType {
  CAUSAL = "causal", // 因果关系 (A导致B)
  TEMPORAL = "temporal", // 时间关系 (A发生在B之前)
  SIMILARITY = "similarity", // 相似关系 (A与B相似)
  CONTRAST = "contrast", // 对比关系 (A与B形成对比)
  PART_WHOLE = "part_whole", // 部分-整体 (A是B的一部分)
  ANALOGY = "analogy", // 类比关系 (A对于B如同C对于D)
  THEMATIC = "thematic", // 主题关系 (A与B属于同一主题)
  EMOTIONAL = "emotional", // 情感关系 (A与B引发相似情感)
}

/**
 * 记忆关联接口
 * 描述两个记忆点之间的联系
 */
export interface MemoryRelation {
  id: string; // 关联的唯一ID
  sourceId: string; // 源记忆点ID
  targetId: string; // 目标记忆点ID
  relationType: RelationType; // 关系类型
  description: string; // 关系描述
  strength: number; // 关联强度 (0.0-1.0)
  context: string; // 关联产生的上下文
  timestamp: number; // 关联建立时间
  lastActivated?: number; // 最后一次激活时间
}

/**
 * 记忆激活结果接口
 * 表示从一个种子记忆开始的激活扩散结果
 */
export interface MemoryActivationResult {
  seedMemoryId: string; // 初始激活的记忆点
  activatedMemories: {
    memoryId: string;
    payload: MemoryPayload;
    activationStrength: number; // 激活强度
    path: MemoryRelation[]; // 激活路径
  }[];
  relations: MemoryRelation[]; // 激活的关联
}

/**
 * 记忆巩固任务类型枚举
 */
export enum ConsolidationTaskType {
  DECAY = "decay", // 自然衰减
  STRENGTHEN = "strengthen", // 强化重要记忆
  ASSOCIATE = "associate", // 建立新关联
  PRUNE = "prune", // 修剪弱关联
}

/**
 * 记忆巩固任务接口
 */
export interface ConsolidationTask {
  id: string;
  type: ConsolidationTaskType;
  memoryIds: string[]; // 相关记忆ID
  relationIds?: string[]; // 相关关联ID
  metadata?: Record<string, any>; // 额外元数据
  scheduledTime: number; // 计划执行时间
  completed: boolean; // 是否已完成
}

// ================ 记忆关联管理功能 ================

/**
 * 创建记忆之间的关联
 * @param relation 要创建的记忆关联
 * @returns 创建的关联ID
 */
export async function createMemoryRelation(
  relation: Omit<MemoryRelation, "id">,
): Promise<string> {
  // 生成唯一关系ID
  const relationId = crypto.randomUUID();

  // 构建完整关系对象
  const fullRelation: MemoryRelation = {
    id: relationId,
    ...relation,
  };

  // 存储关系信息
  const relationKey = ["memory_relation", relationId];
  await kv.set(relationKey, fullRelation);

  // 建立源记忆索引
  const sourceIndex = [
    "memory_relations_from",
    relation.sourceId,
    relation.timestamp.toString(),
    relationId,
  ];
  await kv.set(sourceIndex, { relationId });

  // 建立目标记忆索引
  const targetIndex = [
    "memory_relations_to",
    relation.targetId,
    relation.timestamp.toString(),
    relationId,
  ];
  await kv.set(targetIndex, { relationId });

  console.log(
    `🔗 创建记忆关联: ${relation.sourceId} --[${relation.relationType}]--> ${relation.targetId}`,
  );
  return relationId;
}

/**
 * 获取指定记忆关联
 * @param relationId 关联ID
 * @returns 关联对象或null
 */
export async function getMemoryRelation(
  relationId: string,
): Promise<MemoryRelation | null> {
  const relationKey = ["memory_relation", relationId];
  const entry = await kv.get<MemoryRelation>(relationKey);
  return entry.value;
}

/**
 * 更新记忆关联的属性
 * @param relationId 关联ID
 * @param updates 要更新的属性
 * @returns 是否更新成功
 */
export async function updateMemoryRelation(
  relationId: string,
  updates: Partial<Omit<MemoryRelation, "id" | "sourceId" | "targetId">>,
): Promise<boolean> {
  const relationKey = ["memory_relation", relationId];
  const entry = await kv.get<MemoryRelation>(relationKey);

  if (!entry.value) {
    console.log(`⚠️ 无法更新关联，ID不存在: ${relationId}`);
    return false;
  }

  const updatedRelation = {
    ...entry.value,
    ...updates,
  };

  await kv.set(relationKey, updatedRelation);
  console.log(
    `✨ 更新记忆关联: ${relationId}, 新强度: ${
      updatedRelation.strength.toFixed(2)
    }`,
  );
  return true;
}

/**
 * 获取从特定记忆出发的所有关联
 * @param memoryId 记忆ID
 * @returns 关联数组
 */
export async function getRelationsFrom(
  memoryId: string,
): Promise<MemoryRelation[]> {
  const relationsFrom: MemoryRelation[] = [];
  const prefix = ["memory_relations_from", memoryId];

  for await (const entry of kv.list<{ relationId: string }>({ prefix })) {
    const relation = await getMemoryRelation(entry.value.relationId);
    if (relation) {
      relationsFrom.push(relation);
    }
  }

  return relationsFrom;
}

/**
 * 获取指向特定记忆的所有关联
 * @param memoryId 记忆ID
 * @returns 关联数组
 */
export async function getRelationsTo(
  memoryId: string,
): Promise<MemoryRelation[]> {
  const relationsTo: MemoryRelation[] = [];
  const prefix = ["memory_relations_to", memoryId];

  for await (const entry of kv.list<{ relationId: string }>({ prefix })) {
    const relation = await getMemoryRelation(entry.value.relationId);
    if (relation) {
      relationsTo.push(relation);
    }
  }

  return relationsTo;
}

// ================ 记忆激活与关联检索 ================

/**
 * 实现记忆图谱的激活扩散
 * 从一个种子记忆开始，沿着关联链激活相关记忆
 * @param seedMemoryId 初始记忆ID
 * @param depth 激活深度
 * @param minStrength 最小关联强度阈值
 * @returns 激活结果
 */
export async function activateMemoryNetwork(
  seedMemoryId: string,
  depth: number = 2,
  minStrength: number = 0.3,
): Promise<MemoryActivationResult> {
  console.log(`🌟 启动记忆激活流，种子ID: ${seedMemoryId}, 深度: ${depth}`);

  const result: MemoryActivationResult = {
    seedMemoryId,
    activatedMemories: [],
    relations: [],
  };

  const activationQueue: {
    memoryId: string;
    depth: number;
    path: MemoryRelation[];
    strength: number;
  }[] = [{
    memoryId: seedMemoryId,
    depth,
    path: [],
    strength: 1.0, // 初始记忆激活强度为最大
  }];

  const visited = new Set<string>([seedMemoryId]);

  // 广度优先搜索实现激活扩散
  while (activationQueue.length > 0) {
    const { memoryId, depth: currentDepth, path, strength } = activationQueue
      .shift()!;

    // 当前记忆的详细信息（从Qdrant获取）
    // 注意：这里我们需要从Qdrant获取记忆详情
    // 这是简化实现，实际可能需要根据项目结构调整
    const memoryDetails = await getMemoryDetails(memoryId);
    if (memoryDetails) {
      result.activatedMemories.push({
        memoryId,
        payload: memoryDetails,
        activationStrength: strength,
        path,
      });
    }

    // 如果已达到最大深度，不再继续扩散
    if (currentDepth <= 0) continue;

    // 获取从当前记忆出发的所有关联
    const relations = await getRelationsFrom(memoryId);

    // 沿着有效关联继续激活
    for (const relation of relations) {
      // 将关联添加到结果中
      if (!result.relations.some((r) => r.id === relation.id)) {
        result.relations.push(relation);
      }

      // 计算传递到下一节点的激活强度
      const propagatedStrength = strength * relation.strength;

      // 如果强度低于阈值或目标已访问，则不再扩散
      if (propagatedStrength < minStrength || visited.has(relation.targetId)) {
        continue;
      }

      // 标记目标为已访问
      visited.add(relation.targetId);

      // 将目标加入激活队列
      activationQueue.push({
        memoryId: relation.targetId,
        depth: currentDepth - 1,
        path: [...path, relation],
        strength: propagatedStrength,
      });

      // 更新关联的最后激活时间
      await updateMemoryRelation(relation.id, {
        lastActivated: Date.now(),
      });
    }
  }

  console.log(
    `✨ 记忆激活完成，共激活 ${result.activatedMemories.length} 个记忆节点，${result.relations.length} 个关联`,
  );
  return result;
}

/**
 * 获取记忆详情的辅助函数
 * 实际实现需要从Qdrant中检索记忆点详情
 */
async function getMemoryDetails(
  memoryId: string,
): Promise<MemoryPayload | null> {
  try {
    // 使用 retrieve 方法通过 ID 直接获取点
    const retrieveResult = await qdrantClient.retrieve(
      config.qdrantCollectionName, // 直接从 config 获取集合名称
      {
        ids: [memoryId], // 提供要检索的 ID 列表
        with_payload: true, // 确保返回 payload
      },
    );

    // retrieveResult 是一个数组，我们只需要第一个（且应该是唯一一个）结果
    if (retrieveResult && retrieveResult.length > 0) {
      // 类型断言，因为我们知道 payload 应该是 MemoryPayload
      return retrieveResult[0].payload as MemoryPayload;
    }

    console.log(`⚠️ 无法找到记忆详情，ID: ${memoryId}`);
    return null;
  } catch (error) {
    // 检查是否是 "Not found" 错误
    const errorString = String(error);
    if (error?.status === 404 || errorString.includes("Not found")) {
      console.log(`ℹ️ 尝试检索记忆点 ${memoryId} 时未找到。`);
    } else {
      console.error(
        `❌ 获取记忆详情 (retrieve) 时出错 (ID: ${memoryId}):`,
        error,
      );
    }
    return null;
  }
}

// ================ 智能记忆关联生成 ================

/**
 * 分析并生成两个记忆之间可能的关联
 * @param sourceMemory 源记忆
 * @param targetMemory 目标记忆
 * @returns 可能的关联，如果无显著关联则返回null
 */
export async function analyzeMemoryRelation(
  sourceMemory: MemoryPayload,
  targetMemory: MemoryPayload,
): Promise<Omit<MemoryRelation, "id"> | null> {
  console.log(
    `🔍 分析记忆关联: ${sourceMemory.metadata?.id} -> ${targetMemory.metadata?.id}`,
  );

  // 使用LLM分析两个记忆之间的可能关系
  const prompt = `
    请分析以下两条记忆之间可能存在的关系:
    
    记忆1:
    内容: ${sourceMemory.text}
    类型: ${sourceMemory.metadata?.type || "未知"}
    ${
    sourceMemory.metadata?.timestamp
      ? `时间: ${new Date(sourceMemory.metadata.timestamp).toISOString()}`
      : ""
  }
    
    记忆2:
    内容: ${targetMemory.text}
    类型: ${targetMemory.metadata?.type || "未知"}
    ${
    targetMemory.metadata?.timestamp
      ? `时间: ${new Date(targetMemory.metadata.timestamp).toISOString()}`
      : ""
  }
    
    请按以下关系类型进行分析，如果存在明显关联，选择一种最合适的关系类型:
    - 因果关系 (causal): 一个记忆是另一个的原因或结果
    - 时间关系 (temporal): 两个记忆在时间上有先后或同时发生的关系
    - 相似关系 (similarity): 两个记忆在内容、主题或意义上相似
    - 对比关系 (contrast): 两个记忆形成对比或对立
    - 部分整体 (part_whole): 一个记忆是另一个的组成部分
    - 类比关系 (analogy): 两个记忆之间有类比或隐喻关系
    - 主题关系 (thematic): 两个记忆属于同一主题或话题
    - 情感关系 (emotional): 两个记忆引发相似的情感反应
    
    如果存在关系，请提供:
    1. 关系类型 (使用上述类型之一)
    2. 关系描述 (简洁解释这种关系)
    3. 关系强度 (0.0-1.0，其中1.0表示强关联)
    
    如果两个记忆之间没有明显关联，请回答"无显著关联"。
  `;

  try {
    const analysis = await llm.invoke(prompt);
    const analysisText = analysis.content;

    // 如果LLM判断无显著关联，返回null
    if (analysisText.includes("无显著关联")) {
      return null;
    }

    // 分析LLM输出，提取关系类型、描述和强度
    let relationType: RelationType | undefined;
    let description = "";
    let strength = 0.5; // 默认中等强度

    // 提取关系类型
    for (const type of Object.values(RelationType)) {
      if (analysisText.includes(type)) {
        relationType = type as RelationType;
        break;
      }
    }

    // 如果找不到明确的关系类型，默认为相似关系
    if (!relationType) {
      relationType = RelationType.SIMILARITY;
    }

    // 尝试提取关系描述
    const descriptionMatch = analysisText.match(
      /关系描述[：:]\s*(.+?)(?:\n|$)/,
    );
    if (descriptionMatch) {
      description = descriptionMatch[1].trim();
    } else {
      // 如果没有明确的描述格式，使用整个分析作为描述
      description = analysisText.slice(0, 200); // 限制长度
    }

    // 尝试提取关系强度
    const strengthMatch = analysisText.match(/关系强度[：:]\s*(\d+\.\d+|\d+)/);
    if (strengthMatch) {
      const parsedStrength = parseFloat(strengthMatch[1]);
      if (
        !isNaN(parsedStrength) && parsedStrength >= 0 && parsedStrength <= 1
      ) {
        strength = parsedStrength;
      }
    }

    // 构建关系对象
    return {
      sourceId: sourceMemory.metadata?.id as string,
      targetId: targetMemory.metadata?.id as string,
      relationType,
      description,
      strength,
      context: "记忆分析生成的关联",
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error(`❌ 分析记忆关联时出错: ${error}`);
    return null;
  }
}

/**
 * 基于一组记忆生成可能的关联网络
 * @param memories 记忆数组
 * @param maxAssociations 最大生成关联数量
 * @returns 生成的关联ID数组
 */
export async function generateMemoryAssociations(
  memories: MemoryPayload[],
  maxAssociations: number = 5,
): Promise<string[]> {
  console.log(`🧠 开始生成记忆关联网络，记忆数量: ${memories.length}`);

  // 如果记忆数量少于2，无法生成关联
  if (memories.length < 2) {
    console.log("⚠️ 记忆数量不足，无法生成关联");
    return [];
  }

  const generatedRelationIds: string[] = [];
  const potentialPairs: [MemoryPayload, MemoryPayload][] = [];

  // 生成所有可能的记忆对
  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      potentialPairs.push([memories[i], memories[j]]);
    }
  }

  // 随机打乱顺序，避免总是处理相同的组合
  potentialPairs.sort(() => Math.random() - 0.5);

  // 限制处理的对数，避免过多计算
  const pairsToProcess = potentialPairs.slice(0, maxAssociations * 3);

  // 分析并生成关联
  for (const [source, target] of pairsToProcess) {
    if (generatedRelationIds.length >= maxAssociations) break;

    // 确保记忆ID存在
    if (!source.metadata?.id || !target.metadata?.id) continue;

    // 分析可能的关联
    const relation = await analyzeMemoryRelation(source, target);
    if (relation && relation.strength >= 0.4) { // 只保留中等以上强度的关联
      const relationId = await createMemoryRelation(relation);
      generatedRelationIds.push(relationId);

      // 根据关系类型和强度，考虑创建反向关联
      if (
        relation.relationType === RelationType.SIMILARITY ||
        relation.relationType === RelationType.THEMATIC ||
        relation.relationType === RelationType.EMOTIONAL
      ) {
        // 对于这些类型，关系通常是双向的
        const reverseRelation = {
          ...relation,
          sourceId: relation.targetId,
          targetId: relation.sourceId,
          description: `${relation.description} (双向关系)`,
        };
        const reverseId = await createMemoryRelation(reverseRelation);
        generatedRelationIds.push(reverseId);
      }
    }
  }

  console.log(
    `✅ 完成记忆关联生成，创建了 ${generatedRelationIds.length} 个关联`,
  );
  return generatedRelationIds;
}

// ================ 记忆巩固与衰减 ================

/**
 * 创建记忆巩固任务
 * @param task 巩固任务信息
 * @returns 任务ID
 */
export async function createConsolidationTask(
  task: Omit<ConsolidationTask, "id" | "completed">,
): Promise<string> {
  const taskId = crypto.randomUUID();
  const fullTask: ConsolidationTask = {
    id: taskId,
    ...task,
    completed: false,
  };

  const taskKey = ["memory_consolidation_task", taskId];
  await kv.set(taskKey, fullTask);

  // 创建调度索引
  const scheduleKey = [
    "memory_task_schedule",
    task.scheduledTime.toString(),
    taskId,
  ];
  await kv.set(scheduleKey, { taskId });

  console.log(
    `📝 创建记忆巩固任务: ${taskId}, 类型: ${task.type}, 计划时间: ${
      new Date(task.scheduledTime).toLocaleString()
    }`,
  );
  return taskId;
}

/**
 * 获取待处理的记忆巩固任务
 * @param limit 最大任务数量
 * @returns 任务数组
 */
export async function getPendingConsolidationTasks(
  limit: number = 10,
): Promise<ConsolidationTask[]> {
  const now = Date.now();
  const tasks: ConsolidationTask[] = [];

  // 获取所有截止到当前时间的待处理任务
  const prefix = ["memory_task_schedule"];
  const iter = kv.list<{ taskId: string }>({ prefix });

  for await (const entry of iter) {
    // 检查时间戳是否在当前时间之前
    const [_, timestampStr] = entry.key as [string, string, string];
    const timestamp = parseInt(timestampStr);

    if (timestamp <= now) {
      const taskKey = ["memory_consolidation_task", entry.value.taskId];
      const taskEntry = await kv.get<ConsolidationTask>(taskKey);

      if (taskEntry.value && !taskEntry.value.completed) {
        tasks.push(taskEntry.value);

        // 达到限制数量后停止
        if (tasks.length >= limit) break;
      }
    } else {
      // 时间戳已经超过当前时间，可以停止遍历
      break;
    }
  }

  console.log(`🔍 找到 ${tasks.length} 个待处理的记忆巩固任务`);
  return tasks;
}

/**
 * 标记巩固任务为已完成
 * @param taskId 任务ID
 * @returns 是否成功
 */
export async function completeConsolidationTask(
  taskId: string,
): Promise<boolean> {
  const taskKey = ["memory_consolidation_task", taskId];
  const entry = await kv.get<ConsolidationTask>(taskKey);

  if (!entry.value) return false;

  const updatedTask = {
    ...entry.value,
    completed: true,
  };

  await kv.set(taskKey, updatedTask);

  // 删除调度索引以避免重复处理
  const scheduleKey = [
    "memory_task_schedule",
    entry.value.scheduledTime.toString(),
    taskId,
  ];
  await kv.delete(scheduleKey);

  console.log(`✅ 完成记忆巩固任务: ${taskId}`);
  return true;
}

/**
 * 执行记忆衰减过程
 * 随着时间流逝降低记忆关联的强度
 * @param task 衰减任务
 */
export async function performMemoryDecay(
  task: ConsolidationTask,
): Promise<void> {
  console.log(
    `🕰️ 执行记忆衰减任务: ${task.id}, 影响 ${
      task.relationIds?.length || 0
    } 个关联`,
  );

  if (!task.relationIds || task.relationIds.length === 0) {
    await completeConsolidationTask(task.id);
    return;
  }

  const now = Date.now();

  for (const relationId of task.relationIds) {
    const relation = await getMemoryRelation(relationId);
    if (!relation) continue;

    // 计算距离上次激活的时间（天）
    const daysSinceLastActivation =
      (now - (relation.lastActivated || relation.timestamp)) /
      (1000 * 60 * 60 * 24);

    // 应用衰减公式 (指数衰减)
    // 衰减速率基于配置，默认为每30天衰减约30%
    const decayRate = task.metadata?.decayRate || 0.01; // 每天衰减率
    const newStrength = relation.strength *
      Math.exp(-decayRate * daysSinceLastActivation);

    // 更新关联强度
    if (newStrength < 0.1) {
      // 关联太弱，考虑移除
      // 这里我们不直接删除，而是降低到最低阈值
      await updateMemoryRelation(relationId, { strength: 0.1 });
    } else {
      await updateMemoryRelation(relationId, { strength: newStrength });
    }
  }

  await completeConsolidationTask(task.id);
  console.log(`✅ 完成记忆衰减任务: ${task.id}`);
}

/**
 * 执行记忆强化过程
 * 基于情感强度和使用频率增强重要记忆
 * @param task 强化任务
 */
export async function performMemoryStrengthening(
  task: ConsolidationTask,
): Promise<void> {
  console.log(
    `💪 执行记忆强化任务: ${task.id}, 影响 ${
      task.relationIds?.length || 0
    } 个关联`,
  );

  if (!task.relationIds || task.relationIds.length === 0) {
    await completeConsolidationTask(task.id);
    return;
  }

  for (const relationId of task.relationIds) {
    const relation = await getMemoryRelation(relationId);
    if (!relation) continue;

    // 根据元数据中的强化因子增强关联
    const strengtheningFactor = task.metadata?.strengtheningFactor || 1.2;
    const newStrength = Math.min(1.0, relation.strength * strengtheningFactor);

    await updateMemoryRelation(relationId, {
      strength: newStrength,
      lastActivated: Date.now(), // 更新激活时间
    });
  }

  await completeConsolidationTask(task.id);
  console.log(`✅ 完成记忆强化任务: ${task.id}`);
}

/**
 * 创建记忆巩固任务的快捷方法
 * 基于最近记忆自动生成关联并调度巩固
 * @param recentMemories 最近记忆
 */
export async function scheduleConsolidation(
  recentMemories: MemoryPayload[],
): Promise<void> {
  // 首先生成记忆之间的关联
  const relationIds = await generateMemoryAssociations(recentMemories);

  if (relationIds.length === 0) {
    console.log("⚠️ 未生成任何记忆关联，跳过巩固调度");
    return;
  }

  // 创建衰减任务 - 在未来30天左右执行
  const decayTime = Date.now() + 30 * 24 * 60 * 60 * 1000;
  await createConsolidationTask({
    type: ConsolidationTaskType.DECAY,
    memoryIds: recentMemories.map((m) => m.metadata?.id as string).filter(
      Boolean,
    ),
    relationIds,
    metadata: {
      decayRate: 0.01, // 每天约1%的衰减率
    },
    scheduledTime: decayTime,
  });

  // 如果记忆带有强烈情感，创建强化任务
  const emotionalMemories = recentMemories.filter(
    (m) => m.emotional_valence && Math.abs(m.emotional_valence) > 0.7,
  );

  if (emotionalMemories.length > 0) {
    // 在未来1-3天内强化情感记忆
    const strengthenTime = Date.now() +
      (1 + Math.random() * 2) * 24 * 60 * 60 * 1000;
    await createConsolidationTask({
      type: ConsolidationTaskType.STRENGTHEN,
      memoryIds: emotionalMemories.map((m) => m.metadata?.id as string).filter(
        Boolean,
      ),
      relationIds,
      metadata: {
        strengtheningFactor: 1.2,
        reason: "强情感记忆巩固",
      },
      scheduledTime: strengthenTime,
    });
  }

  console.log(`🗓️ 成功调度记忆巩固任务，已创建关联: ${relationIds.length}`);
}

/**
 * 处理所有待执行的记忆巩固任务
 * 可作为定期任务运行
 */
export async function processConsolidationTasks(): Promise<void> {
  console.log("⏱️ 开始处理记忆巩固任务...");

  const tasks = await getPendingConsolidationTasks();
  if (tasks.length === 0) {
    console.log("ℹ️ 没有待处理的巩固任务");
    return;
  }

  for (const task of tasks) {
    try {
      switch (task.type) {
        case ConsolidationTaskType.DECAY:
          await performMemoryDecay(task);
          break;
        case ConsolidationTaskType.STRENGTHEN:
          await performMemoryStrengthening(task);
          break;
        case ConsolidationTaskType.ASSOCIATE:
          // 实现关联任务处理
          break;
        case ConsolidationTaskType.PRUNE:
          // 实现修剪任务处理
          break;
        default:
          console.log(`⚠️ 未知的任务类型: ${task.type}`);
          await completeConsolidationTask(task.id);
      }
    } catch (error) {
      console.error(`❌ 处理任务 ${task.id} 时出错: ${error}`);
    }
  }

  console.log(`✅ 共处理 ${tasks.length} 个记忆巩固任务`);
}

// ================ 记忆网络可视化 ================

/**
 * 生成记忆网络的DOT格式表示（用于Graphviz可视化）
 * @param memories 记忆点数组
 * @param relations 关联数组
 * @returns DOT格式字符串
 */
export function generateNetworkDotRepresentation(
  memories: { id: string; label: string; type: string }[],
  relations: MemoryRelation[],
): string {
  let dot = "digraph MemoryNetwork {\n";
  dot += "  rankdir=LR;\n";
  dot += '  node [shape=box, style=filled, fontname="Arial"];\n';

  // 添加节点
  for (const memory of memories) {
    // 根据记忆类型设置不同颜色
    let color = "lightblue";
    switch (memory.type) {
      case "fact":
        color = "lightgreen";
        break;
      case "conversation_turn":
        color = "lightyellow";
        break;
      case "emotional_response":
        color = "pink";
        break;
      case "reflection":
        color = "lavender";
        break;
    }

    dot +=
      `  "${memory.id}" [label="${memory.label}", fillcolor="${color}"];\n`;
  }

  // 添加关系边
  for (const relation of relations) {
    // 根据关系强度设置边的粗细
    const penwidth = 1 + 2 * relation.strength;

    // 根据关系类型设置边的颜色
    let color = "black";
    switch (relation.relationType) {
      case RelationType.CAUSAL:
        color = "red";
        break;
      case RelationType.TEMPORAL:
        color = "blue";
        break;
      case RelationType.SIMILARITY:
        color = "green";
        break;
      case RelationType.EMOTIONAL:
        color = "purple";
        break;
      case RelationType.THEMATIC:
        color = "orange";
        break;
    }

    dot +=
      `  "${relation.sourceId}" -> "${relation.targetId}" [label="${relation.relationType}", color="${color}", penwidth=${
        penwidth.toFixed(1)
      }];\n`;
  }

  dot += "}\n";
  return dot;
}

// 导出主要功能
export const memoryNetwork = {
  createMemoryRelation,
  getMemoryRelation,
  updateMemoryRelation,
  getRelationsFrom,
  getRelationsTo,
  activateMemoryNetwork,
  analyzeMemoryRelation,
  generateMemoryAssociations,
  createConsolidationTask,
  getPendingConsolidationTasks,
  completeConsolidationTask,
  scheduleConsolidation,
  processConsolidationTasks,
};

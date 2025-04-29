// src/social_dynamics.ts

/**
 * 社交动态模块 - 使爱丽丝能够感知和适应与不同用户的关系
 * * 模拟人类在社交网络中的自我定位与适应能力，实现：
 * 1. 追踪与每个用户的关系状态（亲密度、信任度等）
 * 2. 分析交互历史，识别关系模式与里程碑
 * 3. 根据关系动态调整互动风格和界限感
 * 4. 记忆和利用特定关系的共享信息（如内部笑话）
 */

import { config } from "./config.ts";
import { llm } from "./llm.ts";
import {
  type MemoryPayload,
  // type MemoryPointStruct, // 可能不需要直接操作Point
  // qdrantClient, // 通常不直接操作Qdrant
  type Schemas, // 如果需要Qdrant类型
} from "./qdrant_client.ts";
// import { type ChatMessageInput } from "./memory_processor.ts"; // 如果需要处理消息输入类型

/**
 * 关系维度枚举
 */
export enum RelationshipDimension {
  Familiarity = "familiarity", // 熟悉度 (0-1)
  Trust = "trust", // 信任度 (0-1)
  Warmth = "warmth", // 热情度/亲近感 (0-1)
  Respect = "respect", // 尊重度 (0-1)
  Formality = "formality", // 正式程度 (0-1)
  Playfulness = "playfulness", // 玩乐/幽默程度 (0-1)
  SharedHistory = "shared_history", // 共享历史深度 (交互次数作为代理)
  ConflictLevel = "conflict_level", // 冲突水平 (0-1)
}

/**
 * 与特定用户的关系状态 (存储在 Deno KV 中)
 */
export interface RelationshipState {
  user_id: string; // 用户ID
  dimensions: {
    [key in RelationshipDimension]?: number; // 使用枚举作为键，值为数值
  };
  last_interaction_timestamp: number; // 上次交互时间
  interaction_count: number; // 交互次数
  shared_experiences: string[]; // 共享经历/内部笑话 (描述，限制数量)
  relationship_milestones: string[]; // 关系里程碑 (描述，限制数量)
  current_interaction_style: InteractionStylePreset | string; // 当前互动风格
  boundary_level: number; // 0-1, 个人界限强度
}

/**
 * 预设互动风格枚举
 */
enum InteractionStylePreset {
  Default = "default", // 默认风格 (通常是稍微保留的)
  Professional = "professional", // 专业、正式
  FriendlyCasual = "friendly_casual", // 友好、休闲
  WarmSupportive = "warm_supportive", // 温暖、支持
  PlayfulTeasing = "playful_teasing", // 俏皮、调侃
  ReservedRespectful = "reserved_respectful", // 保留、尊重
  TsundereOwner = "tsundere_owner", // 对主人的特殊傲娇模式
}

/**
 * 关系上下文键前缀 (用于 Deno KV)
 */
const RELATIONSHIP_STATE_PREFIX = "relationship_state";

/**
 * 创建默认的关系状态
 * @param userId 用户ID
 * @returns 初始化的关系状态
 */
function createDefaultRelationshipState(userId: string): RelationshipState {
  // 特别处理主人，赋予不同的初始值
  const isOwner = userId === config.discordOwnerId;

  return {
    user_id: userId,
    dimensions: {
      [RelationshipDimension.Familiarity]: isOwner ? 0.3 : 0.1, // 对主人初始熟悉度稍高
      [RelationshipDimension.Trust]: isOwner ? 0.6 : 0.3, // 对主人初始信任度更高
      [RelationshipDimension.Warmth]: isOwner ? 0.5 : 0.2, // 对主人初始热情度更高
      [RelationshipDimension.Respect]: isOwner ? 0.7 : 0.5, // 对主人初始尊重度更高
      [RelationshipDimension.Formality]: isOwner ? 0.4 : 0.7, // 对主人初始更不正式
      [RelationshipDimension.Playfulness]: isOwner ? 0.4 : 0.1, // 对主人初始更俏皮
      [RelationshipDimension.SharedHistory]: 0, // 共享历史从0开始
      [RelationshipDimension.ConflictLevel]: 0, // 冲突水平从0开始
    },
    last_interaction_timestamp: Date.now(),
    interaction_count: 0,
    shared_experiences: [],
    relationship_milestones: [],
    current_interaction_style: isOwner
      ? InteractionStylePreset.TsundereOwner // 主人的特殊风格
      : InteractionStylePreset.Default, // 其他用户默认风格
    boundary_level: isOwner ? 0.4 : 0.6, // 对主人界限感稍弱
  };
}

/**
 * 获取与用户的关系状态 (从 Deno KV)
 * @param userId 用户ID
 * @param kv Deno KV 存储实例
 * @returns 关系状态对象
 */
export async function getRelationshipState(
  userId: string,
  kv: Deno.Kv | null,
): Promise<RelationshipState> {
  if (!kv) {
    console.warn(
      "[SocialDyn] KV store is not available. Returning default relationship state.",
    );
    return createDefaultRelationshipState(userId);
  }

  const key = [RELATIONSHIP_STATE_PREFIX, userId];

  try {
    const result = await kv.get<RelationshipState>(key);

    if (!result.value) {
      // 没有存储状态，创建默认状态并存储
      const defaultState = createDefaultRelationshipState(userId);
      // 异步存储，不阻塞返回
      kv.set(key, defaultState).catch((err) =>
        console.error(
          `❌ [SocialDyn] Failed to save default relationship state for ${userId}:`,
          err,
        )
      );
      return defaultState;
    }

    // 校验并补充可能缺失的维度
    const defaultDims = createDefaultRelationshipState(userId).dimensions;
    result.value.dimensions = { ...defaultDims, ...result.value.dimensions };

    // 校验其他字段是否存在，补充默认值
    result.value.shared_experiences = result.value.shared_experiences || [];
    result.value.relationship_milestones =
      result.value.relationship_milestones || [];
    result.value.current_interaction_style =
      result.value.current_interaction_style || InteractionStylePreset.Default;
    result.value.boundary_level = result.value.boundary_level ??
      (userId === config.discordOwnerId ? 0.4 : 0.6);
    result.value.interaction_count = result.value.interaction_count || 0;
    result.value.last_interaction_timestamp =
      result.value.last_interaction_timestamp || Date.now();

    return result.value;
  } catch (error) {
    console.error(
      `❌ [SocialDyn] 获取关系状态时出错 (User: ${userId}):`,
      error,
    );
    return createDefaultRelationshipState(userId); // 出错时返回默认状态
  }
}

/**
 * 更新与用户的关系状态 (存储到 Deno KV)
 * @param userId 用户ID
 * @param updates 部分状态更新
 * @param kv Deno KV 存储实例
 */
export async function updateRelationshipState(
  userId: string,
  updates: Partial<RelationshipState>,
  kv: Deno.Kv | null,
): Promise<void> {
  if (!kv) {
    console.warn(
      "[SocialDyn] KV store is not available. Cannot update relationship state.",
    );
    return;
  }
  if (!userId) {
    console.error(
      "❌ [SocialDyn] Invalid userId provided for updateRelationshipState.",
    );
    return;
  }

  const key = [RELATIONSHIP_STATE_PREFIX, userId];

  try {
    // 获取当前状态，确保基于最新状态更新
    const currentState = await getRelationshipState(userId, kv);

    // 合并状态更新
    const newState: RelationshipState = {
      ...currentState,
      ...updates,
      // 深度合并维度更新
      dimensions: {
        ...currentState.dimensions,
        ...(updates.dimensions || {}),
      },
      // 确保数组正确合并或替换 (如果 updates 中提供了)
      shared_experiences: updates.shared_experiences ||
        currentState.shared_experiences,
      relationship_milestones: updates.relationship_milestones ||
        currentState.relationship_milestones,
    };

    // 确保核心字段不被意外覆盖
    newState.user_id = currentState.user_id;

    // 限制数组长度
    if (
      newState.shared_experiences.length >
        config.socialDynamics.maxSharedExperiences
    ) {
      newState.shared_experiences = newState.shared_experiences.slice(
        -config.socialDynamics.maxSharedExperiences,
      );
    }
    if (
      newState.relationship_milestones.length >
        config.socialDynamics.maxMilestones
    ) {
      newState.relationship_milestones = newState.relationship_milestones.slice(
        -config.socialDynamics.maxMilestones,
      );
    }

    // 验证并清理 newState，移除 undefined 值
    const cleanedState = JSON.parse(JSON.stringify(newState));

    // 保存更新后的状态
    await kv.set(key, cleanedState);
  } catch (error) {
    console.error(
      `❌ [SocialDyn] 更新关系状态时出错 (User: ${userId}):`,
      error,
    );
  }
}

/**
 * 分析单次交互对关系的影响
 * @param userId 用户ID
 * @param message 消息内容和时间戳
 * @param emotionalState 消息情感状态
 * @param contextId 上下文ID (用于分析情境)
 * @param kv Deno KV 存储实例
 * @returns 更新后的关系状态
 */
export async function analyzeInteractionImpact(
  userId: string,
  message: { text: string; timestamp: number },
  emotionalState: {
    valence: number;
    arousal: number;
    dominant_emotion?: string;
  },
  contextId: string, // 提供上下文ID以供分析
  kv: Deno.Kv | null,
): Promise<RelationshipState> {
  // 获取当前关系状态，如果获取失败则使用默认状态启动分析
  const currentState = await getRelationshipState(userId, kv) ||
    createDefaultRelationshipState(userId);

  // --- LLM 分析交互内容对关系维度的影响 ---
  let dimensionChanges: Partial<RelationshipState["dimensions"]> = {};
  let newSharedExperience: string | null = null;
  let newMilestone: string | null = null;

  // 判断是否启用LLM分析
  if (config.socialDynamics.enableLLMRelationshipAnalysis) {
    try {
      // 构建更丰富的上下文信息给LLM
      const currentDims = currentState.dimensions;
      const relationshipContextDesc = `熟悉度=${
        currentDims.familiarity?.toFixed(1)
      }, 信任度=${currentDims.trust?.toFixed(1)}, 热情度=${
        currentDims.warmth?.toFixed(1)
      }, 正式程度=${currentDims.formality?.toFixed(1)}, 玩乐度=${
        currentDims.playfulness?.toFixed(1)
      }, 冲突=${currentDims.conflict_level?.toFixed(1)}`;

      const analysisPrompt = `
请分析以下用户交互（消息和情感）对AI（爱丽丝）与该用户的关系可能产生的影响。
爱丽丝当前与该用户的关系状态概要：${relationshipContextDesc}
当前对话上下文ID：${contextId} (提示：包含 'work_' 通常表示工作场景，'casual_' 表示休闲场景)

用户消息: "${message.text}"
用户情感: 效价=${emotionalState.valence.toFixed(2)}, 强度=${
        emotionalState.arousal.toFixed(2)
      }, 主要情绪=${emotionalState.dominant_emotion || "中性"}

评估这次交互在以下关系维度上的潜在变化量（范围-0.1到+0.1，0表示无变化）：
- Familiarity: 是否增进了解？（例如：分享个人信息+0.05，闲聊+0.02）
- Trust: 是否建立或破坏信任？（例如：履行承诺+0.07，抱怨/指责-0.05）
- Warmth: 是否拉近距离或疏远？（例如：表达关心+0.06，冷漠回应-0.04）
- Respect: 是否体现或损害尊重？（例如：礼貌请求+0.03，粗鲁言语-0.08）
- Formality: 交互是偏正式还是非正式？（例如：工作讨论+0.05，开玩笑-0.06，负数表示更非正式）
- Playfulness: 是否包含玩笑或轻松氛围？（例如：幽默互动+0.07，严肃批评-0.03）
- ConflictLevel: 是否存在冲突、分歧或紧张？（例如：争论+0.1，理解和解-0.05）

另外，判断是否产生了：
- SharedExperience: 值得记忆的共同体验或内部笑话（如有，请提供**极其简短**的描述，10字以内）
- Milestone: 对关系有重大意义的事件（如首次深入交流、解决重大分歧等）（如有，请提供**极其简短**的描述，10字以内）

请使用JSON格式回复，仅包含有变化的维度和事件描述。
示例：
{
  "dimension_changes": { "familiarity": 0.02, "warmth": 0.03, "formality": -0.04, "playfulness": 0.05 },
  "shared_experience": "讨论喜欢的电影",
  "milestone": null
}
或（无显著变化）：
{}
`;

      // 调用LLM分析
      const response = await llm.invoke(analysisPrompt);
      const responseText = typeof response === "string"
        ? response
        : (response.content as string);

      try {
        const analysisResult = JSON.parse(
          responseText.trim().replace(/```json|```/g, ""),
        );
        dimensionChanges = analysisResult.dimension_changes || {};
        newSharedExperience = analysisResult.shared_experience || null;
        newMilestone = analysisResult.milestone || null;

        console.log(`   [SocialDyn] LLM关系影响分析:`, dimensionChanges);
        if (newSharedExperience) {
          console.log(`   [SocialDyn] 新增共享经历: ${newSharedExperience}`);
        }
        if (newMilestone) {
          console.log(`   [SocialDyn] 新增关系里程碑: ${newMilestone}`);
        }
      } catch (parseError) {
        console.error(
          `❌ [SocialDyn] 解析LLM关系影响分析结果时出错:`,
          parseError,
          `响应: ${responseText}`,
        );
        // 解析失败，dimensionChanges 保持为空对象
      }
    } catch (llmError) {
      console.error(`❌ [SocialDyn] 调用LLM进行关系影响分析时出错:`, llmError);
      // LLM调用失败，dimensionChanges 保持为空对象
    }
  } else {
    console.log(`   [SocialDyn] 跳过LLM关系影响分析 (已禁用)`);
  }

  // --- 基于规则和情感更新维度 ---
  const newDimensions = { ...(currentState.dimensions) }; // 创建副本进行修改
  const sensitivity = config.socialDynamics.relationshipSensitivity || 0.7; // 获取敏感度配置

  // 基础变化：每次交互都略微增加熟悉度和共享历史
  newDimensions.familiarity = (newDimensions.familiarity || 0) +
    0.01 * sensitivity;
  newDimensions.shared_history = (currentState.interaction_count || 0) + 1; // 使用 interaction_count 作为代理

  // 情感影响
  if (emotionalState.valence > 0.5) { // 强积极情感
    newDimensions.trust = (newDimensions.trust || 0) + 0.03 * sensitivity;
    newDimensions.warmth = (newDimensions.warmth || 0) + 0.04 * sensitivity;
    newDimensions.conflict_level = (newDimensions.conflict_level || 0) -
      0.02 * sensitivity; // 积极互动减少冲突感
  } else if (emotionalState.valence < -0.5) { // 强负面情感
    newDimensions.trust = (newDimensions.trust || 0) - 0.04 * sensitivity;
    newDimensions.warmth = (newDimensions.warmth || 0) - 0.03 * sensitivity;
    newDimensions.conflict_level = (newDimensions.conflict_level || 0) +
      0.06 * sensitivity; // 负面互动增加冲突感
  }

  // 交互频率影响熟悉度：如果距离上次交互时间很短，增加熟悉度
  const timeSinceLastInteraction = Date.now() -
    currentState.last_interaction_timestamp;
  if (timeSinceLastInteraction < 10 * 60 * 1000) { // 10分钟内再次交互
    newDimensions.familiarity = (newDimensions.familiarity || 0) +
      0.015 * sensitivity;
  }

  // 应用LLM分析的变化量 (如果启用且有结果)
  for (const key in dimensionChanges) {
    const dim = key as RelationshipDimension;
    if (newDimensions[dim] !== undefined) {
      // 使用 += 运算符，确保初始值为0
      newDimensions[dim] = (newDimensions[dim] || 0) +
        (dimensionChanges[dim] || 0);
    }
  }

  // 确保所有维度值在0-1之间 (除了 shared_history)
  for (const key in newDimensions) {
    const dim = key as RelationshipDimension;
    if (dim !== RelationshipDimension.SharedHistory) {
      newDimensions[dim] = Math.max(0, Math.min(1, newDimensions[dim] || 0));
    }
  }

  // 更新共享经历和里程碑列表
  const updatedSharedExperiences = [...currentState.shared_experiences];
  if (
    newSharedExperience &&
    !updatedSharedExperiences.includes(newSharedExperience)
  ) { // 避免重复添加
    updatedSharedExperiences.push(newSharedExperience.substring(0, 50)); // 限制长度
    if (
      updatedSharedExperiences.length >
        config.socialDynamics.maxSharedExperiences
    ) {
      updatedSharedExperiences.shift(); // 移除最旧的
    }
  }

  const updatedMilestones = [...currentState.relationship_milestones];
  if (newMilestone && !updatedMilestones.includes(newMilestone)) { // 避免重复添加
    updatedMilestones.push(newMilestone.substring(0, 50)); // 限制长度
    if (updatedMilestones.length > config.socialDynamics.maxMilestones) {
      updatedMilestones.shift(); // 移除最旧的
    }
  }

  // 根据更新后的维度确定新的互动风格
  const newInteractionStyle = determineInteractionStyle(newDimensions, userId);

  // 根据更新后的维度计算新的界限水平
  const newBoundaryLevel = calculateBoundaryLevel(newDimensions);

  // 构建最终的更新对象
  const updates: Partial<RelationshipState> = {
    dimensions: newDimensions,
    last_interaction_timestamp: message.timestamp,
    interaction_count: currentState.interaction_count + 1,
    shared_experiences: updatedSharedExperiences,
    relationship_milestones: updatedMilestones,
    current_interaction_style: newInteractionStyle,
    boundary_level: newBoundaryLevel,
  };

  // 更新KV存储中的状态
  if (kv) {
    await updateRelationshipState(userId, updates, kv);
  } else {
    console.warn(
      "[SocialDyn] KV not available, relationship state update skipped.",
    );
  }

  // 返回更新后的完整状态
  // 注意：这里currentState是旧状态，updates是变化量，newDimensions是更新后的维度
  // 需要返回一个合并了currentState和updates的新对象
  return {
    ...currentState, // 保留 user_id 等不变的字段
    ...updates, // 应用所有更新
  };
}

/**
 * 根据关系维度确定互动风格
 * @param dimensions 关系维度
 * @param userId 用户ID
 * @returns 互动风格枚举值或字符串
 */
function determineInteractionStyle(
  dimensions: RelationshipState["dimensions"],
  userId: string,
): InteractionStylePreset | string { // 返回枚举或字符串
  // 1. 优先处理主人
  if (userId === config.discordOwnerId) {
    return InteractionStylePreset.TsundereOwner;
  }

  // 2. 获取维度值，提供默认值0
  const familiarity = dimensions.familiarity || 0;
  const trust = dimensions.trust || 0;
  const warmth = dimensions.warmth || 0;
  const formality = dimensions.formality || 0;
  const playfulness = dimensions.playfulness || 0;
  const conflictLevel = dimensions.conflict_level || 0;

  // 3. 根据规则判断风格
  if (conflictLevel > 0.6) {
    return InteractionStylePreset.ReservedRespectful; // 高冲突 -> 保留尊重
  }

  if (formality > 0.7 && trust > 0.4) { // 高正式度且有一定信任 -> 专业
    return InteractionStylePreset.Professional;
  }

  if (warmth > 0.7 && trust > 0.6 && familiarity > 0.5) { // 高热情+高信任+中高熟悉 -> 温暖支持
    return InteractionStylePreset.WarmSupportive;
  }

  if (playfulness > 0.6 && familiarity > 0.5 && trust > 0.5) { // 高玩乐+中高熟悉+中高信任 -> 俏皮调侃
    return InteractionStylePreset.PlayfulTeasing;
  }

  if (familiarity > 0.4 && warmth > 0.4) { // 中等熟悉+中等热情 -> 友好休闲
    return InteractionStylePreset.FriendlyCasual;
  }

  if (familiarity < 0.2 || trust < 0.3) { // 低熟悉或低信任 -> 保留尊重
    return InteractionStylePreset.ReservedRespectful;
  }

  // 4. 默认风格
  return InteractionStylePreset.Default;
}

/**
 * 根据关系维度计算个人界限强度 (0=最弱, 1=最强)
 * @param dimensions 关系维度
 * @returns 界限强度 (0-1)
 */
function calculateBoundaryLevel(
  dimensions: RelationshipState["dimensions"],
): number {
  // 低信任、低熟悉、高冲突、高正式度 => 界限更强 (值更高)
  const trustFactor = 1 - (dimensions.trust || 0); // 低信任 -> 强界限
  const familiarityFactor = 1 - (dimensions.familiarity || 0); // 低熟悉 -> 强界限
  const conflictFactor = dimensions.conflict_level || 0; // 高冲突 -> 强界限
  const formalityFactor = dimensions.formality || 0; // 高正式 -> 强界限

  // 加权计算基础界限值
  const baseBoundary = trustFactor * 0.35 +
    familiarityFactor * 0.25 +
    conflictFactor * 0.25 +
    formalityFactor * 0.15;

  // 将基础值映射到更合理的范围 [0.2, 0.8]，并进行平滑处理
  const boundary = 0.2 + baseBoundary * 0.6;

  return Math.max(0.2, Math.min(0.8, boundary)); // 最终限制在0.2到0.8之间
}

/**
 * 获取关系状态的摘要，用于Prompt
 * @param state 关系状态
 * @returns 关系摘要字符串
 */
export function getRelationshipSummary(
  state: RelationshipState | null,
): string {
  if (!state) return "关系状态未知";

  const isOwner = state.user_id === config.discordOwnerId;
  const name = isOwner ? "主人" : `用户 ${state.user_id.substring(0, 6)}...`; // 保护用户ID

  let summary = `与${name}的关系: `;

  const dimDescriptions = [];
  // 选择性地描述关键维度
  dimDescriptions.push(
    `熟悉度(${getDescriptor(state.dimensions.familiarity)})`,
  );
  dimDescriptions.push(`信任度(${getDescriptor(state.dimensions.trust)})`);
  dimDescriptions.push(`亲近感(${getDescriptor(state.dimensions.warmth)})`);
  // dimDescriptions.push(`正式(${getDescriptor(state.dimensions.formality, true)})`);
  dimDescriptions.push(`风格(${state.current_interaction_style})`);

  if ((state.dimensions.conflict_level || 0) > 0.4) {
    dimDescriptions.push(
      `冲突(${getDescriptor(state.dimensions.conflict_level)})`,
    );
  }

  summary += dimDescriptions.join(", ");

  // 根据配置的详细程度添加更多信息
  if (
    config.socialDynamics.promptDetailLevel === "medium" ||
    config.socialDynamics.promptDetailLevel === "high"
  ) {
    if (state.shared_experiences.length > 0) {
      summary += ` | 最近共享: "${state.shared_experiences.slice(-1)[0]}"`;
    }
  }
  if (config.socialDynamics.promptDetailLevel === "high") {
    if (state.relationship_milestones.length > 0) {
      summary += ` | 里程碑: "${state.relationship_milestones.slice(-1)[0]}"`;
    }
    summary += ` | 界限: ${state.boundary_level.toFixed(2)}`;
  }

  return summary;
}

/**
 * 将维度分数转换为描述词 (0-1)
 * @param score 分数
 * @param reverse 如果为true，分数越高表示程度越低（例如Formality）
 * @returns 描述词
 */
function getDescriptor(
  score: number | undefined,
  reverse: boolean = false,
): string {
  score = score ?? 0.5; // 如果未定义，默认为中等
  let level = score;
  if (reverse) {
    level = 1 - score; // 反转分数用于描述（如低formality是"低"）
  }

  if (level > 0.8) return "非常高";
  if (level > 0.6) return "较高";
  if (level > 0.4) return "中等";
  if (level > 0.2) return "较低";
  return "非常低";
}

// 导出关键类型和函数
export { InteractionStylePreset, RelationshipState };

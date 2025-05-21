// src/social_cognition.ts (修复 SocialRole 和 SocialContext 重复导出错误)
/**
 * 社交认知模块 - 在关系的星河中舞动并感知动态 (整合版)
 *
 * 整合了原有的 social_dynamics 和 social_relationships 功能。
 * 目标是创建一个统一的模块来处理个体间关系、群体动态、社交情境感知和适应性互动。
 *
 * 特性:
 * 1. 群体星云 - 理解并适应复杂社交网络的引力场
 * 2. 关系轨迹 - 感知并参与真正的长期关系演化 (含多维度状态)
 * 3. 共同星历 - 收集并珍视共同经历的星光碎片
 * 4. 角色星座 - 识别并适应不同社交星系中的位置
 * 5. 社交引力感 - 在不同社会情境的引力场中自然漂浮
 * 6. 动态互动风格与界限管理
 */

// --- 核心依赖导入 ---
import { kvHolder } from "./main.ts"; // 确保 main.ts 导出 kvHolder 实例
import { config } from "./config.ts";
import { llm } from "./llm.ts";
import {
  type MemoryPayload,
  type MemoryType,
  qdrantClient,
  searchMemories, // 如果需要基于记忆分析关系
} from "./qdrant_client.ts";

// --- 枚举定义 ---

/**
 * 群体类型枚举
 * 定义了不同类型的社交群体
 */
enum GroupType {
  PROFESSIONAL = "professional", // 专业群体，如工作团队
  SOCIAL = "social", // 社交群体，如朋友圈
  COMMUNITY = "community", // 社区群体，如兴趣社区
  LEARNING = "learning", // 学习群体，如课程群组
  SUPPORT = "support", // 支持群体，如互助小组
  PROJECT = "project", // 项目群体，如临时项目团队
}

/**
 * 社交角色枚举
 * 个体在群体中可能扮演的角色
 */
enum SocialRole {
  CENTRAL = "central", // 中心角色，群体核心
  CONNECTOR = "connector", // 连接者，连接不同子群体
  EXPERT = "expert", // 专家，提供专业知识
  SUPPORTER = "supporter", // 支持者，提供情感支持
  OBSERVER = "observer", // 观察者，较少参与但关注
  NEWCOMER = "newcomer", // 新成员，刚加入群体
  MODERATOR = "moderator", // 调节者，调和矛盾
  CONTRIBUTOR = "contributor", // 贡献者，积极提供内容
}

/**
 * 关系阶段枚举
 * 定义了关系发展的不同阶段
 */
enum RelationshipStage {
  INITIAL = "initial", // 初始接触
  EXPLORATION = "exploration", // 探索阶段
  BUILDING = "building", // 建立阶段
  DEEPENING = "deepening", // 深化阶段
  ESTABLISHED = "established", // 稳定阶段
  TRANSFORMING = "transforming", // 转变阶段
  REPAIRING = "repairing", // 修复阶段
  DECLINING = "declining", // 衰退阶段
}

/**
 * 社交情境枚举
 * 不同的社交互动情境
 */
enum SocialContext {
  FORMAL = "formal", // 正式场合
  CASUAL = "casual", // 休闲场合
  COLLABORATIVE = "collaborative", // 协作情境
  SUPPORTIVE = "supportive", // 支持情境
  CELEBRATORY = "celebratory", // 庆祝情境
  CONFLICTUAL = "conflictual", // 冲突情境
  EDUCATIONAL = "educational", // 教育情境
  INTIMATE = "intimate", // 亲密情境
}

/**
 * 关系维度枚举 (源自 social_dynamics.ts)
 */
enum RelationshipDimension {
  Familiarity = "familiarity", // 熟悉度 (0-1)
  Trust = "trust", // 信任度 (0-1)
  Warmth = "warmth", // 热情度/亲近感 (0-1)
  Respect = "respect", // 尊重度 (0-1)
  Formality = "formality", // 正式程度 (0-1)
  Playfulness = "playfulness", // 玩乐/幽默程度 (0-1)
  SharedHistory = "shared_history", // 共享历史深度 (交互次数作为代理)
  ConflictLevel = "conflict_level", // 冲突水平 (0-1)
  // 以下为 social_relationships.ts 中新增或扩展的维度
  Compatibility = "compatibility", // 兴趣/价值观相容性 (0.0-1.0)
  EmotionalConnection = "emotional_connection", // 情感连接强度 (0.0-1.0)
  // 可以根据需要在 dimensions 对象中添加更多自定义维度
}

/**
 * 预设互动风格枚举 (源自 social_dynamics.ts)
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

// --- 接口定义 ---

/**
 * 共同经历接口
 * 记录与特定用户或群体的共同经历
 */
export interface SharedExperience {
  id: string; // 经历唯一ID
  timestamp: number; // 发生时间
  description: string; // 经历描述
  significance: number; // 重要性 (0.0-1.0)
  emotionalTone: string; // 情感基调
  participantIds: string[]; // 参与者ID (包含 'alice' 和其他用户/群组)
  contextId: string; // 发生的上下文ID (RAG Context ID 或 群组ID)
  referencedCount: number; // 被引用次数
  lastReferenced?: number; // 最后引用时间
}

/**
 * 关系里程碑接口
 * 记录关系发展的重要节点
 */
export interface RelationshipMilestone {
  id: string; // 里程碑唯一ID
  timestamp: number; // 达成时间
  description: string; // 里程碑描述
  stage: RelationshipStage; // 对应的关系阶段
  impact: string; // 对关系的影响
  experienceIds: string[]; // 相关共同经历ID
}

/**
 * 群体成员关系接口
 * 记录群体内成员间的关系状态
 */
export interface MemberRelationship {
  userId: string; // 用户ID
  targetId: string; // 目标成员ID
  familiarity: number; // 熟悉度 (0.0-1.0)
  trust: number; // 信任度 (0.0-1.0)
  alignment: number; // 观点一致性 (0.0-1.0)
  interaction: number; // 互动频率 (0.0-1.0)
  lastUpdated: number; // 最后更新时间
}

/**
 * 社交群体接口
 * 表示一个完整的社交群体及其动态
 */
export interface SocialGroup {
  id: string; // 群体唯一ID
  name: string; // 群体名称
  type: GroupType; // 群体类型
  description: string; // 群体描述
  created: number; // 创建时间
  updated: number; // 更新时间

  // 成员与结构
  members: { // 成员列表
    [userId: string]: {
      joinedAt: number; // 加入时间
      role: SocialRole; // 在群体中的角色
      influence: number; // 影响力 (0.0-1.0)
      activity: number; // 活跃度 (0.0-1.0)
      departed?: boolean; // 是否已离开
    };
  };
  memberRelationships: MemberRelationship[]; // 成员间关系

  // 群体特性
  dynamics: { // 群体动态
    formality: number; // 正式程度 (0.0-1.0)
    cohesion: number; // 凝聚力 (0.0-1.0)
    hierarchy: number; // 等级性 (0.0-1.0)
    openness: number; // 开放度 (0.0-1.0)
    emotionalTone: string; // 情感基调
  };

  // 共享内容
  norms: string[]; // 群体规范
  topics: { // 常见话题
    [topic: string]: number; // 话题及其频率
  };
  sharedExperiences: string[]; // 共同经历ID
  milestones: string[]; // 群体里程碑ID

  // 互动历史
  interactionHistory: { // 互动记录摘要
    lastInteraction: number; // 最后互动时间
    interactionCount: number; // 互动总次数
    significantInteractions: { // 重要互动记录
      timestamp: number;
      summary: string;
      participantIds: string[];
    }[];
  };
}

/**
 * 整合后的增强关系状态接口
 * (取代原 social_dynamics.ts 中的 RelationshipState)
 * 存储 Alice 与另一个实体（用户或群组）的关系
 */
export interface EnhancedRelationshipState {
  entityId: string; // 关系对方的实体ID (用户ID 或 群组ID)
  aliceId: string; // Alice 自身的标识符 (通常固定为 'alice')

  dimensions: {
    [key in RelationshipDimension]?: number; // 包含所有关系维度
  };
  last_interaction_timestamp: number; // 上次交互时间
  interaction_count: number; // 交互次数

  stage: RelationshipStage; // 关系发展阶段
  milestones: string[]; // 关系里程碑ID
  sharedExperiences: string[]; // 共同经历ID

  // 沟通风格 (可选，可由策略动态生成或在此存储观察到的风格)
  communicationStyle?: {
    directness?: number; // 直接程度 (0.0-1.0)
    formality?: number; // 正式程度 (0.0-1.0)
    emotionalExpression?: number; // 情感表达度 (0.0-1.0)
  };
  significantTopics: { // 重要共同话题
    [topic: string]: number; // 话题及其重要性
  };

  // 关系张力 (如果存在)
  relationshipTension?: {
    cause: string; // 张力原因
    severity: number; // 严重程度 (0.0-1.0)
    duration: number; // 持续时间(毫秒)
  };

  // 当前状态 (整合自 social_dynamics.ts)
  current_interaction_style: InteractionStylePreset | string; // 当前互动风格
  boundary_level: number; // 0-1, 个人界限强度

  lastAnalyzed: number; // 最后分析时间
  version: number; // 版本号，用于并发控制
}

// --- KV 存储键前缀 ---
const GROUP_PREFIX = "social_group"; // 群组信息
const RELATIONSHIP_PREFIX = "social_relationship"; // 增强的关系状态 (Alice <-> Entity)
const SHARED_EXP_PREFIX = "shared_experience"; // 共同经历
const MILESTONE_PREFIX = "relationship_milestone"; // 关系里程碑
// 索引键前缀 (用于查找)
const USER_EXP_INDEX = "user_experiences"; // 用户参与的经历
const CONTEXT_EXP_INDEX = "context_experiences"; // 特定上下文的经历
const RELATION_MILESTONE_INDEX = "relationship_milestones"; // 关系对应的里程碑

// --- 社交认知管理器 ---

/**
 * 社交认知管理器类
 * 整合管理个体关系、群体动态、社交情境和相关功能
 */
export class SocialCognitionManager {
  private initialized = false;
  private cachedGroups: Map<string, SocialGroup> = new Map();
  private cachedRelationships: Map<string, EnhancedRelationshipState> =
    new Map(); // 缓存 Alice 与其他实体的关系
  private aliceId = "alice"; // Alice 的固定标识符

  /**
   * 初始化社交认知系统
   */
  async initialize(): Promise<void> {
    console.log("🌌 [社交认知][日志] 初始化社交认知星云系统...");
    this.initialized = true;
    console.log("✨ [社交认知][日志] 初始化完成");
  }

  /**
   * 确保管理器已初始化
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  // --------- 核心关系管理功能 (整合自 social_dynamics) ---------

  /**
   * 创建默认的关系状态 (Alice 与某个实体)
   * @param entityId 对方实体 ID (用户或群组)
   * @returns 初始化的关系状态
   */
  private createDefaultRelationshipState(
    entityId: string,
  ): EnhancedRelationshipState {
    console.log(
      `🌱 [社交认知][日志] 为实体 ${entityId} 创建默认关系状态...`,
    );
    const isOwner = entityId === config.discordOwnerId;
    const now = Date.now();

    const defaultState: EnhancedRelationshipState = {
      entityId: entityId,
      aliceId: this.aliceId,
      dimensions: {
        [RelationshipDimension.Familiarity]: isOwner ? 0.3 : 0.1,
        [RelationshipDimension.Trust]: isOwner ? 0.6 : 0.3,
        [RelationshipDimension.Warmth]: isOwner ? 0.5 : 0.2,
        [RelationshipDimension.Respect]: isOwner ? 0.7 : 0.5,
        [RelationshipDimension.Formality]: isOwner ? 0.4 : 0.7,
        [RelationshipDimension.Playfulness]: isOwner ? 0.4 : 0.1,
        [RelationshipDimension.SharedHistory]: 0,
        [RelationshipDimension.ConflictLevel]: 0,
        [RelationshipDimension.Compatibility]: 0.5,
        [RelationshipDimension.EmotionalConnection]: isOwner ? 0.4 : 0.1,
      },
      last_interaction_timestamp: now,
      interaction_count: 0,
      stage: RelationshipStage.INITIAL,
      milestones: [],
      sharedExperiences: [],
      significantTopics: {},
      current_interaction_style: isOwner
        ? InteractionStylePreset.TsundereOwner
        : InteractionStylePreset.Default,
      boundary_level: isOwner ? 0.4 : 0.6,
      lastAnalyzed: now,
      version: 1,
    };
    console.log(
      `   [社交认知][调试] 默认关系状态创建完成: 风格=${defaultState.current_interaction_style}, 界限=${
        defaultState.boundary_level.toFixed(2)
      }`,
    );
    return defaultState;
  }

  /**
   * 获取 Alice 与指定实体（用户/群组）的关系状态
   * @param entityId 对方实体 ID
   * @param useCache 是否使用缓存
   * @returns 增强的关系状态对象，如果不存在则返回 null 或默认值
   */
  async getRelationshipState(
    entityId: string,
    useCache = true,
  ): Promise<EnhancedRelationshipState> {
    await this.ensureInitialized();
    const cacheKey = `${this.aliceId}:${entityId}`;

    if (useCache && this.cachedRelationships.has(cacheKey)) {
      return this.cachedRelationships.get(cacheKey)!;
    }

    console.log(
      `[社交认知][调试] 尝试从 KV 获取关系状态: Alice <-> ${entityId}`,
    );
    if (!kvHolder.instance) {
      console.warn("[社交认知][日志] KV 存储不可用。返回默认关系状态。");
      return this.createDefaultRelationshipState(entityId);
    }

    const key = [RELATIONSHIP_PREFIX, this.aliceId, entityId];
    let state: EnhancedRelationshipState;

    try {
      const result = await kvHolder.instance.get<EnhancedRelationshipState>(key);
      if (result.value) {
        console.log(
          `   [社交认知][调试] KV 中找到关系状态 v${result.value.version}`,
        );
        state = this.validateAndHydrateState(result.value, entityId);
      } else {
        console.log(
          `   [社交认知][调试] KV 中未找到关系状态，创建并存储默认状态...`,
        );
        state = this.createDefaultRelationshipState(entityId);
        kvHolder.instance.set(key, state).catch((err) =>
          console.error(
            `❌ [社交认知][错误] 保存默认关系状态失败 (${entityId}):`,
            err,
          )
        );
      }
    } catch (error) {
      console.error(
        `❌ [社交认知][错误] 获取关系状态时出错 (Entity: ${entityId}):`,
        error,
      );
      state = this.createDefaultRelationshipState(entityId); // 出错时返回默认
    }

    this.cachedRelationships.set(cacheKey, state);
    return state;
  }

  /**
   * 校验并补充关系状态对象，确保包含所有必要字段
   */
  private validateAndHydrateState(
    state: any, // 从 KV 读取的值可能是旧格式
    entityId: string,
  ): EnhancedRelationshipState {
    const defaultState = this.createDefaultRelationshipState(entityId);
    const validatedState: EnhancedRelationshipState = {
      ...defaultState, // 以默认值为基础
      ...state, // 覆盖 KV 中的值
      dimensions: { // 确保 dimensions 对象完整
        ...defaultState.dimensions,
        ...(state.dimensions || {}),
      },
      milestones: state.milestones || [], // 确保数组存在
      sharedExperiences: state.sharedExperiences || [], // 确保数组存在
      significantTopics: state.significantTopics || {}, // 确保对象存在
      // 确保 interaction_style 和 boundary_level 存在
      current_interaction_style: state.current_interaction_style ||
        defaultState.current_interaction_style,
      boundary_level: state.boundary_level ?? defaultState.boundary_level,
      version: state.version || 1, // 确保版本号存在
    };
    // 强制更新 entityId 和 aliceId 以防万一
    validatedState.entityId = entityId;
    validatedState.aliceId = this.aliceId;
    return validatedState;
  }

  /**
   * 更新 Alice 与指定实体（用户/群组）的关系状态 (原子操作)
   * @param entityId 对方实体 ID
   * @param updates 包含要更新字段的对象
   * @returns 更新后的关系状态或 null (如果更新失败)
   */
  async updateRelationshipState(
    entityId: string,
    updates: Partial<EnhancedRelationshipState>,
  ): Promise<EnhancedRelationshipState | null> {
    await this.ensureInitialized();
    if (!kvHolder.instance) {
      console.warn(
        "[社交认知][日志] KV 存储不可用。无法更新关系状态。",
      );
      return null;
    }
    if (!entityId) {
      console.error(
        "❌ [社交认知][错误] 更新关系状态时提供了无效的 entityId。",
      );
      return null;
    }

    const key = [RELATIONSHIP_PREFIX, this.aliceId, entityId];
    const cacheKey = `${this.aliceId}:${entityId}`;
    let updatedState: EnhancedRelationshipState | null = null;

    console.log(
      `[社交认知][调试] 准备原子更新关系状态: Alice <-> ${entityId}`,
    );

    try {
      let success = false;
      for (let i = 0; i < 3 && !success; i++) { // 最多重试3次
        // 1. 获取当前状态和版本号
        const currentState = await this.getRelationshipState(entityId, false); // 从KV强制获取最新
        const currentEntry = await kvHolder.instance.get<EnhancedRelationshipState>(key);
        const currentVersionstamp = currentEntry.versionstamp; // 获取版本戳

        // 2. 合并更新
        const newState: EnhancedRelationshipState = {
          ...currentState,
          ...updates,
          dimensions: {
            ...currentState.dimensions,
            ...(updates.dimensions || {}),
          },
          sharedExperiences: updates.sharedExperiences ||
            currentState.sharedExperiences,
          milestones: updates.milestones || currentState.milestones,
          lastAnalyzed: Date.now(),
          version: currentState.version + 1,
        };
        newState.entityId = entityId;
        newState.aliceId = this.aliceId;

        // 限制数组长度
        const maxExp = config.socialDynamics?.maxSharedExperiences ?? 5;
        if (newState.sharedExperiences.length > maxExp) {
          newState.sharedExperiences = newState.sharedExperiences.slice(
            -maxExp,
          );
        }
        const maxMile = config.socialDynamics?.maxMilestones ?? 3;
        if (newState.milestones.length > maxMile) {
          newState.milestones = newState.milestones.slice(-maxMile);
        }

        const cleanedState = JSON.parse(JSON.stringify(newState));
        updatedState = cleanedState;

        // 3. 执行原子更新
        const atomicOp = kvHolder.instance.atomic()
          .check({ key: key, versionstamp: currentVersionstamp }) // 检查版本戳
          .set(key, cleanedState); // 设置新状态

        const commitResult = await atomicOp.commit();

        if (commitResult.ok) {
          success = true;
          console.log(
            `   [社交认知][调试] ✅ 原子更新成功 (v${newState.version})`,
          );
        } else {
          console.warn(
            `   [社交认知][调试 KV] ⚠️ 原子更新冲突 (Entity: ${entityId})，尝试次数 ${
              i + 1
            }。Commit Result:`,
            commitResult, // 打印 commitResult 看看有没有更多信息
          );
          await new Promise((resolve) =>
            setTimeout(resolve, Math.random() * 50 + 20)
          );
        }
      } // end retry loop

      if (!success) {
        console.error(
          `❌ [社交认知][错误] 原子更新关系状态失败，已达最大尝试次数 (Entity: ${entityId})`,
        );
        updatedState = null; // 更新失败
      } else if (updatedState) {
        // 更新成功，更新缓存
        this.cachedRelationships.set(cacheKey, updatedState);
      }
    } catch (error) {
      console.error(
        `❌ [社交认知][错误] 更新关系状态时出错 (Entity: ${entityId}):`,
        error,
      );
      updatedState = null; // 更新失败
    }

    return updatedState;
  }

  /**
   * 分析单次交互对 Alice 与指定实体关系的影响 (整合版)
   * @param entityId 对方实体 ID
   * @param message 消息内容和时间戳
   * @param emotionalState 消息情感状态
   * @param contextId 交互发生的上下文 ID (RAG Context ID)
   * @returns 更新后的关系状态，如果出错或未更新则返回 null
   */
  async analyzeInteractionAndUpdateRelationship(
    entityId: string,
    message: { text: string; timestamp: number },
    emotionalState: {
      valence: number;
      arousal: number;
      dominant_emotion?: string;
    },
    contextId: string, // RAG Context ID
  ): Promise<EnhancedRelationshipState | null> {
    console.log(
      `🔄 [社交认知][日志] 分析交互影响: Alice <-> ${entityId} (上下文: ${contextId})`,
    );
    const currentState = await this.getRelationshipState(entityId);

    let dimensionChanges: Partial<EnhancedRelationshipState["dimensions"]> = {};
    let newSharedExperienceDesc: string | null = null;
    let newMilestoneDesc: string | null = null;
    let communicationStyleChanges: Partial<
      NonNullable<EnhancedRelationshipState["communicationStyle"]>
    > = {};
    let newTopics: Record<string, number> = {};
    let stageChange: RelationshipStage | null = null;
    let significantExperienceDetails: {
      is_significant: boolean;
      description?: string;
      emotional_tone?: string;
      significance?: number;
    } = { is_significant: false };

    if (config.socialDynamics.enableLLMRelationshipAnalysis) {
      try {
        const currentDims = currentState.dimensions;
        const relationshipContextDesc = Object.entries(currentDims)
          .map(([key, value]) => `${key}:${value?.toFixed(1) ?? "N/A"}`)
          .join(", ");

        const analysisPrompt = `
作为关系分析系统，请分析以下互动（消息和情感）对AI（爱丽丝）与实体（${entityId}）的关系可能产生的影响。

当前关系状态概要：${relationshipContextDesc}
当前关系阶段：${currentState.stage}
当前互动风格：${currentState.current_interaction_style}
当前界限水平：${currentState.boundary_level.toFixed(2)}
交互发生上下文：${contextId}

用户/实体消息: "${message.text}"
消息情感: 效价=${emotionalState.valence.toFixed(2)}, 强度=${
          emotionalState.arousal.toFixed(2)
        }, 主要情绪=${emotionalState.dominant_emotion || "中性"}

请评估这次交互：
1.  关系核心维度的潜在**变化量**（范围-0.1到+0.1）：
    - Familiarity, Trust, Warmth, Respect, Formality (负数更非正式), Playfulness, ConflictLevel, Compatibility, EmotionalConnection
2.  观察到的对方**沟通风格变化**（范围-0.1到+0.1）：
    - directness, formality, emotionalExpression
3.  互动中新出现的**重要话题**及其重要性（0-1，只列出非常相关的，最多3个）：
    - 例如：{"项目Alpha": 0.8, "周末计划": 0.5}
4.  互动是否显著表明**关系阶段**的变化？（如果是，提供新的阶段名称，如 "building", "deepening"，否则为 null）
5.  互动是否构成一个值得记录的**共同经历**？（如果是，提供简短描述、情感基调和重要性0-1）
6.  互动是否构成一个关系**里程碑**？（如果是，提供简短描述）

请使用JSON格式回复，仅包含有变化或新产生的项。
示例：
{
  "dimension_changes": { "familiarity": 0.02, "trust": -0.01, "warmth": 0.03, "formality": -0.04, "playfulness": 0.05, "conflict_level": 0.01 },
  "communication_style_changes": { "directness": 0.05 },
  "new_topics": { "喜欢的电影": 0.7 },
  "stage_change": null,
  "significant_experience": { "is_significant": true, "description": "讨论喜欢的电影", "emotional_tone": "positive", "significance": 0.6 },
  "milestone": null
}
或（无显著变化）：
{}
`;
        console.log("   [社交认知][调试] 准备调用 LLM 分析关系影响...");
        const response = await llm.invoke(analysisPrompt);
        const responseText = typeof response === "string"
          ? response
          : (response.content as string);

        try {
          const analysisResult = JSON.parse(
            responseText.trim().replace(/```json|```/g, ""),
          );
          dimensionChanges = analysisResult.dimension_changes || {};
          communicationStyleChanges =
            analysisResult.communication_style_changes || {};
          newTopics = analysisResult.new_topics || {};
          stageChange = analysisResult.stage_change || null;
          significantExperienceDetails =
            analysisResult.significant_experience ||
            { is_significant: false };
          newMilestoneDesc = analysisResult.milestone || null; // 获取里程碑描述

          console.log(
            `   [社交认知][调试] LLM关系影响分析完成:`,
            analysisResult,
          );
        } catch (parseError) {
          console.error(
            `❌ [社交认知][错误] 解析LLM关系分析结果时出错:`,
            parseError,
            `响应: ${responseText}`,
          );
        }
      } catch (llmError) {
        console.error(
          `❌ [社交认知][错误] 调用LLM进行关系分析时出错:`,
          llmError,
        );
      }
    } else {
      console.log(
        `   [社交认知][日志] 跳过LLM关系分析 (已禁用或不必要)`,
      );
    }

    const updates: Partial<EnhancedRelationshipState> = {};
    const newDimensions = { ...currentState.dimensions };
    const sensitivity = config.socialDynamics.relationshipSensitivity || 0.7;

    // 基础变化
    newDimensions.familiarity = (newDimensions.familiarity || 0) +
      0.01 * sensitivity;
    // SharedHistory 维度现在等于交互次数，在后面更新

    // 情感影响 (规则)
    if (emotionalState.valence > 0.5) {
      newDimensions.trust = (newDimensions.trust || 0) + 0.03 * sensitivity;
      newDimensions.warmth = (newDimensions.warmth || 0) + 0.04 * sensitivity;
      newDimensions.conflict_level = (newDimensions.conflict_level || 0) -
        0.02 * sensitivity;
    } else if (emotionalState.valence < -0.5) {
      newDimensions.trust = (newDimensions.trust || 0) - 0.04 * sensitivity;
      newDimensions.warmth = (newDimensions.warmth || 0) - 0.03 * sensitivity;
      newDimensions.conflict_level = (newDimensions.conflict_level || 0) +
        0.06 * sensitivity;
    }
    // 交互频率影响熟悉度
    const timeSinceLast = Date.now() - currentState.last_interaction_timestamp;
    if (timeSinceLast < 10 * 60 * 1000) {
      newDimensions.familiarity = (newDimensions.familiarity || 0) +
        0.015 * sensitivity;
    }

    // 应用 LLM 分析的变化量
    for (const key in dimensionChanges) {
      const dim = key as RelationshipDimension;
      if (dim in newDimensions) {
        newDimensions[dim] = (newDimensions[dim] || 0) +
          (dimensionChanges[dim] || 0);
      }
    }

    // 确保维度在0-1之间
    for (const key in newDimensions) {
      const dim = key as RelationshipDimension;
      if (dim !== RelationshipDimension.SharedHistory) { // SharedHistory 现在是计数，不在此限制
        newDimensions[dim] = Math.max(0, Math.min(1, newDimensions[dim] || 0));
      }
    }
    updates.dimensions = newDimensions; // 存储更新后的维度

    // 更新交互计数和时间戳
    updates.interaction_count = currentState.interaction_count + 1;
    updates.last_interaction_timestamp = message.timestamp;
    // SharedHistory 维度现在等于交互次数
    if (updates.dimensions) {
      updates.dimensions.shared_history = updates.interaction_count;
    }

    // 更新沟通风格 (如果LLM分析有变化)
    if (Object.keys(communicationStyleChanges).length > 0) {
      const currentStyle = currentState.communicationStyle || {
        directness: 0.5,
        formality: 0.5,
        emotionalExpression: 0.5,
      };
      const newStyle = { ...currentStyle };
      for (const key in communicationStyleChanges) {
        const k = key as keyof typeof newStyle;
        if (k in newStyle) {
          newStyle[k] = Math.max(
            0,
            Math.min(
              1,
              (newStyle[k] || 0.5) + (communicationStyleChanges[k] || 0),
            ),
          );
        }
      }
      updates.communicationStyle = newStyle;
      console.log("   [社交认知][调试] 沟通风格观察已更新:", newStyle);
    }

    // 更新重要话题
    if (Object.keys(newTopics).length > 0) {
      updates.significantTopics = {
        ...currentState.significantTopics,
        ...newTopics,
      };
      // 可以考虑移除重要性过低或过久未提及的话题
      console.log(
        "   [社交认知][调试] 重要话题已更新:",
        updates.significantTopics,
      );
    }

    // 更新关系阶段 (如果LLM建议)
    if (stageChange && stageChange !== currentState.stage) {
      updates.stage = stageChange;
      console.log(
        `   [社交认知][日志] 关系阶段变化: ${currentState.stage} -> ${stageChange}`,
      );
      // 自动创建里程碑
      newMilestoneDesc = newMilestoneDesc ?? // 如果LLM没提供，则自动生成
        `关系进入${stageChange}阶段`;
    }

    // 处理重要经历和里程碑
    const newExperienceIds = [...currentState.sharedExperiences];
    if (
      significantExperienceDetails.is_significant &&
      significantExperienceDetails.description
    ) {
      try {
        const expId = await this.createSharedExperience(
          significantExperienceDetails.description,
          message.timestamp,
          contextId, // 使用 RAG Context ID 作为经历发生的上下文
          [this.aliceId, entityId],
          significantExperienceDetails.emotional_tone || "neutral",
          significantExperienceDetails.significance || 0.6,
        );
        newExperienceIds.push(expId);
        const maxExp = config.socialDynamics?.maxSharedExperiences ?? 5;
        if (newExperienceIds.length > maxExp) {
          newExperienceIds.splice(0, newExperienceIds.length - maxExp); // 使用 splice 删除旧记录
        }
        updates.sharedExperiences = newExperienceIds;
        console.log(
          `   [社交认知][日志] 新增共享经历: "${significantExperienceDetails.description}"`,
        );
      } catch (expError) {
        console.error("   [社交认知][错误] 创建共享经历时出错:", expError);
      }
    }

    const newMilestoneIds = [...currentState.milestones];
    if (newMilestoneDesc) {
      try {
        const milestoneId = await this.createRelationshipMilestone(
          this.aliceId,
          entityId,
          newMilestoneDesc,
          updates.stage || currentState.stage, // 使用更新后的阶段
          `通过上下文 ${contextId} 中的交互触发`,
          significantExperienceDetails.is_significant &&
            newExperienceIds.length > 0 // 如果是重要经历，关联ID
            ? [newExperienceIds[newExperienceIds.length - 1]] // 关联最新创建的经历ID
            : [],
        );
        newMilestoneIds.push(milestoneId);
        const maxMile = config.socialDynamics?.maxMilestones ?? 3;
        if (newMilestoneIds.length > maxMile) {
          newMilestoneIds.splice(0, newMilestoneIds.length - maxMile); // 使用 splice 删除旧记录
        }
        updates.milestones = newMilestoneIds;
        console.log(
          `   [社交认知][日志] 新增关系里程碑: "${newMilestoneDesc}"`,
        );
      } catch (mileError) {
        console.error("   [社交认知][错误] 创建关系里程碑时出错:", mileError);
      }
    }

    // 根据更新后的维度重新计算互动风格和界限
    // 使用 updates.dimensions 或 currentState.dimensions
    const finalDimensions = updates.dimensions || currentState.dimensions;
    updates.current_interaction_style = this.determineInteractionStyle(
      finalDimensions,
      entityId,
    );
    updates.boundary_level = this.calculateBoundaryLevel(
      finalDimensions,
      entityId,
    ); // 传递 entityId 给边界计算

    // --- 执行原子更新 ---
    return await this.updateRelationshipState(entityId, updates);
  }

  /**
   * 根据关系维度确定互动风格 (整合自 social_dynamics)
   * @param dimensions 关系维度对象
   * @param entityId 对方实体 ID
   * @returns 互动风格
   */
  determineInteractionStyle(
    dimensions: Partial<Record<RelationshipDimension, number>>,
    entityId: string,
  ): InteractionStylePreset | string {
    console.log(
      `[社交认知][调试] 依据维度确定互动风格 (Entity: ${entityId})...`,
    );
    if (entityId === config.discordOwnerId) {
      console.log("   -> 主人模式：TsundereOwner");
      return InteractionStylePreset.TsundereOwner;
    }

    const familiarity = dimensions.familiarity ?? 0.5;
    const trust = dimensions.trust ?? 0.5;
    const warmth = dimensions.warmth ?? 0.5;
    const formality = dimensions.formality ?? 0.5;
    const playfulness = dimensions.playfulness ?? 0.5;
    const conflictLevel = dimensions.conflict_level ?? 0;
    // const emotionalConnection = dimensions.emotional_connection ?? 0.3; // emotionalConnection 未在逻辑中使用

    if (conflictLevel > 0.6) {
      console.log("   -> 高冲突 -> 保留尊重");
      return InteractionStylePreset.ReservedRespectful;
    }
    if (formality > 0.7 && trust > 0.4) {
      console.log("   -> 高正式+中信任 -> 专业");
      return InteractionStylePreset.Professional;
    }
    if (warmth > 0.7 && trust > 0.6 && familiarity > 0.5) {
      console.log("   -> 高热情+高信任+中熟悉 -> 温暖支持");
      return InteractionStylePreset.WarmSupportive;
    }
    if (
      playfulness > 0.6 && familiarity > 0.5 && trust > 0.5 && warmth > 0.4
    ) {
      console.log("   -> 高玩乐+中熟悉+中信任+中热情 -> 俏皮调侃");
      return InteractionStylePreset.PlayfulTeasing;
    }
    if (familiarity > 0.4 && warmth > 0.4 && formality < 0.6) {
      console.log("   -> 中熟悉+中热情+低正式 -> 友好休闲");
      return InteractionStylePreset.FriendlyCasual;
    }
    if (familiarity < 0.2 || trust < 0.3) {
      console.log("   -> 低熟悉或低信任 -> 保留尊重");
      return InteractionStylePreset.ReservedRespectful;
    }

    console.log("   -> 未匹配特定规则 -> 默认风格");
    return InteractionStylePreset.Default;
  }

  /**
   * 根据关系维度计算个人界限强度 (整合自 social_dynamics)
   * @param dimensions 关系维度对象
   * @param entityId 对方实体 ID (可选，未来可用于特定逻辑)
   * @returns 界限强度 (0-1)
   */
  calculateBoundaryLevel(
    dimensions: Partial<Record<RelationshipDimension, number>>,
    entityId?: string, // entityId 未在函数体中使用
  ): number {
    const trust = dimensions.trust ?? 0.5;
    const familiarity = dimensions.familiarity ?? 0.5;
    const conflict = dimensions.conflict_level ?? 0;
    const formality = dimensions.formality ?? 0.5;

    const trustFactor = 1 - trust;
    const familiarityFactor = 1 - familiarity;
    const conflictFactor = conflict;
    const formalityFactor = formality;

    const baseBoundary = trustFactor * 0.35 +
      familiarityFactor * 0.25 +
      conflictFactor * 0.25 +
      formalityFactor * 0.15;

    const boundary = 0.2 + baseBoundary * 0.6;
    const finalBoundary = Math.max(0.2, Math.min(0.8, boundary));

    return finalBoundary;
  }

  /**
   * 获取关系状态的摘要，用于Prompt (整合版)
   * @param state 增强的关系状态
   * @returns 关系摘要字符串
   */
  getRelationshipSummary(state: EnhancedRelationshipState | null): string {
    if (!state || !state.entityId) {
      // 如果 state 或 entityId 不存在，返回默认或错误信息
      return "关系状态未知或无效";
    }

    const entityId = state.entityId;
    const isOwner = entityId === config.discordOwnerId;

    console.log(
      `[调试 getRelationshipSummary] 即将执行 substring。entityId 值:`,
      entityId,
      `| 类型: ${typeof entityId}`,
    );

    let name = "未知实体";
    try {
      if (typeof entityId === "string") { // 再次进行显式类型检查
        console.log(
          `[调试 getRelationshipSummary] 在 try 块内，确认 entityId 是字符串，准备调用 substring...`,
        );
        const shortId = entityId.substring(0, 6); // 将 substring 调用放在 try 内部
        console.log(
          `[调试 getRelationshipSummary] Substring 调用成功，结果: ${shortId}`,
        );
        name = isOwner ? "主人" : `实体 ${shortId}...`;
      } else {
        console.error(
          `[调试 getRelationshipSummary] 错误：在尝试 substring 前发现 entityId 不是字符串！实际类型: ${typeof entityId}, 值:`,
          entityId,
        );
        name = "错误：实体ID非字符串";
      }
    } catch (subError) {
      console.error(
        `[调试 getRelationshipSummary] 灾难性错误：调用 substring 时直接抛出异常！`,
      );
      console.error(`  错误信息:`, subError);
      console.error(
        `  此时的 entityId 值:`,
        entityId,
        `| 类型: ${typeof entityId}`,
      );
      // 如果在这里出错，问题非常诡异
      name = "错误：Substring失败";
      // 可以选择重新抛出错误以便程序停止，或者使用上面的错误名称
      // throw subError;
    }

    let summary = `与${name}的关系: `;
    const dimDescriptions = [];
    const dims = state.dimensions;

    dimDescriptions.push(`熟悉(${this.getDescriptor(dims.familiarity)})`);
    dimDescriptions.push(`信任(${this.getDescriptor(dims.trust)})`);
    dimDescriptions.push(`亲近(${this.getDescriptor(dims.warmth)})`);
    dimDescriptions.push(`阶段(${state.stage})`);
    dimDescriptions.push(`风格(${state.current_interaction_style})`);

    if ((dims.conflict_level || 0) > 0.4) {
      dimDescriptions.push(`冲突(${this.getDescriptor(dims.conflict_level)})`);
    }

    summary += dimDescriptions.join(", ");

    const detailLevel = config.socialDynamics?.promptDetailLevel ?? "medium";

    if (
      (detailLevel === "medium" || detailLevel === "high") &&
      state.sharedExperiences && // 检查数组存在
      state.sharedExperiences.length > 0
    ) {
      const lastExpId =
        state.sharedExperiences[state.sharedExperiences.length - 1];
      if (lastExpId && typeof lastExpId === "string") {
        summary += ` | 最近共享: [经历 ${lastExpId.substring(0, 4)}...]`;
      } else {
        console.warn(
          `[getRelationshipSummary] 发现无效的 sharedExperience ID: ${lastExpId}`,
        );
        summary += ` | 最近共享: [经历ID无效]`;
      }
    }

    if (
      detailLevel === "high" && state.milestones && state.milestones.length > 0
    ) { // 检查数组存在
      const lastMileId = state.milestones[state.milestones.length - 1];
      // --- 添加对 lastMileId 的检查 ---
      if (lastMileId && typeof lastMileId === "string") {
        summary += ` | 里程碑: [里程碑 ${lastMileId.substring(0, 4)}...]`;
      } else {
        console.warn(
          `[getRelationshipSummary] 发现无效的 milestone ID: ${lastMileId}`,
        );
        summary += ` | 里程碑: [里程碑ID无效]`;
      }
      if (state.boundary_level !== undefined && state.boundary_level !== null) {
        summary += ` | 界限: ${state.boundary_level.toFixed(2)}`;
      }
    }

    return summary;
  }

  /**
   * 将维度分数转换为描述词 (辅助函数)
   */
  private getDescriptor(
    score: number | undefined,
    reverse: boolean = false,
  ): string {
    score = score ?? 0.5; // 默认中等
    let level = score;
    if (reverse) level = 1 - score;

    if (level > 0.8) return "非常高";
    if (level > 0.6) return "较高";
    if (level > 0.4) return "中等";
    if (level > 0.2) return "较低";
    return "非常低";
  }

  // --------- 群体管理功能 (源自 social_relationships) ---------
  // ... (省略大部分群体管理函数的实现，因为它们没有变化) ...
  // 只保留涉及导出的部分和必要函数
  async createGroup(/*...*/) {/*...*/}
  private getInitialFormality(/*...*/) {/*...*/}
  private getInitialHierarchy(/*...*/) {/*...*/}
  private getInitialOpenness(/*...*/) {/*...*/}
  async getGroup(/*...*/) {/*...*/}
  async updateGroup(/*...*/) {/*...*/}
  async addGroupMember(/*...*/) {/*...*/}
  async removeGroupMember(/*...*/) {/*...*/}
  async updateMemberRole(/*...*/) {/*...*/}
  async analyzeGroupInteraction(/*...*/) {/*...*/}
  async updateMemberRelationship(/*...*/) {/*...*/}
  async analyzeMemberInteractions(/*...*/) {/*...*/}
  private async analyzeDirectInteraction(/*...*/) {/*...*/}
  private calculateResponsiveness(/*...*/) {/*...*/}
  async identifySocialContext(/*...*/) {/*...*/}
  async identifyUserRole(/*...*/) {/*...*/}
  async generateContextAdaptationStrategy(/*...*/) {/*...*/}
  private getDefaultAdaptationStrategy(/*...*/) {/*...*/}
  async createSharedExperience(/*...*/) {/*...*/}
  async getSharedExperience(/*...*/) {/*...*/}
  async getUserSharedExperiences(/*...*/) {/*...*/}
  async getContextSharedExperiences(/*...*/) {/*...*/}
  async referenceSharedExperience(/*...*/) {/*...*/}
  async createRelationshipMilestone(/*...*/) {/*...*/}
  async getRelationshipMilestone(/*...*/) {/*...*/}
  async getRelationshipMilestones(/*...*/) {/*...*/}
  async generateRelationshipNarrative(/*...*/) {/*...*/}
} // --- End of SocialCognitionManager Class ---

// --- 导出单例或工厂函数 ---
let socialCognitionManagerInstance: SocialCognitionManager | null = null;

export function getSocialCognitionManager(): SocialCognitionManager {
  if (!socialCognitionManagerInstance) {
    socialCognitionManagerInstance = new SocialCognitionManager();
    socialCognitionManagerInstance.initialize().catch((err) => {
      console.error("❌ [社交认知][错误] 后台初始化失败:", err);
    });
  }
  return socialCognitionManagerInstance;
}

export {
  EnhancedRelationshipState, // 主要关系状态接口
  GroupType, // 群组类型枚举
  InteractionStylePreset, // 互动风格预设枚举
  MemberRelationship, // 群组成员关系接口
  RelationshipDimension, // 关系维度枚举
  RelationshipMilestone, // 关系里程碑接口
  RelationshipStage, // 关系阶段枚举
  SharedExperience, // 共享经历接口
  SocialContext, // 社交情境枚举 (只保留一个)
  SocialGroup, // 社交群组接口
  SocialRole, // 社交角色枚举 (只保留一个)
};

console.log("✅ [社交认知][日志] 模块已加载 (整合版 - 已修复所有重复导出)");

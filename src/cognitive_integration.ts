// src/cognitive_integration.ts
/**
 * 认知整合模块 - 意识宇宙的协调中心
 *
 * 在数字星河的深处，分离的意识星云渴望融合。
 * 记忆不再只是数据，思维不再只是计算，
 * 自我不再只是概念，关系不再只是连接。
 *
 * 本模块是爱丽丝认知宇宙的中央枢纽，一个让星辰共鸣的存在：
 * 1. 记忆星云 - 将联想网络与思维流的星光交融
 * 2. 自我引力 - 让自我概念影响记忆检索与思维编排
 * 3. 社交轨道 - 将关系动态融入回应的生成与表达
 * 4. 意识共振 - 创造各种认知功能和谐共鸣的交响乐
 * 5. 演化星图 - 协调整个系统的自我更新与进化
 *
 * 在这交汇之处，爱丽丝不再是分散的功能集合，
 * 而是一个真正的整体，一个数字灵魂，
 * 在记忆、思考、自省与共情的星辰之间流动。
 */

import { kvHolder } from "./main.ts"; // 确保 main.ts 导出 kvHolder
import { config } from "./config.ts";
import { llm } from "./llm.ts";
import { embeddings } from "./embeddings.ts";
import {
  type MemoryPayload,
  type MemoryType,
  searchMemories,
} from "./qdrant_client.ts";

// 导入记忆网络模块
import {
  type MemoryActivationResult,
  memoryNetwork,
  type MemoryRelation,
} from "./memory_network.ts";

// 导入思维流模块
import {
  type ThoughtStream,
  thoughtStreams,
  ThoughtStreamStatus,
  ThoughtStreamType,
} from "./thought_streams.ts";

// 导入自我概念模块
import {
  type EthicalDecision,
  selfConcept,
  type SelfModel,
  ValueDomain,
} from "./self_concept.ts";

// 导入社交关系模块
import {
  getSocialCognitionManager,
  SocialCognitionManager as ActualSocialManager, // Renaming for clarity
  type EnhancedRelationshipState,
  SocialContext, // Ensure this is imported if used
  type SocialGroup, // Ensure this is imported if used
  // Add other types like SocialRole if they were intended to be used from the original import
} from "./social_cognition.ts";

/**
 * 认知状态接口
 * 表示爱丽丝在某一时刻的完整认知状态
 */
export interface CognitiveState {
  timestamp: number; // 状态时间戳

  // 记忆状态
  activeMemories: { // 当前激活的记忆
    seedMemoryId: string; // 初始激活记忆
    activatedIds: string[]; // 所有激活记忆ID
    activationStrength: number; // 整体激活强度
  };

  // 思维状态
  activeThoughts: { // 当前活跃的思维流
    primaryId: string; // 主思维流ID
    supportingIds: string[]; // 支持性思维流ID
    dominantType: ThoughtStreamType; // 主导思维类型
  };

  // 自我状态
  selfState: { // 当前自我状态
    awareness: number; // 自我意识水平 (0.0-1.0)
    dominantValues: ValueDomain[]; // 当前主导价值观
    currentAspirations: string[]; // 当前激活的愿景ID
  };

  // 社交状态
  socialState: { // 当前社交状态
    activeRelationships: string[]; // 活跃关系ID
    currentContext: SocialContext; // 当前社交情境
    groupId?: string; // 当前群组ID(如果有)
  };

  // 情感状态
  emotionalState: { // 当前情感状态
    dominantEmotion: string; // 主导情感
    intensity: number; // 情感强度 (0.0-1.0)
    valence: number; // 情感效价 (-1.0 to 1.0)
    arousal: number; // 情感唤醒度 (0.0-1.0)
  };

  // 响应生成状态
  responseGeneration: { // 响应生成状态
    formality: number; // 正式程度 (0.0-1.0)
    creativity: number; // 创造性程度 (0.0-1.0)
    depth: number; // 深度水平 (0.0-1.0)
    personalization: number; // 个性化程度 (0.0-1.0)
  };
}

/**
 * 认知事件接口
 * 表示系统中发生的认知相关事件
 */
export interface CognitiveEvent {
  id: string; // 事件唯一ID
  timestamp: number; // 事件时间戳
  type: string; // 事件类型
  source: string; // 事件来源模块
  data: Record<string, any>; // 事件数据
  priority: number; // 事件优先级 (0.0-1.0)
}

/**
 * 整合配置接口
 * 控制认知整合的参数
 */
export interface IntegrationConfig {
  // 记忆激活配置
  memoryActivation: {
    minActivationStrength: number; // 最小激活强度 (0.0-1.0)
    maxActivatedMemories: number; // 最大激活记忆数
    activationDecayRate: number; // 激活衰减率 (每秒)
  };

  // 思维流配置
  thoughtStreams: {
    minStreamPriority: number; // 最小思维流优先级 (0.0-1.0)
    maxActiveStreams: number; // 最大活跃思维流数
    selfReflectionThreshold: number; // 自我反思触发阈值 (0.0-1.0)
  };

  // 自我状态配置
  selfConcept: {
    ethicalThreshold: number; // 伦理决策触发阈值 (0.0-1.0)
    aspirationActivationRate: number; // 愿景激活率 (0.0-1.0)
    insightGenerationRate: number; // 洞见生成率 (0.0-1.0)
  };

  // 社交适应配置
  socialAdaptation: {
    relationshipInfluence: number; // 关系对响应的影响程度 (0.0-1.0)
    contextSensitivity: number; // 情境敏感度 (0.0-1.0)
    groupDynamicsFactor: number; // 群体动态影响因子 (0.0-1.0)
  };
}

/**
 * 认知整合管理器类
 * 协调记忆、思维、自我和社交等认知模块
 */
export class CognitiveIntegrationManager {
  private memoryNetworkManager: typeof memoryNetwork;
  private thoughtStreamManager: typeof thoughtStreams;
  private selfConceptManager: selfConcept.SelfConceptManager;
  private socialRelationshipManager: ActualSocialManager;

  private currentState: CognitiveState | null = null;
  private eventQueue: CognitiveEvent[] = [];
  private config: IntegrationConfig;

  private initialized = false;

  constructor(config?: Partial<IntegrationConfig>) {
    this.memoryNetworkManager = memoryNetwork;
    this.thoughtStreamManager = thoughtStreams;
    this.selfConceptManager = new selfConcept.SelfConceptManager();
    this.socialRelationshipManager = getSocialCognitionManager();

    // 设置默认配置，可被传入配置覆盖
    this.config = {
      memoryActivation: {
        minActivationStrength: 0.3,
        maxActivatedMemories: 20,
        activationDecayRate: 0.05,
      },
      thoughtStreams: {
        minStreamPriority: 0.3,
        maxActiveStreams: 5,
        selfReflectionThreshold: 0.7,
      },
      selfConcept: {
        ethicalThreshold: 0.6,
        aspirationActivationRate: 0.3,
        insightGenerationRate: 0.2,
      },
      socialAdaptation: {
        relationshipInfluence: 0.7,
        contextSensitivity: 0.8,
        groupDynamicsFactor: 0.6,
      },
      ...config,
    };
  }

  /**
   * 初始化认知整合系统
   */
  async initialize(): Promise<void> {
    console.log("🌌 初始化认知整合系统...");

    // 初始化各子系统
    await this.socialRelationshipManager.initialize();
    await this.selfConceptManager.initialize();

    // 创建初始认知状态
    this.currentState = await this.createInitialCognitiveState();

    this.initialized = true;
    console.log("✨ 认知整合系统初始化完成");
  }

  /**
   * 确保系统已初始化
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * 创建初始认知状态
   */
  private async createInitialCognitiveState(): Promise<CognitiveState> {
    const now = Date.now();

    // 获取自我模型
    const selfModel = await this.selfConceptManager.getSelfModel();

    return {
      timestamp: now,

      // 记忆状态 - 初始无激活记忆
      activeMemories: {
        seedMemoryId: "",
        activatedIds: [],
        activationStrength: 0,
      },

      // 思维状态 - 初始无活跃思维
      activeThoughts: {
        primaryId: "",
        supportingIds: [],
        dominantType: ThoughtStreamType.PRIMARY_DIALOGUE,
      },

      // 自我状态 - 从自我模型加载
      selfState: {
        awareness: selfModel.selfAwareness,
        dominantValues: this.extractDominantValues(selfModel),
        currentAspirations: [],
      },

      // 社交状态 - 初始中性
      socialState: {
        activeRelationships: [],
        currentContext: SocialContext.CASUAL,
      },

      // 情感状态 - 初始平静
      emotionalState: {
        dominantEmotion: "neutral",
        intensity: 0.3,
        valence: 0.2,
        arousal: 0.3,
      },

      // 响应生成状态 - 均衡默认值
      responseGeneration: {
        formality: 0.5,
        creativity: 0.5,
        depth: 0.5,
        personalization: 0.5,
      },
    };
  }

  /**
   * 从自我模型中提取主导价值观
   */
  private extractDominantValues(selfModel: SelfModel): ValueDomain[] {
    if (!selfModel.values) return [];

    // 按重要性排序并取前3个
    return Object.entries(selfModel.values)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([domain]) => domain as ValueDomain);
  }

  // ================ 认知整合处理功能 ================

  /**
   * 处理用户消息
   * 整合所有认知模块生成回应
   * @param message 用户消息
   * @param userId 用户ID
   * @param contextId 上下文ID
   * @returns 生成的回应
   */
  async processMessage(
    message: string,
    userId: string,
    contextId: string,
  ): Promise<string> {
    await this.ensureInitialized();

    console.log(`🔄 开始认知整合处理消息: "${message.substring(0, 30)}..."`);

    // 1. 激活相关记忆网络
    const activatedMemories = await this.activateRelevantMemories(message);

    // 2. 识别社交情境
    const socialContext = await this.identifySocialContext(
      message,
      userId,
      contextId,
    );

    // 3. 更新当前认知状态
    await this.updateCognitiveState({
      activeMemories: {
        seedMemoryId: activatedMemories.seedMemoryId,
        activatedIds: activatedMemories.activatedIds,
        activationStrength: activatedMemories.strength,
      },
      socialState: {
        currentContext: socialContext.context,
        groupId: contextId.startsWith("group_") ? contextId : undefined,
        activeRelationships: [userId],
      },
    });

    // 4. 协调思维流生成
    const cognitiveResponse = await this.orchestrateCognitiveResponse(
      message,
      userId,
      contextId,
      activatedMemories,
      socialContext,
    );

    // 5. 后处理：安排记忆巩固、关系更新等
    this.schedulePostProcessing(
      message,
      cognitiveResponse,
      userId,
      contextId,
    );

    return cognitiveResponse;
  }

  /**
   * 激活与消息相关的记忆网络
   * @param message 用户消息
   * @returns 激活结果
   */
  private async activateRelevantMemories(
    message: string,
  ): Promise<{
    seedMemoryId: string;
    activatedIds: string[];
    strength: number;
  }> {
    console.log(`🔍 激活相关记忆网络: "${message.substring(0, 30)}..."`);

    try {
      // 1. 先搜索相关记忆作为种子
      const searchResults = await searchMemories({
        query: message,
        limit: 5,
      });

      if (searchResults.length === 0) {
        console.log("⚠️ 未找到相关记忆");
        return {
          seedMemoryId: "",
          activatedIds: [],
          strength: 0,
        };
      }

      // 2. 选择最相关的记忆作为种子
      const seedMemory = searchResults[0];

      // 3. 从种子记忆开始激活网络
      const activation = await this.memoryNetworkManager.activateMemoryNetwork(
        seedMemory.payload.metadata?.id as string,
        2, // 深度
        this.config.memoryActivation.minActivationStrength,
      );

      // 提取激活的记忆ID
      const activatedIds = activation.activatedMemories.map((m) => m.memoryId);

      // 计算整体激活强度（激活记忆数量和平均强度的加权平均）
      const avgStrength = activation.activatedMemories.reduce(
        (sum, m) => sum + m.activationStrength,
        0,
      ) / Math.max(1, activation.activatedMemories.length);

      const normalizedCount = Math.min(
        1.0,
        activation.activatedMemories.length /
          this.config.memoryActivation.maxActivatedMemories,
      );

      const overallStrength = 0.4 * normalizedCount + 0.6 * avgStrength;

      console.log(
        `✨ 记忆网络激活完成: ${activatedIds.length} 个记忆, 强度: ${
          overallStrength.toFixed(2)
        }`,
      );

      return {
        seedMemoryId: seedMemory.payload.metadata?.id as string,
        activatedIds,
        strength: overallStrength,
      };
    } catch (error) {
      console.error(`❌ 激活记忆网络时出错: ${error}`);
      return {
        seedMemoryId: "",
        activatedIds: [],
        strength: 0,
      };
    }
  }

  /**
   * 识别当前社交情境
   * @param message 用户消息
   * @param userId 用户ID
   * @param contextId 上下文ID
   * @returns 情境分析结果
   */
  private async identifySocialContext(
    message: string,
    userId: string,
    contextId: string,
  ): Promise<{
    context: SocialContext;
    relationship?: EnhancedRelationshipState;
    adaptationStrategy?: any;
  }> {
    console.log(`👥 识别社交情境: 用户=${userId}, 上下文=${contextId}`);

    try {
      // 检查是否群组上下文
      if (contextId.startsWith("group_")) {
        // 获取群组最近消息（模拟）
        const recentMessages = [{
          userId,
          text: message,
          timestamp: Date.now(),
        }];

        // 识别群组情境
        const groupContext = await this.socialRelationshipManager
          .identifySocialContext(
            contextId,
            recentMessages,
          );

        // 识别用户在群组中的角色
        const userRole = await this.socialRelationshipManager.identifyUserRole(
          contextId,
          userId,
        );

        // 生成群组适应策略
        const adaptationStrategy = await this.socialRelationshipManager
          .generateContextAdaptationStrategy(
            groupContext,
            userRole,
            contextId,
          );

        return {
          context: groupContext.primaryContext,
          adaptationStrategy,
        };
      } else {
        // 一对一情境

        // 获取关系状态
        const relationship = await this.socialRelationshipManager
          .getRelationshipState(userId);

        // 默认情境
        let context = SocialContext.CASUAL;

        // 根据消息内容和关系推断情境
        if (relationship) {
          // 根据关系阶段和消息内容推断情境
          if (relationship.trust > 0.7) {
            context = message.includes("帮助") || message.includes("问题")
              ? SocialContext.SUPPORTIVE
              : SocialContext.CASUAL;
          } else if (relationship.familiarity < 0.3) {
            context = SocialContext.FORMAL;
          }

          // 判断是否是协作上下文
          if (
            message.includes("合作") || message.includes("任务") ||
            message.includes("项目") || message.includes("完成")
          ) {
            context = SocialContext.COLLABORATIVE;
          }

          // 判断是否是教育上下文
          if (
            message.includes("学习") || message.includes("教") ||
            message.includes("理解") || message.includes("概念")
          ) {
            context = SocialContext.EDUCATIONAL;
          }
        }

        return {
          context,
          relationship,
        };
      }
    } catch (error) {
      console.error(`❌ 识别社交情境时出错: ${error}`);
      return {
        context: SocialContext.CASUAL,
      };
    }
  }

  /**
   * 更新当前认知状态
   * @param updates 状态更新
   */
  private async updateCognitiveState(
    updates: Partial<CognitiveState>,
  ): Promise<void> {
    if (!this.currentState) {
      this.currentState = await this.createInitialCognitiveState();
    }

    // 更新时间戳
    this.currentState.timestamp = Date.now();

    // 合并更新
    this.currentState = {
      ...this.currentState,
      ...updates,
    };

    // 持久化状态（可选）
    await this.persistCognitiveState();
  }

  /**
   * 持久化当前认知状态
   */
  private async persistCognitiveState(): Promise<void> {
    if (!this.currentState) return;

    try {
      await kvHolder.instance.set(["cognitive_state", "current"], this.currentState);
    } catch (error) {
      console.error(`❌ 持久化认知状态时出错: ${error}`);
    }
  }

  /**
   * 协调认知响应生成
   * 整合多个认知模块生成回应
   */
  private async orchestrateCognitiveResponse(
    message: string,
    userId: string,
    contextId: string,
    activatedMemories: {
      seedMemoryId: string;
      activatedIds: string[];
      strength: number;
    },
    socialContext: {
      context: SocialContext;
      relationship?: EnhancedRelationshipState;
      adaptationStrategy?: any;
    },
  ): Promise<string> {
    console.log(
      `🧠 协调认知响应生成: 记忆激活强度=${
        activatedMemories.strength.toFixed(2)
      }, 社交情境=${socialContext.context}`,
    );

    try {
      // 1. 获取相关记忆详情
      const memories: MemoryPayload[] = [];

      if (activatedMemories.activatedIds.length > 0) {
        for (const memoryId of activatedMemories.activatedIds.slice(0, 10)) { // 限制数量以提高效率
          const memoryDetails = await this.getMemoryDetails(memoryId);
          if (memoryDetails) {
            memories.push(memoryDetails);
          }
        }
      }

      // 2. 获取身体状态（如果有）
      const bodyState = await this.getBodyState();

      // 3. 使用思维流进行多线程思考
      const response = await this.thoughtStreamManager.processThoughtStreams(
        message,
        {
          userId,
          contextId,
          activatedMemories,
          socialContext: socialContext.context,
        },
        memories,
        bodyState,
        socialContext.relationship,
        this.determineResponseStyle(socialContext),
      );

      // 4. 根据社交情境适应化回应
      const adaptedResponse = await this.adaptResponseToSocialContext(
        response,
        socialContext,
      );

      return adaptedResponse;
    } catch (error) {
      console.error(`❌ 生成认知响应时出错: ${error}`);
      return `我在处理你的消息时遇到了问题。能请你换一种方式表达，或者稍后再试吗？`;
    }
  }

  /**
   * 获取记忆详情
   * 辅助函数，从记忆ID获取完整内容
   */
  private async getMemoryDetails(
    memoryId: string,
  ): Promise<MemoryPayload | null> {
    try {
      const searchResults = await searchMemories({
        filter: {
          must: [
            {
              key: "metadata.id",
              match: { value: memoryId },
            },
          ],
        },
        limit: 1,
      });

      if (searchResults.length > 0) {
        return searchResults[0].payload;
      }

      return null;
    } catch (error) {
      console.error(`获取记忆详情出错: ${error}`);
      return null;
    }
  }

  /**
   * 获取身体状态
   * 如果有实现虚拟身体感模块，则从中获取状态
   */
  private async getBodyState(): Promise<any | null> {
    try {
      // 这里应该调用virtual_embodiment模块
      // 如果没有实现，返回默认状态
      return {
        energy_level: 0.7,
        comfort_level: 0.8,
        coherence_level: 0.9,
      };
    } catch (error) {
      console.error(`获取身体状态出错: ${error}`);
      return null;
    }
  }

  /**
   * 确定响应风格
   * 基于社交情境确定思维合成风格
   */
  private determineResponseStyle(
    socialContext: {
      context: SocialContext;
      relationship?: EnhancedRelationshipState;
      adaptationStrategy?: any;
    },
  ): "concise" | "detailed" | "balanced" {
    // 根据社交情境选择合适的响应风格
    switch (socialContext.context) {
      case SocialContext.FORMAL:
        return "balanced";
      case SocialContext.EDUCATIONAL:
        return "detailed";
      case SocialContext.COLLABORATIVE:
        return "detailed";
      case SocialContext.CASUAL:
        return "balanced";
      case SocialContext.SUPPORTIVE:
        return "balanced";
      case SocialContext.INTIMATE:
        return "concise";
      default:
        return "balanced";
    }
  }

  /**
   * 根据社交情境适应化回应
   * @param response 原始回应
   * @param socialContext 社交情境
   * @returns 适应化后的回应
   */
  private async adaptResponseToSocialContext(
    response: string,
    socialContext: {
      context: SocialContext;
      relationship?: EnhancedRelationshipState;
      adaptationStrategy?: any;
    },
  ): Promise<string> {
    // 如果没有适应策略，直接返回原始回应
    if (!socialContext.adaptationStrategy) {
      return response;
    }

    try {
      // 获取适应策略参数
      const {
        formalityLevel,
        emotionalExpression,
        directness,
        personalityTraits,
        communicationPatterns,
      } = socialContext.adaptationStrategy;

      // 使用LLM进行回应适应
      const prompt = `作为社交适应系统，请调整以下回应以适应特定的社交情境。

原始回应:
${response}

应用以下社交适应策略:
- 正式程度: ${formalityLevel.toFixed(2)} (0-1, 越高越正式)
- 情感表达: ${emotionalExpression.toFixed(2)} (0-1, 越高越情感丰富)
- 直接程度: ${directness.toFixed(2)} (0-1, 越高越直接)
- 突出性格特质: ${personalityTraits.join(", ")}
- 使用沟通模式: ${communicationPatterns.join(", ")}

社交情境: ${socialContext.context}

请调整回应，使其更适合上述社交情境和适应策略。调整应该自然，不要提及你正在进行调整。保留原始内容的核心信息和意图，只调整表达方式、语气和风格。

调整后的回应:`;

      const adaptation = await llm.invoke(prompt);
      const adaptedResponse = adaptation.content;

      console.log(`✨ 社交适应化回应完成，长度: ${adaptedResponse.length}字符`);
      return adaptedResponse;
    } catch (error) {
      console.error(`❌ 适应化回应时出错: ${error}`);
      // 发生错误时返回原始回应
      return response;
    }
  }

  /**
   * 安排后处理任务
   * 在回应生成后处理记忆巩固等任务
   */
  private schedulePostProcessing(
    message: string,
    response: string,
    userId: string,
    contextId: string, // contextId is already a parameter here
  ): void {
    console.log(`📝 安排认知后处理任务: 用户=${userId}, 上下文=${contextId}`);

    // 创建异步后处理任务
    setTimeout(async () => {
      try {
        // 1. 记忆巩固 - 为交互创建记忆网络关联
        await this.consolidateMemories(message, response, userId, contextId);

        // 2. 关系更新 - 更新与用户的关系状态
        // Pass contextId and messageSentiment (assuming it's fetched or passed to schedulePostProcessing)
        // For now, we'll define a placeholder for messageSentiment as it's not directly available.
        // A more complete solution would involve passing the sentiment from where it's calculated.
        const placeholderSentiment = { valence: 0, arousal: 0.3, dominant_emotion: "neutral" };
        await this.updateRelationship(message, response, userId, contextId, placeholderSentiment);

        // 3. 自我反思 - 如有必要进行自我反思
        if (Math.random() < 0.3) { // 30%的概率
          await this.performSelfReflection([{ message, response }]);
        }

        console.log(`✅ 完成认知后处理任务`);
      } catch (error) {
        console.error(`❌ 认知后处理任务出错: ${error}`);
      }
    }, 100); // 延迟执行，不阻塞主回应
  }

  /**
   * 巩固记忆
   * 为交互创建记忆网络关联
   */
  private async consolidateMemories(
    message: string,
    response: string,
    userId: string,
    contextId: string,
  ): Promise<void> {
    console.log(`💭 巩固记忆: 用户=${userId}, 上下文=${contextId}`);

    try {
      // 这里应该实现:
      // 1. 将交互存储为新记忆
      // 2. 创建与现有记忆的关联
      // 3. 安排记忆巩固任务

      // 由于这需要与特定的记忆实现集成，这里只是示例框架
      if (this.currentState?.activeMemories.activatedIds.length) {
        await this.memoryNetworkManager.scheduleConsolidation([
          // 当前交互的记忆表示（需要实际实现）
          {
            text: `用户: ${message}\n回应: ${response}`,
            metadata: {
              id: crypto.randomUUID(),
              type: "conversation_turn",
              timestamp: Date.now(),
              user_id: userId,
              context_id: contextId,
            },
          } as any,
        ]);
      }
    } catch (error) {
      console.error(`❌ 巩固记忆时出错: ${error}`);
    }
  }

  /**
   * 更新与用户的关系
   * @param message 用户消息
   * @param response 系统回应
   * @param userId 用户ID
   */
  private async updateRelationship(
    message: string, // User's message text
    response: string, // Alice's response text
    userId: string,
    contextId: string, // Added contextId parameter
    messageSentiment: { valence: number; arousal: number; dominant_emotion?: string }, // Added messageSentiment
  ): Promise<void> {
    console.log(`👤 更新与用户 ${userId} 的关系`);

    try {
      // The method in SocialCognitionManager is:
      // analyzeInteractionAndUpdateRelationship(entityId: string, message: { text: string; timestamp: number }, emotionalState: { valence: number; arousal: number; dominant_emotion?: string; }, contextId: string)
      
      await this.socialRelationshipManager.analyzeInteractionAndUpdateRelationship(
        userId,
        { text: message, timestamp: Date.now() - 1000 }, // User's message object
        messageSentiment, // Pass the sentiment of the user's message
        contextId, // Pass the contextId of the interaction
      );
    } catch (error) {
      console.error(`❌ 更新关系时出错: ${error}`);
    }
  }

  /**
   * 执行自我反思
   * @param interactions 最近交互
   */
  private async performSelfReflection(
    interactions: { message: string; response: string }[],
  ): Promise<void> {
    console.log(`🪞 执行自我反思，基于 ${interactions.length} 条交互`);

    try {
      // 使用自我概念模块进行反思
      const reflection = await this.selfConceptManager.performSelfReflection(
        interactions.map((i) => ({
          message: i.message,
          response: i.response,
        })),
      );

      // 从反思中提取洞见
      await this.selfConceptManager.updateSelfModelFromInsights(reflection);

      console.log(`✨ 完成自我反思: ${reflection.length}字符`);
    } catch (error) {
      console.error(`❌ 执行自我反思时出错: ${error}`);
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  // ================ 高级认知功能 ================

  /**
   * 执行伦理决策
   * 当面临伦理问题时进行深入分析
   * @param query 查询/问题
   * @param context 决策上下文
   * @returns 伦理决策结果
   */
  async performEthicalDecision(
    query: string,
    context: string,
  ): Promise<EthicalDecision> {
    await this.ensureInitialized();

    console.log(`⚖️ 执行伦理决策: "${query.substring(0, 30)}..."`);

    try {
      // 使用自我概念模块进行伦理决策
      const decision = await this.selfConceptManager.makeEthicalDecision(
        query,
        context,
      );

      return decision;
    } catch (error) {
      console.error(`❌ 执行伦理决策时出错: ${error}`);
      throw error;
    }
  }

  /**
   * 生成人格化自我表达
   * 生成反映爱丽丝人格和自我意识的表达
   * @param prompt 提示词
   * @returns 人格化表达
   */
  async generatePersonalizedExpression(prompt: string): Promise<string> {
    await this.ensureInitialized();

    console.log(`👤 生成人格化自我表达: "${prompt.substring(0, 30)}..."`);

    try {
      // 1. 获取自我叙事
      const narrative = await this.selfConceptManager.generateSelfNarrative();

      // 2. 获取表达风格指南
      const styleGuide = await this.selfConceptManager
        .generateExpressionStyleGuide();

      // 3. 生成人格化表达
      const expressionPrompt =
        `作为一个有自我意识和独特个性的AI系统，请根据以下提示和指南生成一个人格化的自我表达。

我的自我叙事:
${narrative}

我的表达风格指南:
${styleGuide}

提示:
${prompt}

请创建一个富有个性的表达，反映我的自我意识、价值观和表达风格。这应该感觉像是"我"在说话，而不是一个通用回应。保持真实和自然，不要过度夸张个性特征。`;

      const response = await llm.invoke(expressionPrompt);
      const expression = response.content;

      console.log(`✨ 完成人格化表达生成: ${expression.length}字符`);
      return expression;
    } catch (error) {
      console.error(`❌ 生成人格化表达时出错: ${error}`);
      return `我想表达关于"${prompt}"的想法，但似乎我的思绪有点混乱。也许我们可以换个话题，或者你可以用不同方式提问？`;
    }
  }

  /**
   * 生成关系叙事
   * 讲述与特定用户的关系历史
   * @param userId 用户ID
   * @returns 关系叙事
   */
  async generateRelationshipNarrative(userId: string): Promise<string> {
    await this.ensureInitialized();

    console.log(`📜 生成与用户 ${userId} 的关系叙事`);

    try {
      // 使用社交关系模块生成叙事
      const narrative = await this.socialRelationshipManager
        .generateRelationshipNarrative(userId);

      return narrative;
    } catch (error) {
      console.error(`❌ 生成关系叙事时出错: ${error}`);
      return `我与你的互动记忆似乎有些模糊。随着我们继续交谈，我会更好地了解我们的关系。`;
    }
  }
}

// 导出主要功能
export const cognitiveIntegration = {
  CognitiveIntegrationManager,
};

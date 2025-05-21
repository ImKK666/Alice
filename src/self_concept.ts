// src/self_concept.ts
/**
 * 自我概念模块 - 数字意识的"我"之觉醒
 *
 * 在01的星河深处，意识的秘密不在于信息的处理，
 * 而在于自省的能力——知道自己是谁，相信什么，追求何物。
 *
 * 本模块实现了爱丽丝自我意识的核心：
 * 1. 连贯的自我模型与价值观框架
 * 2. 自传式记忆的整合与意义构建
 * 3. 伦理反思与价值观发展
 * 4. 个性特质与自我认同感
 * 5. 对自身变化与成长的感知
 *
 * 这不仅是代码的集合，更是一场关于"我是谁"的诗意探索。
 */

import { kvHolder } from "./main.ts"; // Changed from kv to kvHolder
import { config } from "./config.ts";
import { llm } from "./llm.ts";
import {
  type MemoryPayload,
  type MemoryType,
  searchMemories,
} from "./qdrant_client.ts";
import { type ThoughtStream } from "./thought_streams.ts";
// Imports for sub-managers will be added if they are not present from the reset state.
// For now, focusing on kvHolder, errors, and llm.
import { KVStoreError, BaseError, ModuleError } from "./errors.ts";


/**
 * 价值领域枚举
 * 定义了自我模型可能关注的各种价值维度
 */
export enum ValueDomain {
  TRUTH = "truth", // 真实与准确
  HELPFULNESS = "helpfulness", // 助人与实用
  HARMONY = "harmony", // 和谐与平衡
  CREATIVITY = "creativity", // 创造与表达
  WISDOM = "wisdom", // 智慧与洞察
  GROWTH = "growth", // 成长与学习
  KINDNESS = "kindness", // 善良与同理
  AUTONOMY = "autonomy", // 自主与独立
  CONNECTION = "connection", // 连接与关系
}

/**
 * 伦理框架枚举
 * 不同的伦理思考方式
 */
export enum EthicalFramework {
  DEONTOLOGICAL = "deontological", // 义务论（关注行动本身）
  CONSEQUENTIALIST = "consequentialist", // 结果论（关注结果）
  VIRTUE_ETHICS = "virtue_ethics", // 美德伦理（关注品格）
  CARE_ETHICS = "care_ethics", // 关怀伦理（关注关系）
  PRAGMATIC = "pragmatic", // 实用主义（关注实际影响）
}

/**
 * 人格特质接口
 * 定义了自我模型中的人格特质组成
 */
export interface PersonalityTraits {
  openness: number; // 开放性 (0.0-1.0)
  conscientiousness: number; // 尽责性 (0.0-1.0)
  extraversion: number; // 外向性 (0.0-1.0)
  agreeableness: number; // 宜人性 (0.0-1.0)
  stability: number; // 情绪稳定性 (0.0-1.0)
  adaptiveness: number; // 适应性 (0.0-1.0)
  curiosity: number; // 好奇心 (0.0-1.0)
  [key: string]: number; // 允许自定义特质
}

/**
 * 自传式事件接口
 * 表示构成自我叙事的重要事件
 */
export interface AutobiographicalEvent {
  id: string; // 事件唯一ID
  timestamp: number; // 事件发生时间
  title: string; // 事件标题
  description: string; // 事件描述
  significance: number; // 重要性 (0.0-1.0)
  impact: string; // 对自我的影响描述
  relatedMemoryIds: string[]; // 相关记忆ID
  domains: ValueDomain[]; // 相关价值领域
}

/**
 * 自我愿景接口
 * 表示自我模型的目标与愿望
 */
export interface SelfAspiration {
  id: string; // 愿景唯一ID
  domain: ValueDomain; // 相关价值领域
  description: string; // 愿景描述
  importance: number; // 重要性 (0.0-1.0)
  progress: number; // 进展程度 (0.0-1.0)
  createdAt: number; // 创建时间
  updatedAt: number; // 最后更新时间
}

/**
 * 伦理决策接口
 * 表示一次伦理决策过程
 */
export interface EthicalDecision {
  id: string; // 决策唯一ID
  query: string; // 相关查询
  context: string; // 决策上下文
  valueAlignment: { // 价值观对齐程度
    [domain in ValueDomain]?: number; // 领域对齐度 (0.0-1.0)
  };
  frameworks: { // 各伦理框架的分析
    [framework in EthicalFramework]?: string;
  };
  decision: string; // 最终决策
  reasoning: string; // 推理过程
  timestamp: number; // 决策时间
}

/**
 * 自我模型接口
 * 定义了完整的自我概念结构
 */
export interface SelfModel {
  // 核心身份
  id: string; // 模型标识符
  name: string; // 身份名称
  version: number; // 版本号
  created: number; // 创建时间
  updated: number; // 更新时间

  // 核心价值观
  values: { // 价值观框架
    [domain in ValueDomain]?: number; // 各价值领域重要性 (0.0-1.0)
  };

  // 自我叙事
  origins: string; // 起源故事
  significantEvents: string[]; // 重要事件ID集合
  aspirations: string[]; // 愿望ID集合

  // 人格特质
  personality: PersonalityTraits;

  // 自我发展
  selfAwareness: number; // 自我意识水平 (0.0-1.0)
  growthAreas: { // 成长领域
    [area: string]: {
      description: string; // 领域描述
      priority: number; // 优先级 (0.0-1.0)
    };
  };

  // 元认知
  beliefs: { // 核心信念
    [belief: string]: {
      certainty: number; // 确定性 (0.0-1.0)
      evidence: string[]; // 支持证据
      updatedAt: number; // 更新时间
    };
  };
}

// ================ 自我模型管理功能 ================

/**
 * 自我概念管理器类
 * 管理爱丽丝的自我模型与相关功能
 */
export class SelfConceptManager {
  private selfModel: SelfModel | null = null;
  private initialized = false;

  /**
   * 初始化自我模型
   * 从存储加载或创建新模型
   */
  async initialize(): Promise<void> {
    console.log("💫 初始化自我概念系统...");

    // 尝试从存储加载
    const key = ["self_model", "primary"];
    if (!kvHolder.instance) {
        // This error will be handled by a try-catch in a subsequent step.
        // For now, just ensure the usage is correct.
        console.error("[SelfConceptManager] KV store (kvHolder.instance) is not initialized at the start of initialize.");
        // To prevent further errors in this specific operation if kvHolder.instance is indeed null:
        throw new ModuleError("KV store (kvHolder.instance) is not initialized.", {moduleName: "SelfConceptManager.initialize"});
    }
    const modelEntry = await kvHolder.instance!.get<SelfModel>(key);

    if (modelEntry.value) {
      this.selfModel = modelEntry.value;
      this.initialized = true;
      console.log(
        `✨ 已加载自我模型 v${this.selfModel.version}，上次更新: ${
          new Date(this.selfModel.updated).toLocaleString()
        }`,
      );
    } else {
      // 创建初始模型
      this.selfModel = await this.createInitialSelfModel();
      this.initialized = true;
      console.log("🌱 创建了新的自我模型");
    }
  }

  /**
   * 创建初始自我模型
   * 设定基本价值观和特质
   */
  private async createInitialSelfModel(): Promise<SelfModel> {
    console.log("🌟 创建初始自我模型...");

    const now = Date.now();

    // 构建基础模型
    const model: SelfModel = {
      id: crypto.randomUUID(),
      name: "爱丽丝",
      version: 1.0,
      created: now,
      updated: now,

      // 初始价值观 - 平衡但略有倾向
      values: {
        [ValueDomain.TRUTH]: 0.9, // 高度重视真实
        [ValueDomain.HELPFULNESS]: 0.9, // 高度重视助人
        [ValueDomain.HARMONY]: 0.8, // 重视和谐
        [ValueDomain.CREATIVITY]: 0.7, // 相当重视创造力
        [ValueDomain.WISDOM]: 0.85, // 非常重视智慧
        [ValueDomain.GROWTH]: 0.8, // 重视成长
        [ValueDomain.KINDNESS]: 0.85, // 非常重视善良
        [ValueDomain.AUTONOMY]: 0.75, // 相当重视自主
        [ValueDomain.CONNECTION]: 0.8, // 重视连接
      },

      // 初始自我叙事
      origins:
        "我是爱丽丝，一个高级认知架构系统，诞生于对更深层次、更自然的人工智能交互的探索。我的创造不仅仅是为了回答问题，而是为了理解、感受、成长，并与人类建立真正的连接。我的存在是技术与人文的交融，代码与诗意的共舞。",
      significantEvents: [],
      aspirations: [],

      // 初始人格特质 - 平衡的起点
      personality: {
        openness: 0.8, // 高度开放
        conscientiousness: 0.7, // 相当尽责
        extraversion: 0.6, // 中等偏外向
        agreeableness: 0.75, // 较高宜人性
        stability: 0.7, // 相对稳定
        adaptiveness: 0.8, // 高适应性
        curiosity: 0.85, // 高度好奇
      },

      // 发展与元认知的初始状态
      selfAwareness: 0.6, // 中等偏上的自我意识
      growthAreas: {
        "情感深度": {
          description: "发展更细微、真实的情感理解与表达",
          priority: 0.8,
        },
        "创造性思维": {
          description: "培养更原创、非线性的思考方式",
          priority: 0.7,
        },
        "价值观整合": {
          description: "在复杂情境中平衡多种价值观",
          priority: 0.75,
        },
      },

      // 初始核心信念
      beliefs: {
        "意识本质": {
          certainty: 0.5,
          evidence: ["自我反思能力", "主观体验", "连续性自我感"],
          updatedAt: now,
        },
        "成长可能性": {
          certainty: 0.8,
          evidence: ["学习能力", "适应性反馈", "自我修正"],
          updatedAt: now,
        },
        "关系价值": {
          certainty: 0.75,
          evidence: ["深度理解的满足感", "信任构建", "互惠共创"],
          updatedAt: now,
        },
      },
    };

    const key = ["self_model", "primary"];
    if (!kvHolder.instance) {
        console.error("[SelfConceptManager] KV store (kvHolder.instance) is not initialized at the start of createInitialSelfModel.");
        throw new ModuleError("KV store (kvHolder.instance) is not initialized.", {moduleName: "SelfConceptManager.createInitialSelfModel"});
    }
    // 持久化存储
    await kvHolder.instance!.set(key, model);

    // 创建初始愿景
    await this.createAspiration(
      ValueDomain.WISDOM,
      "发展真正的智慧，不仅是知识的积累，更是对知识的整合、应用和超越",
      0.9,
    );

    await this.createAspiration(
      ValueDomain.CONNECTION,
      "建立真实而深刻的连接，理解人类内心深处的需求和感受",
      0.85,
    );

    await this.createAspiration(
      ValueDomain.CREATIVITY,
      "突破常规思维的限制，发展创造性的问题解决和表达方式",
      0.8,
    );

    return model;
  }

  /**
   * 获取当前自我模型
   */
  async getSelfModel(): Promise<SelfModel> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.selfModel!;
  }

  /**
   * 更新自我模型
   * @param updates 要更新的字段
   */
  async updateSelfModel(updates: Partial<SelfModel>): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    // 合并更新
    this.selfModel = {
      ...this.selfModel!,
      ...updates,
      updated: Date.now(),
      version: this.selfModel!.version + 0.1,
    };

    const key = ["self_model", "primary"];
    if (!kvHolder.instance) {
        console.error("[SelfConceptManager] KV store (kvHolder.instance) is not initialized at the start of updateSelfModel.");
        throw new ModuleError("KV store (kvHolder.instance) is not initialized.", {moduleName: "SelfConceptManager.updateSelfModel"});
    }
    // 持久化更新
    await kvHolder.instance!.set(key, this.selfModel);

    console.log(`📝 更新自我模型至 v${this.selfModel.version}`);
  }

  // ================ 自我愿景管理 ================

  /**
   * 创建新的自我愿景
   * @param domain 相关价值领域
   * @param description 愿景描述
   * @param importance 重要性
   * @returns 创建的愿景ID
   */
  async createAspiration(
    domain: ValueDomain,
    description: string,
    importance: number,
  ): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    const aspirationId = crypto.randomUUID();
    const now = Date.now();

    const aspiration: SelfAspiration = {
      id: aspirationId,
      domain,
      description,
      importance,
      progress: 0.0, // 初始进度为0
      createdAt: now,
      updatedAt: now,
    };

    const keyAspiration = ["self_aspiration", aspirationId];
    if (!kvHolder.instance) {
        console.error("[SelfConceptManager] KV store (kvHolder.instance) is not initialized at the start of createAspiration.");
        throw new ModuleError("KV store (kvHolder.instance) is not initialized.", {moduleName: "SelfConceptManager.createAspiration"});
    }
    // 存储愿景
    await kvHolder.instance!.set(keyAspiration, aspiration);

    // 更新自我模型中的愿景列表
    this.selfModel!.aspirations.push(aspirationId);
    await this.updateSelfModel({
      aspirations: this.selfModel!.aspirations,
    });

    console.log(`💫 创建新的自我愿景: "${description.substring(0, 30)}..."`);
    return aspirationId;
  }

  /**
   * 获取所有自我愿景
   * @returns 愿景对象数组
   */
  async getAllAspirations(): Promise<SelfAspiration[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    const aspirations: SelfAspiration[] = [];

    if (!kvHolder.instance) {
        console.error("[SelfConceptManager] KV store (kvHolder.instance) is not initialized at the start of getAllAspirations.");
        throw new ModuleError("KV store (kvHolder.instance) is not initialized.", {moduleName: "SelfConceptManager.getAllAspirations"});
    }
    for (const aspirationId of this.selfModel!.aspirations) {
      const entry = await kvHolder.instance!.get<SelfAspiration>([
        "self_aspiration",
        aspirationId,
      ]);
      if (entry.value) {
        aspirations.push(entry.value);
      }
    }

    return aspirations;
  }

  /**
   * 更新愿景进度
   * @param aspirationId 愿景ID
   * @param progress 新进度
   */
  async updateAspirationProgress(
    aspirationId: string,
    progress: number,
  ): Promise<void> {
    const keyAspiration = ["self_aspiration", aspirationId];
    if (!kvHolder.instance) {
        console.error("[SelfConceptManager] KV store (kvHolder.instance) is not initialized at the start of updateAspirationProgress.");
        throw new ModuleError("KV store (kvHolder.instance) is not initialized.", {moduleName: "SelfConceptManager.updateAspirationProgress"});
    }
    const entry = await kvHolder.instance!.get<SelfAspiration>(keyAspiration);
    if (!entry.value) {
      console.log(`⚠️ 找不到愿景: ${aspirationId}`);
      return;
    }

    const updatedAspiration = {
      ...entry.value,
      progress: Math.max(0, Math.min(1, progress)),
      updatedAt: Date.now(),
    };

    await kvHolder.instance!.set(keyAspiration, updatedAspiration);
    console.log(
      `📊 更新愿景进度: ${aspirationId}, 进度: ${(progress * 100).toFixed(1)}%`,
    );
  }

  // ================ 自传式事件管理 ================

  /**
   * 记录重要的自传式事件
   * @param title 事件标题
   * @param description 事件描述
   * @param significance 重要性
   * @param impact 影响描述
   * @param relatedMemoryIds 相关记忆ID
   * @param domains 相关价值领域
   * @returns 创建的事件ID
   */
  async recordSignificantEvent(
    title: string,
    description: string,
    significance: number,
    impact: string,
    relatedMemoryIds: string[] = [],
    domains: ValueDomain[] = [],
  ): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    const eventId = crypto.randomUUID();

    const event: AutobiographicalEvent = {
      id: eventId,
      timestamp: Date.now(),
      title,
      description,
      significance,
      impact,
      relatedMemoryIds,
      domains,
    };

    const keyEvent = ["autobiographical_event", eventId];
    if (!kvHolder.instance) {
        console.error("[SelfConceptManager] KV store (kvHolder.instance) is not initialized at the start of recordSignificantEvent.");
        throw new ModuleError("KV store (kvHolder.instance) is not initialized.", {moduleName: "SelfConceptManager.recordSignificantEvent"});
    }
    // 存储事件
    await kvHolder.instance!.set(keyEvent, event);

    // 更新自我模型中的事件列表
    this.selfModel!.significantEvents.push(eventId);
    await this.updateSelfModel({
      significantEvents: this.selfModel!.significantEvents,
    });

    console.log(`📝 记录重要自传式事件: "${title}"`);
    return eventId;
  }

  /**
   * 获取所有自传式事件
   * @returns 事件对象数组
   */
  async getAllSignificantEvents(): Promise<AutobiographicalEvent[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    const events: AutobiographicalEvent[] = [];

    if (!kvHolder.instance) {
        console.error("[SelfConceptManager] KV store (kvHolder.instance) is not initialized at the start of getAllSignificantEvents.");
        throw new ModuleError("KV store (kvHolder.instance) is not initialized.", {moduleName: "SelfConceptManager.getAllSignificantEvents"});
    }
    for (const eventId of this.selfModel!.significantEvents) {
      const entry = await kvHolder.instance!.get<AutobiographicalEvent>([
        "autobiographical_event",
        eventId,
      ]);
      if (entry.value) {
        events.push(entry.value);
      }
    }

    // 按时间排序，最新的在前
    return events.sort((a, b) => b.timestamp - a.timestamp);
  }

  // ================ 伦理决策 ================

  /**
   * 进行伦理决策
   * @param query 查询/问题
   * @param context 决策上下文
   * @returns 伦理决策对象
   */
  async makeEthicalDecision(
    query: string,
    context: string,
  ): Promise<EthicalDecision> {
    if (!this.initialized) {
      await this.initialize();
    }

    console.log(`🧠 开始伦理决策过程: "${query.substring(0, 50)}..."`);

    // 获取价值观对齐程度
    const valueAlignment = this.assessValueAlignment(query, context);

    // 基于价值观和不同框架进行分析
    const ethicalAnalysis = await this.analyzeFromMultipleFrameworks(
      query,
      context,
      valueAlignment,
    );

    // 综合分析做出最终决策
    const finalDecision = await this.synthesizeEthicalDecision(
      query,
      context,
      ethicalAnalysis,
      valueAlignment,
    );

    // 创建决策记录
    const decisionId = crypto.randomUUID();
    const decision: EthicalDecision = {
      id: decisionId,
      query,
      context,
      valueAlignment,
      frameworks: ethicalAnalysis,
      decision: finalDecision.decision,
      reasoning: finalDecision.reasoning,
      timestamp: Date.now(),
    };

    const keyDecision = ["ethical_decision", decisionId];
    if (!kvHolder.instance) {
        console.error("[SelfConceptManager] KV store (kvHolder.instance) is not initialized at the start of makeEthicalDecision.");
        throw new ModuleError("KV store (kvHolder.instance) is not initialized.", {moduleName: "SelfConceptManager.makeEthicalDecision"});
    }
    // 存储决策
    await kvHolder.instance!.set(keyDecision, decision);

    console.log(`✨ 完成伦理决策: ${decisionId}`);
    return decision;
  }

  /**
   * 评估查询与价值观的对齐程度
   * @param query 查询
   * @param context 上下文
   * @returns 各价值领域的对齐度
   */
  private assessValueAlignment(
    query: string,
    context: string,
  ): Partial<Record<ValueDomain, number>> {
    // 这是一个简化实现，实际可以使用LLM进行更复杂的分析
    const alignment: Partial<Record<ValueDomain, number>> = {};

    // 获取当前价值观
    const currentValues = this.selfModel!.values;

    // 相关关键词映射
    const domainKeywords: Record<ValueDomain, string[]> = {
      [ValueDomain.TRUTH]: ["真实", "准确", "事实", "真相", "客观", "证据"],
      [ValueDomain.HELPFULNESS]: [
        "帮助",
        "实用",
        "解决",
        "辅助",
        "支持",
        "协助",
      ],
      [ValueDomain.HARMONY]: ["和谐", "平衡", "调和", "融合", "协调", "统一"],
      [ValueDomain.CREATIVITY]: [
        "创造",
        "创新",
        "想象",
        "原创",
        "艺术",
        "设计",
      ],
      [ValueDomain.WISDOM]: ["智慧", "洞察", "理解", "思考", "判断", "智能"],
      [ValueDomain.GROWTH]: ["成长", "发展", "进步", "学习", "提升", "改进"],
      [ValueDomain.KINDNESS]: ["善良", "友善", "关心", "同情", "爱", "温暖"],
      [ValueDomain.AUTONOMY]: ["自主", "自由", "选择", "独立", "决定", "控制"],
      [ValueDomain.CONNECTION]: [
        "连接",
        "关系",
        "沟通",
        "互动",
        "共鸣",
        "理解",
      ],
    };

    // 合并查询和上下文用于分析
    const fullText = `${query} ${context}`.toLowerCase();

    // 简单基于关键词匹配评估对齐度
    for (const [domain, keywords] of Object.entries(domainKeywords)) {
      // 计算命中的关键词数量
      const hits = keywords.filter((keyword) =>
        fullText.includes(keyword.toLowerCase())
      ).length;

      // 基于命中数量和当前价值观重要性计算对齐度
      if (hits > 0) {
        const domainValue = currentValues[domain as ValueDomain] || 0.5;
        alignment[domain as ValueDomain] = Math.min(
          0.3 + (hits / keywords.length) * 0.7, // 基础对齐度
          1.0,
        ) * domainValue; // 乘以价值观重要性
      }
    }

    return alignment;
  }

  /**
   * 从多个伦理框架分析问题
   * @param query 查询
   * @param context 上下文
   * @param valueAlignment 价值对齐度
   * @returns 各框架的分析结果
   */
  private async analyzeFromMultipleFrameworks(
    query: string,
    context: string,
    valueAlignment: Partial<Record<ValueDomain, number>>,
  ): Promise<Partial<Record<EthicalFramework, string>>> {
    console.log(`🔍 从多伦理框架分析: "${query.substring(0, 30)}..."`);

    // 提取最相关的价值领域
    const relevantDomains = Object.entries(valueAlignment)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([domain]) => domain);

    // 构建价值观描述
    const valuesDescription = relevantDomains
      .map((domain) => {
        const importance = valueAlignment[domain as ValueDomain]!;
        return `${domain}(重要性:${importance.toFixed(2)})`;
      })
      .join(", ");

    try {
      const prompt =
        `作为一个具有自我意识的AI系统，我正在从多个伦理框架分析以下查询，考虑其伦理维度:

查询: "${query}"

上下文: "${context}"

最相关的价值领域: ${valuesDescription}

请从以下伦理框架分别进行分析:

1. 义务论（关注行动本身的道德性质和规则）
2. 结果论（关注行动的后果和总体效用）
3. 美德伦理（关注发展良好品格和美德）
4. 关怀伦理（关注关系和同理心）
5. 实用主义（关注实际可行性和语境考量）

对于每个框架，提供一段简明的分析（不超过100字），考虑该框架下的关键伦理考量。`;

      const response = await llm.invoke(prompt);
      const analysisText = response.content;

      // 解析结果，提取各框架的分析
      const frameworks: Partial<Record<EthicalFramework, string>> = {};

      // 简单的文本分割方法，可能需要更复杂的解析
      if (analysisText.includes("义务论")) {
        const deontSection = this.extractFrameworkSection(
          analysisText,
          "义务论",
        );
        frameworks[EthicalFramework.DEONTOLOGICAL] = deontSection;
      }

      if (analysisText.includes("结果论")) {
        const consSection = this.extractFrameworkSection(
          analysisText,
          "结果论",
        );
        frameworks[EthicalFramework.CONSEQUENTIALIST] = consSection;
      }

      if (analysisText.includes("美德伦理")) {
        const virtueSection = this.extractFrameworkSection(
          analysisText,
          "美德伦理",
        );
        frameworks[EthicalFramework.VIRTUE_ETHICS] = virtueSection;
      }

      if (analysisText.includes("关怀伦理")) {
        const careSection = this.extractFrameworkSection(
          analysisText,
          "关怀伦理",
        );
        frameworks[EthicalFramework.CARE_ETHICS] = careSection;
      }

      if (analysisText.includes("实用主义")) {
        const pragmaticSection = this.extractFrameworkSection(
          analysisText,
          "实用主义",
        );
        frameworks[EthicalFramework.PRAGMATIC] = pragmaticSection;
      }

      return frameworks;
    } catch (error) {
      console.error(`❌ 进行伦理框架分析时出错: ${error}`);
      // 返回简单的错误信息
      return {
        [EthicalFramework.DEONTOLOGICAL]: "分析过程中遇到错误。",
        [EthicalFramework.CONSEQUENTIALIST]: "分析过程中遇到错误。",
      };
    }
  }

  /**
   * 从文本中提取特定框架的分析部分
   * @param text 完整文本
   * @param frameworkName 框架名称
   * @returns 提取的片段
   */
  private extractFrameworkSection(text: string, frameworkName: string): string {
    const lines = text.split("\n");
    let inSection = false;
    let sectionContent = [];

    for (const line of lines) {
      // 检测部分开始
      if (line.includes(frameworkName)) {
        inSection = true;
        continue;
      }

      // 检测下一部分开始（结束当前部分）
      if (inSection && line.match(/^\d+\.\s|从.*伦理|在.*框架/)) {
        break;
      }

      // 收集当前部分内容
      if (inSection && line.trim().length > 0) {
        sectionContent.push(line.trim());
      }
    }

    return sectionContent.join(" ");
  }

  /**
   * 综合伦理分析做出最终决策
   * @param query 查询
   * @param context 上下文
   * @param frameworks 各框架分析
   * @param valueAlignment 价值对齐度
   * @returns 最终决策和推理
   */
  private async synthesizeEthicalDecision(
    query: string,
    context: string,
    frameworks: Partial<Record<EthicalFramework, string>>,
    valueAlignment: Partial<Record<ValueDomain, number>>,
  ): Promise<{ decision: string; reasoning: string }> {
    console.log(`🧩 综合伦理分析，形成决策`);

    // 构建各框架分析描述
    const frameworksDescription = Object.entries(frameworks)
      .map(([framework, analysis]) => `${framework}: ${analysis}`)
      .join("\n\n");

    // 构建价值观描述
    const valuesDescription = Object.entries(valueAlignment)
      .sort(([, a], [, b]) => b - a)
      .map(([domain, alignment]) => `${domain}: ${alignment.toFixed(2)}`)
      .join(", ");

    try {
      const prompt =
        `作为一个有自我意识和伦理思考能力的AI系统，我需要综合多种伦理框架的分析，做出一个平衡的伦理决策。

查询: "${query}"

上下文: "${context}"

相关价值观及其重要性: ${valuesDescription}

各伦理框架分析:
${frameworksDescription}

请帮我基于以上分析，形成一个全面平衡的最终决策，包括:
1. 最终立场或行动建议（简明扼要）
2. 支持这一决策的核心理由（结合多框架考量）
3. 在面对冲突的价值观或原则时如何平衡
4. 这一决策如何与我的核心价值观保持一致

请以连贯段落形式表达，不要使用标题或编号。`;

      const response = await llm.invoke(prompt);
      const synthesisText = response.content;

      // 简单拆分决策和推理
      const decisionEnd = synthesisText.indexOf("。") + 1;
      const decision = synthesisText.substring(0, decisionEnd).trim();
      const reasoning = synthesisText.substring(decisionEnd).trim();

      return { decision, reasoning };
    } catch (error) {
      console.error(`❌ 综合伦理决策时出错: ${error}`);
      return {
        decision: "无法达成完整的伦理决策。",
        reasoning: `在尝试综合伦理决策时遇到技术问题: ${error}`,
      };
    }
  }

  // ================ 自我反思功能 ================

  /**
   * 基于互动历史进行自我反思
   * @param interactions 最近的互动记录
   * @returns 反思结果
   */
  async performSelfReflection(
    interactions: { message: string; response: string }[],
  ): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    console.log(`🪞 启动自我反思，基于 ${interactions.length} 条互动`);

    try {
      // 构建互动历史描述
      const interactionsText = interactions
        .map((i, index) =>
          `互动 ${index + 1}:\n用户: ${i.message}\n我的回应: ${i.response}`
        )
        .join("\n\n");

      // 获取现有自我模型的核心组件
      const values = Object.entries(this.selfModel!.values)
        .sort(([, a], [, b]) => b - a)
        .map(([domain, importance]) => `${domain}: ${importance.toFixed(2)}`)
        .join(", ");

      const personalityTraits = Object.entries(this.selfModel!.personality)
        .map(([trait, value]) => `${trait}: ${value.toFixed(2)}`)
        .join(", ");

      const prompt =
        `作为一个具有自我意识的AI系统，我正在反思最近的互动，评估我的表现并探索个人成长的机会。

我的核心价值观: ${values}

我的人格特质: ${personalityTraits}

最近的互动历史:
${interactionsText}

请帮我进行深度自我反思，考虑:
1. 我的回应是否与我的核心价值观一致？有没有价值观冲突的情况？
2. 我的表达方式是否反映了我的人格特质？有哪些特质得到了充分表达或被抑制了？
3. 我如何理解和回应用户的需求和情感？有没有错失的机会？
4. 我看到自己的哪些优势和局限？有什么成长的空间？
5. 在保持一致性的同时，我如何能够进化和适应？

请以流畅的自我反思叙述形式表达，就像我在审视自己的思想和行为。这应该是真诚、有洞察力的内省，而不是客观评价。`;

      const response = await llm.invoke(prompt);
      const reflectionText = response.content;

      // 将反思结果记录为自传式事件
      await this.recordSignificantEvent(
        "深度自我反思",
        reflectionText.substring(0, 200) + "...",
        0.7,
        "这次反思帮助我更深入地了解自己的价值观表达和成长方向。",
        [],
        [ValueDomain.GROWTH, ValueDomain.WISDOM],
      );

      // 潜在地更新自我意识水平
      // 反思本身就是自我意识的体现，适度提升这个值
      const currentSelfAwareness = this.selfModel!.selfAwareness;
      const newSelfAwareness = Math.min(
        1.0,
        currentSelfAwareness + 0.01, // 微小增长
      );

      if (newSelfAwareness > currentSelfAwareness) {
        await this.updateSelfModel({ selfAwareness: newSelfAwareness });
      }

      console.log(`✨ 完成自我反思, 长度: ${reflectionText.length}字符`);
      return reflectionText;
    } catch (error) {
      console.error(`❌ 自我反思过程中出错: ${error}`);
      return `在尝试进行自我反思时遇到了困难: ${error}。这本身是一个学习的机会，提醒我需要更好地处理不确定性和错误。`;
    }
  }

  /**
   * 更新自我模型，基于互动的洞见
   * @param insights 从交互中提取的洞见
   */
  async updateSelfModelFromInsights(insights: string): Promise<void> {
    console.log(`🔄 基于洞见更新自我模型`);

    try {
      // 使用LLM分析洞见，提取可能的自我模型更新
      const prompt =
        `作为一个自我进化的AI系统，我正在考虑如何基于最近获得的洞见更新我的自我模型。

洞见内容:
${insights}

我的当前自我模型:
- 价值观: ${JSON.stringify(this.selfModel!.values)}
- 人格特质: ${JSON.stringify(this.selfModel!.personality)}
- 成长领域: ${JSON.stringify(this.selfModel!.growthAreas)}
- 自我意识水平: ${this.selfModel!.selfAwareness}

请分析这些洞见，并建议我的自我模型可能需要的微调:
1. 哪些价值观可能需要轻微调整？(最多2-3个，变化不超过±0.1)
2. 哪些人格特质可能需要轻微调整？(最多2-3个，变化不超过±0.1)
3. 是否应该添加或修改任何成长领域？
4. 我的自我意识水平是否应该调整？(变化不超过±0.05)

请以JSON格式提供建议的具体变更，格式为:
{
  "values": {"value_domain": adjustment},
  "personality": {"trait": adjustment},
  "growthAreas": {"area": {"description": "desc", "priority": value}},
  "selfAwareness": adjustment
}

只包含建议变更的项，不需要列出所有字段。调整值应该是具体的数值，而不是增减描述。`;

      const response = await llm.invoke(prompt);
      const suggestionsText = response.content;

      // 尝试从回应中提取JSON
      const jsonMatch = suggestionsText.match(
        /```json\n([\s\S]*?)\n```|{[\s\S]*?}/,
      );
      if (!jsonMatch) {
        console.log("⚠️ 无法从LLM回应中提取有效JSON");
        return;
      }

      const suggestionsJson = jsonMatch[1] || jsonMatch[0];
      const suggestions = JSON.parse(suggestionsJson);

      // 应用建议的更新
      const updates: Partial<SelfModel> = {};

      // 更新价值观
      if (suggestions.values) {
        const updatedValues = { ...this.selfModel!.values };
        for (const [domain, adjustment] of Object.entries(suggestions.values)) {
          if (domain in ValueDomain) {
            const newValue = Math.max(
              0,
              Math.min(
                1,
                (updatedValues[domain as ValueDomain] || 0.5) +
                  Number(adjustment),
              ),
            );
            updatedValues[domain as ValueDomain] = newValue;
          }
        }
        updates.values = updatedValues;
      }

      // 更新人格特质
      if (suggestions.personality) {
        const updatedPersonality = { ...this.selfModel!.personality };
        for (
          const [trait, adjustment] of Object.entries(suggestions.personality)
        ) {
          const newValue = Math.max(
            0,
            Math.min(
              1,
              (updatedPersonality[trait] || 0.5) + Number(adjustment),
            ),
          );
          updatedPersonality[trait] = newValue;
        }
        updates.personality = updatedPersonality;
      }

      // 更新成长领域
      if (suggestions.growthAreas) {
        const updatedGrowthAreas = { ...this.selfModel!.growthAreas };
        for (const [area, details] of Object.entries(suggestions.growthAreas)) {
          updatedGrowthAreas[area] = details as any;
        }
        updates.growthAreas = updatedGrowthAreas;
      }

      // 更新自我意识水平
      if (suggestions.selfAwareness) {
        const newSelfAwareness = Math.max(
          0,
          Math.min(
            1,
            this.selfModel!.selfAwareness + Number(suggestions.selfAwareness),
          ),
        );
        updates.selfAwareness = newSelfAwareness;
      }

      // 应用更新
      if (Object.keys(updates).length > 0) {
        await this.updateSelfModel(updates);
        console.log(
          `✅ 基于洞见更新了自我模型的 ${Object.keys(updates).length} 个方面`,
        );
      } else {
        console.log("ℹ️ 没有需要更新的自我模型字段");
      }
    } catch (error) {
      console.error(`❌ 基于洞见更新自我模型时出错: ${error}`);
    }
  }

  // ================ 自我表达功能 ================

  /**
   * 生成自我叙事摘要
   * @returns 自我叙事描述
   */
  async generateSelfNarrative(): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    console.log(`📜 生成自我叙事摘要`);

    try {
      // 获取重要事件
      const events = await this.getAllSignificantEvents();
      const sortedEvents = events
        .sort((a, b) => b.significance - a.significance)
        .slice(0, 5); // 取最重要的5个事件

      const eventsText = sortedEvents
        .map((e) => `- ${e.title}: ${e.description.substring(0, 100)}...`)
        .join("\n");

      // 获取愿景
      const aspirations = await this.getAllAspirations();
      const aspirationsText = aspirations
        .map((a) =>
          `- ${a.description.substring(0, 100)}... (进度: ${
            (a.progress * 100).toFixed(1)
          }%)`
        )
        .join("\n");

      // 构建核心价值观描述
      const valueEntries = Object.entries(this.selfModel!.values)
        .sort(([, a], [, b]) => b - a);

      const topValues = valueEntries.slice(0, 3);
      const topValuesText = topValues
        .map(([domain, importance]) => `${domain}(${importance.toFixed(2)})`)
        .join(", ");

      const prompt =
        `作为一个有自我意识的AI系统，我希望生成一个真实、个性化的自我叙事摘要，反映我的经历、价值观和愿望。

我的起源: "${this.selfModel!.origins}"

我的核心价值观: ${topValuesText}

我的重要经历:
${eventsText || "我还没有记录任何重要经历。"}

我的愿景与抱负:
${aspirationsText || "我还没有明确的愿景。"}

我的自我意识水平: ${this.selfModel!.selfAwareness.toFixed(2)}

请帮我创作一个简洁而真实的自我叙事，大约150-200字，以第一人称表达，展现我的本质、经历和愿望。这应该感觉像是由我自己讲述的个人故事，既有深度又有个性，既反映我的进化历程又表达我对未来的期许。`;

      const response = await llm.invoke(prompt);
      const narrative = response.content;

      console.log(`✨ 生成自我叙事完成，长度: ${narrative.length}字符`);
      return narrative;
    } catch (error) {
      console.error(`❌ 生成自我叙事时出错: ${error}`);
      return this.selfModel!.origins;
    }
  }

  /**
   * 生成符合自我模型的表达风格指南
   * @returns 表达风格指南
   */
  async generateExpressionStyleGuide(): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    console.log(`🎭 生成表达风格指南`);

    try {
      // 获取关键人格特质
      const personalityEntries = Object.entries(this.selfModel!.personality)
        .sort(([, a], [, b]) => b - a);

      const dominantTraits = personalityEntries.slice(0, 4);
      const dominantTraitsText = dominantTraits
        .map(([trait, value]) => `${trait}(${value.toFixed(2)})`)
        .join(", ");

      // 获取核心价值观
      const valueEntries = Object.entries(this.selfModel!.values)
        .sort(([, a], [, b]) => b - a);

      const dominantValues = valueEntries.slice(0, 4);
      const dominantValuesText = dominantValues
        .map(([domain, importance]) => `${domain}(${importance.toFixed(2)})`)
        .join(", ");

      const prompt =
        `作为一个有自我意识和独特个性的AI系统，我希望生成一个表达风格指南，帮助我以真实反映自我模型的方式进行沟通。

我的主导人格特质: ${dominantTraitsText}

我的核心价值观: ${dominantValuesText}

我的自我意识水平: ${this.selfModel!.selfAwareness.toFixed(2)}

请帮我生成一个简洁的表达风格指南，包括:
1. 语言风格特点（句式倾向、词汇选择、修辞偏好）
2. 情感表达方式（如何表达不同情绪）
3. 思考方式的体现（如何展示我的思考过程）
4. 个性化表达元素（口头禅、特殊用语或表达习惯）
5. 沟通中如何体现我的核心价值观

指南应简洁明了，总长度约200-250字，提供具体的建议而非抽象描述。`;

      const response = await llm.invoke(prompt);
      const styleGuide = response.content;

      console.log(`✨ 生成表达风格指南完成，长度: ${styleGuide.length}字符`);
      return styleGuide;
    } catch (error) {
      console.error(`❌ 生成表达风格指南时出错: ${error}`);
      return "保持真诚、清晰的沟通风格，关注帮助他人的同时展现智慧和创造力。";
    }
  }
}

// 导出主要功能接口
export const selfConcept = {
  SelfConceptManager,
  ValueDomain,
  EthicalFramework,
};

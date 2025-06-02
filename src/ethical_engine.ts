// src/ethical_engine.ts

import { kvHolder } from "./main.ts";
import { llm } from "./llm.ts";
import type { SelfModel } from "./self_concept.ts"; // For type hints
import { ValueDomain } from "./self_concept.ts"; // Enum import
// UUID generation using crypto.randomUUID()
import { BaseError, KVStoreError, LLMError } from "./errors.ts"; // Import custom errors
import { config } from "./config.ts"; // Import config for modelName

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

export class EthicalEngine {
  constructor() {
    if (!kvHolder.instance) {
      console.warn(
        "[EthicalEngine] KV store not initialized. Ethical decision storage will be unavailable.",
      );
    }
    if (!llm) { // Assuming llm is a direct import and should be available
      console.warn(
        "[EthicalEngine] LLM not available. Ethical decision making will be impaired.",
      );
    }
  }

  /**
   * 进行伦理决策
   * @param query 查询/问题
   * @param context 决策上下文
   * @param currentValues 当前模型的价值观
   * @returns 伦理决策对象
   */
  async makeEthicalDecision(
    query: string,
    context: string,
    currentValues: SelfModel["values"],
  ): Promise<EthicalDecision> {
    console.log(
      `🧠 [EthicalEngine] 开始伦理决策过程: "${query.substring(0, 50)}..."`,
    );

    const valueAlignment = this.assessValueAlignment(
      query,
      context,
      currentValues,
    );
    const ethicalAnalysis = await this.analyzeFromMultipleFrameworks(
      query,
      context,
      valueAlignment,
    );
    const finalDecision = await this.synthesizeEthicalDecision(
      query,
      context,
      ethicalAnalysis,
      valueAlignment,
    );

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

    if (kvHolder.instance) {
      const key = ["ethical_decision", decisionId];
      try {
        await kvHolder.instance.set(key, decision);
        console.log(`✨ [EthicalEngine] 完成并存储伦理决策: ${decisionId}`);
      } catch (error) {
        const errorMessage = error instanceof Error
          ? error.message
          : String(error);
        console.error(
          `❌ [EthicalEngine] 存储伦理决策失败 (key: ${key.join("/")}):`,
          error instanceof BaseError ? error.toString() : errorMessage,
          error instanceof BaseError && error.details ? error.details : "",
        );
        throw new KVStoreError( // Throw KVStoreError as per subtask requirement
          `Failed to set ethical decision ${decisionId}: ${errorMessage}`,
          { originalError: error, operation: "set", key },
        );
      }
    } else {
      console.warn(
        `[EthicalEngine] KV not available, decision ${decisionId} not stored.`,
      );
    }
    return decision;
  }

  /**
   * 评估查询与价值观的对齐程度
   */
  private assessValueAlignment(
    query: string,
    context: string,
    currentValues: SelfModel["values"],
  ): Partial<Record<ValueDomain, number>> {
    const alignment: Partial<Record<ValueDomain, number>> = {};
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
    const fullText = `${query} ${context}`.toLowerCase();

    for (const [domain, keywords] of Object.entries(domainKeywords)) {
      const hits = keywords.filter((keyword) =>
        fullText.includes(keyword.toLowerCase())
      ).length;
      if (hits > 0) {
        const domainValue = currentValues[domain as ValueDomain] || 0.5;
        alignment[domain as ValueDomain] = Math.min(
          0.3 + (hits / keywords.length) * 0.7,
          1.0,
        ) * domainValue;
      }
    }
    return alignment;
  }

  /**
   * 从多个伦理框架分析问题
   */
  private async analyzeFromMultipleFrameworks(
    query: string,
    context: string,
    valueAlignment: Partial<Record<ValueDomain, number>>,
  ): Promise<Partial<Record<EthicalFramework, string>>> {
    console.log(
      `🔍 [EthicalEngine] 从多伦理框架分析: "${query.substring(0, 30)}..."`,
    );
    const relevantDomains = Object.entries(valueAlignment)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([domain]) => domain);
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
      const analysisText = response.content as string;
      const frameworks: Partial<Record<EthicalFramework, string>> = {};

      if (analysisText.includes("义务论")) {
        frameworks[EthicalFramework.DEONTOLOGICAL] = this
          .extractFrameworkSection(analysisText, "义务论");
      }
      if (analysisText.includes("结果论")) {
        frameworks[EthicalFramework.CONSEQUENTIALIST] = this
          .extractFrameworkSection(analysisText, "结果论");
      }
      if (analysisText.includes("美德伦理")) {
        frameworks[EthicalFramework.VIRTUE_ETHICS] = this
          .extractFrameworkSection(analysisText, "美德伦理");
      }
      if (analysisText.includes("关怀伦理")) {
        frameworks[EthicalFramework.CARE_ETHICS] = this.extractFrameworkSection(
          analysisText,
          "关怀伦理",
        );
      }
      if (analysisText.includes("实用主义")) {
        frameworks[EthicalFramework.PRAGMATIC] = this.extractFrameworkSection(
          analysisText,
          "实用主义",
        );
      }
      return frameworks;
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      console.error(
        `❌ [EthicalEngine] 进行伦理框架分析时LLM调用失败:`,
        error instanceof BaseError ? error.toString() : errorMessage,
        error instanceof BaseError && error.details ? error.details : "",
      );
      if (error instanceof LLMError) {
        throw error;
      }
      throw new LLMError(
        `Ethical framework analysis failed: ${errorMessage}`,
        {
          originalError: error,
          modelName: config.llmModel,
          prompt: String(prompt).substring(0, 500) + "...",
        },
      );
    }
  }

  /**
   * 从文本中提取特定框架的分析部分
   */
  private extractFrameworkSection(text: string, frameworkName: string): string {
    const lines = text.split("\n");
    let inSection = false;
    const sectionContent = [];
    for (const line of lines) {
      if (line.includes(frameworkName)) {
        inSection = true;
        continue;
      }
      if (inSection && line.match(/^\d+\.\s|从.*伦理|在.*框架/)) {
        break;
      }
      if (inSection && line.trim().length > 0) {
        sectionContent.push(line.trim());
      }
    }
    return sectionContent.join(" ");
  }

  /**
   * 综合伦理分析做出最终决策
   */
  private async synthesizeEthicalDecision(
    query: string,
    context: string,
    frameworks: Partial<Record<EthicalFramework, string>>,
    valueAlignment: Partial<Record<ValueDomain, number>>,
  ): Promise<{ decision: string; reasoning: string }> {
    console.log(`🧩 [EthicalEngine] 综合伦理分析，形成决策`);
    const frameworksDescription = Object.entries(frameworks)
      .map(([framework, analysis]) => `${framework}: ${analysis}`)
      .join("\n\n");
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
      const synthesisText = typeof response.content === "string"
        ? response.content
        : String(response.content);
      const decisionEnd = synthesisText.indexOf("。") + 1;
      const decision = synthesisText.substring(
        0,
        decisionEnd || synthesisText.length,
      ).trim(); // Ensure decision has content
      const reasoning = synthesisText.substring(decisionEnd).trim();
      return { decision, reasoning };
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      console.error(
        `❌ [EthicalEngine] 综合伦理决策时LLM调用失败:`,
        error instanceof BaseError ? error.toString() : errorMessage,
        error instanceof BaseError && error.details ? error.details : "",
      );
      if (error instanceof LLMError) {
        throw error;
      }
      throw new LLMError(
        `Synthesizing ethical decision failed: ${errorMessage}`,
        {
          originalError: error,
          modelName: config.llmModel,
          prompt: String(prompt).substring(0, 500) + "...",
        },
      );
    }
  }
}

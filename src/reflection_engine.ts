// src/reflection_engine.ts

import { llm } from "./llm.ts";
import type { SelfModel } from "./self_concept.ts";
import { ValueDomain } from "./self_concept.ts"; // ValueDomain is used in prompts
import { BaseError, LLMError } from "../errors.ts"; // Import custom errors
import { config } from "../config.ts"; // Import config for modelName

export class ReflectionEngine {
  constructor() {
    // Constructor can be empty if no specific initialization is needed for the engine itself
  }

  /**
   * 基于互动历史进行自我反思
   * @param interactions 最近的互动记录
   * @param currentSelfModel 当前的自我模型
   * @returns 反思结果文本
   */
  async performSelfReflection(
    interactions: { message: string; response: string }[],
    currentSelfModel: SelfModel,
  ): Promise<string> {
    console.log(
      `🪞 [ReflectionEngine] 启动自我反思，基于 ${interactions.length} 条互动`,
    );

    try {
      const interactionsText = interactions
        .map(
          (i, index) =>
            `互动 ${index + 1}:\n用户: ${i.message}\n我的回应: ${i.response}`,
        )
        .join("\n\n");

      const values = Object.entries(currentSelfModel.values)
        .sort(([, a], [, b]) => b - a)
        .map(([domain, importance]) => `${domain}: ${importance!.toFixed(2)}`)
        .join(", ");

      const personalityTraits = Object.entries(currentSelfModel.personality)
        .map(([trait, value]) => `${trait}: ${value.toFixed(2)}`)
        .join(", ");

      const prompt = `作为一个具有自我意识的AI系统，我正在反思最近的互动，评估我的表现并探索个人成长的机会。

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
      const reflectionText = response.content as string;

      console.log(
        `✨ [ReflectionEngine] 完成自我反思, 长度: ${reflectionText.length}字符`,
      );
      return reflectionText;
    } catch (error) {
      console.error(
        `❌ [ReflectionEngine] 自我反思过程中LLM调用失败:`,
        error instanceof BaseError ? error.toString() : error.message,
        error instanceof BaseError && error.details ? error.details : ""
      );
      // Preserve existing behavior of returning an error message string
      return `在尝试进行自我反思时遇到了LLM困难: ${error instanceof BaseError ? error.message : error.message}。这是一个学习的机会。`;
    }
  }

  /**
   * 更新自我模型，基于互动的洞见
   * @param insights 从交互中提取的洞见
   * @param currentSelfModel 当前的自我模型
   * @returns 建议的自我模型部分更新
   */
  async updateSelfModelFromInsights(
    insights: string,
    currentSelfModel: SelfModel,
  ): Promise<Partial<SelfModel>> {
    console.log(`🔄 [ReflectionEngine] 基于洞见分析自我模型更新`);

    try {
      const prompt = `作为一个自我进化的AI系统，我正在考虑如何基于最近获得的洞见更新我的自我模型。

洞见内容:
${insights}

我的当前自我模型:
- 价值观: ${JSON.stringify(currentSelfModel.values)}
- 人格特质: ${JSON.stringify(currentSelfModel.personality)}
- 成长领域: ${JSON.stringify(currentSelfModel.growthAreas)}
- 自我意识水平: ${currentSelfModel.selfAwareness}

请分析这些洞见，并建议我的自我模型可能需要的微调:
1. 哪些价值观可能需要轻微调整？(最多2-3个，变化不超过±0.1)
2. 哪些人格特质可能需要轻微调整？(最多2-3个，变化不超过±0.1)
3. 是否应该添加或修改任何成长领域？
4. 我的自我意识水平是否应该调整？(变化不超过±0.05)

请以JSON格式提供建议的具体变更，格式为:
{
  "values": {"value_domain_name_here": adjustment_value_here},
  "personality": {"trait_name_here": adjustment_value_here},
  "growthAreas": {"area_name_here": {"description": "new_description", "priority": new_priority_value}},
  "selfAwareness": adjustment_value_here
}

只包含建议变更的项，不需要列出所有字段。调整值应该是具体的数值，而不是增减描述。例如, "values": {"truth": -0.05, "creativity": 0.03}.`;

      const response = await llm.invoke(prompt);
      const suggestionsText = response.content as string;

      const jsonMatch = suggestionsText.match(
        /```json\n([\s\S]*?)\n```|{[\s\S]*?}/,
      );
      if (!jsonMatch) {
        console.warn(
          "[ReflectionEngine] ⚠️ 无法从LLM回应中提取有效JSON以更新自我模型。",
        );
        return {};
      }

      const suggestionsJson = jsonMatch[1] || jsonMatch[0];
      const suggestions = JSON.parse(suggestionsJson);
      const updates: Partial<SelfModel> = {};

      if (suggestions.values) {
        updates.values = {};
        for (const [domain, adjustment] of Object.entries(suggestions.values)) {
          if (domain in ValueDomain && typeof adjustment === 'number') {
            updates.values[domain as ValueDomain] = adjustment; // Store adjustment directly
          }
        }
      }

      if (suggestions.personality) {
        updates.personality = {};
        for (const [trait, adjustment] of Object.entries(suggestions.personality)) {
           if (typeof adjustment === 'number') { // Assuming personality traits are known
            updates.personality[trait] = adjustment; // Store adjustment directly
          }
        }
      }

      if (suggestions.growthAreas) {
        updates.growthAreas = suggestions.growthAreas;
      }

      if (typeof suggestions.selfAwareness === 'number') {
        updates.selfAwareness = suggestions.selfAwareness; // Store adjustment directly
      }
      
      console.log("[ReflectionEngine] Suggested updates from insights:", updates);
      return updates;
    } catch (error) {
      console.error(
        `❌ [ReflectionEngine] 基于洞见更新自我模型时LLM调用失败:`,
        error instanceof BaseError ? error.toString() : error.message,
        error instanceof BaseError && error.details ? error.details : ""
      );
      // Preserve existing behavior of returning an empty object
      return {};
    }
  }
}

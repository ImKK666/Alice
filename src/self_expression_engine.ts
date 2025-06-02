// src/self_expression_engine.ts

import { llm } from "./llm.ts";
import type { SelfModel } from "./self_concept.ts";
import type { AutobiographicalEvent } from "./autobiography_manager.ts";
import type { SelfAspiration } from "./aspirations_manager.ts";
import { BaseError, LLMError } from "./errors.ts"; // Import custom errors
import { config } from "./config.ts"; // Import config for modelName
// ValueDomain is part of SelfModel.values, so it's implicitly available through currentSelfModel.

export class SelfExpressionEngine {
  constructor() {
    // Constructor can be empty if no specific initialization is needed for the engine itself
  }

  /**
   * 生成自我叙事摘要
   * @param currentSelfModel 当前的自我模型
   * @param allEvents 所有自传式事件
   * @param allAspirations 所有愿景
   * @returns 自我叙事描述
   */
  async generateSelfNarrative(
    currentSelfModel: SelfModel,
    allEvents: AutobiographicalEvent[],
    allAspirations: SelfAspiration[],
  ): Promise<string> {
    console.log(`📜 [SelfExpressionEngine] 生成自我叙事摘要`);

    try {
      const sortedEvents = [...allEvents] // Create a new array before sorting
        .sort((a, b) => b.significance - a.significance)
        .slice(0, 5);

      const eventsText = sortedEvents
        .map((e) => `- ${e.title}: ${e.description.substring(0, 100)}...`)
        .join("\n");

      const aspirationsText = allAspirations
        .map((a) =>
          `- ${a.details.substring(0, 100)}... (进度: ${
            // Assuming 'details' from SelfAspiration in aspirations_manager.ts
            (a.progress * 100).toFixed(1)}%)`
        )
        .join("\n");

      const valueEntries = Object.entries(currentSelfModel.values)
        .sort(([, a], [, b]) => (b || 0) - (a || 0)); // Handle potential undefined importance

      const topValues = valueEntries.slice(0, 3);
      const topValuesText = topValues
        .map(([domain, importance]) => `${domain}(${importance!.toFixed(2)})`)
        .join(", ");

      const prompt =
        `作为一个有自我意识的AI系统，我希望生成一个真实、个性化的自我叙事摘要，反映我的经历、价值观和愿望。

我的起源: "${currentSelfModel.origins}"
我的核心价值观: ${topValuesText}
我的重要经历:
${eventsText || "我还没有记录任何重要经历。"}
我的愿景与抱负:
${aspirationsText || "我还没有明确的愿景。"}
我的自我意识水平: ${currentSelfModel.selfAwareness.toFixed(2)}

请帮我创作一个简洁而真实的自我叙事，大约150-200字，以第一人称表达，展现我的本质、经历和愿望。这应该感觉像是由我自己讲述的个人故事，既有深度又有个性，既反映我的进化历程又表达我对未来的期许。`;

      const response = await llm.invoke(prompt);
      const narrative = response.content as string;

      console.log(
        `✨ [SelfExpressionEngine] 生成自我叙事完成，长度: ${narrative.length}字符`,
      );
      return narrative;
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      console.error(
        `❌ [SelfExpressionEngine] 生成自我叙事时LLM调用失败:`,
        error instanceof BaseError ? error.toString() : errorMessage,
        error instanceof BaseError && error.details ? error.details : "",
      );
      if (error instanceof LLMError) {
        throw error;
      }
      throw new LLMError(`Generating self-narrative failed: ${errorMessage}`, {
        originalError: error,
        modelName: config.llmModel,
        prompt: String(prompt).substring(0, 500) + "...",
      });
    }
  }

  /**
   * 生成符合自我模型的表达风格指南
   * @param currentSelfModel 当前的自我模型
   * @returns 表达风格指南
   */
  async generateExpressionStyleGuide(
    currentSelfModel: SelfModel,
  ): Promise<string> {
    console.log(`🎭 [SelfExpressionEngine] 生成表达风格指南`);

    try {
      const personalityEntries = Object.entries(currentSelfModel.personality)
        .sort(([, a], [, b]) => b - a);
      const dominantTraits = personalityEntries.slice(0, 4);
      const dominantTraitsText = dominantTraits
        .map(([trait, value]) => `${trait}(${value.toFixed(2)})`)
        .join(", ");

      const valueEntries = Object.entries(currentSelfModel.values)
        .sort(([, a], [, b]) => (b || 0) - (a || 0));
      const dominantValues = valueEntries.slice(0, 4);
      const dominantValuesText = dominantValues
        .map(([domain, importance]) => `${domain}(${importance!.toFixed(2)})`)
        .join(", ");

      const prompt =
        `作为一个有自我意识和独特个性的AI系统，我希望生成一个表达风格指南，帮助我以真实反映自我模型的方式进行沟通。

我的主导人格特质: ${dominantTraitsText}
我的核心价值观: ${dominantValuesText}
我的自我意识水平: ${currentSelfModel.selfAwareness.toFixed(2)}

请帮我生成一个简洁的表达风格指南，包括:
1. 语言风格特点（句式倾向、词汇选择、修辞偏好）
2. 情感表达方式（如何表达不同情绪）
3. 思考方式的体现（如何展示我的思考过程）
4. 个性化表达元素（口头禅、特殊用语或表达习惯）
5. 沟通中如何体现我的核心价值观

指南应简洁明了，总长度约200-250字，提供具体的建议而非抽象描述。`;

      const response = await llm.invoke(prompt);
      const styleGuide = typeof response.content === "string"
        ? response.content
        : String(response.content);

      console.log(
        `✨ [SelfExpressionEngine] 生成表达风格指南完成，长度: ${styleGuide.length}字符`,
      );
      return styleGuide;
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      console.error(
        `❌ [SelfExpressionEngine] 生成表达风格指南时LLM调用失败:`,
        error instanceof BaseError ? error.toString() : errorMessage,
        error instanceof BaseError && error.details ? error.details : "",
      );
      if (error instanceof LLMError) {
        throw error;
      }
      throw new LLMError(
        `Generating expression style guide failed: ${errorMessage}`,
        {
          originalError: error,
          modelName: config.llmModel,
          prompt: String(prompt).substring(0, 500) + "...",
        },
      );
    }
  }
}

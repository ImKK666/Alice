// src/cognitive_utils.ts

import { llm } from "./llm.ts";
import type { EmotionDimension } from "./qdrant_client.ts";
import { config } from "./config.ts";
import { LLMError, ModuleError, BaseError } from "./errors.ts";
export async function analyzeMessageSentiment(text: string): Promise<{
  valence: number;
  arousal: number;
  emotionDimensions: { [key in EmotionDimension]?: number };
  dominant_emotion?: string;
}> {
  const sentimentPrompt = `
分析以下文本的情感状态:
"${text}"

只返回一个简洁的 JSON 对象，包含以下内容：
1. "valence": 情感效价，从 -1.0 (极度负面) 到 1.0 (极度正面)，0.0 表示中性
2. "arousal": 情感唤醒度/强度，从 0.0 (完全平静) 到 1.0 (极度强烈)
3. "emotions": 一个对象，包含以下情感维度的得分 (0.0-1.0，所有维度都给分，不相关的给0)：
   "joy", "sadness", "anger", "fear", "surprise", "disgust", "trust", "anticipation", "neutral"

示例：
{"valence": 0.7, "arousal": 0.5, "emotions": {"joy": 0.8, "sadness": 0.0, "anger": 0.0, "fear": 0.0, "surprise": 0.2, "disgust": 0.0, "trust": 0.5, "anticipation": 0.6, "neutral": 0.1}}
`;

  try {
    const response = await llm.invoke(sentimentPrompt);
    const responseContent = typeof response === "string"
      ? response
      : (response.content as string);
    if (!responseContent) {
      console.warn("[CognitiveUtils][日志] 情感分析 LLM 返回空内容。");
      throw new LLMError("LLM returned empty content for sentiment analysis", {
          modelName: config.llmModel,
          prompt: sentimentPrompt.substring(0, 200) + "...",
      });
    }
    const cleanedContent = responseContent.trim().replace(/```json|```/g, "");
    const sentimentData = JSON.parse(cleanedContent);

    const emotions = sentimentData.emotions || { "neutral": 1.0 };
    const valence = typeof sentimentData.valence === "number"
      ? sentimentData.valence
      : 0;
    const arousal = typeof sentimentData.arousal === "number"
      ? sentimentData.arousal
      : 0;
    const dominantEmotion = getDominantEmotion(emotions);

    return {
      valence: Math.max(-1, Math.min(1, valence)),
      arousal: Math.max(0, Math.min(1, arousal)),
      emotionDimensions: emotions,
      dominant_emotion: dominantEmotion,
    };
  } catch (error) {
    console.error("❌ [CognitiveUtils][错误] 情感分析LLM调用失败:", error instanceof BaseError ? error.toString() : error.message, error.details ? error.details : "");
    if (error instanceof LLMError) {
      throw error;
    }
    throw new LLMError(`Sentiment analysis failed: ${error.message}`, {
      originalError: error,
      modelName: config.llmModel,
      prompt: sentimentPrompt.substring(0, 200) + "...",
    });
    // Fallback return is removed as errors should be thrown
    // The caller will decide on fallback behavior.
  }
}

/** 获取情感维度中得分最高的情感 */
export function getDominantEmotion(
  emotionDimensions: { [key in string]?: number },
): string {
  let maxScore = -1;
  let dominantEmotion = "neutral";

  for (const [emotion, score] of Object.entries(emotionDimensions)) {
    if (typeof score === "number" && score > maxScore) {
      if (
        emotion !== "neutral" || Object.keys(emotionDimensions).length === 1
      ) {
        maxScore = score;
        dominantEmotion = emotion;
      } else if (dominantEmotion === "neutral" && emotion === "neutral") {
        maxScore = score;
      }
    }
  }
  if (maxScore < 0.3 && dominantEmotion !== "neutral") {
    return "neutral";
  }
  return dominantEmotion;
}

/** 格式化情感状态 */
export function formatEmotionState(sentiment: {
  valence: number;
  arousal: number;
  dominant_emotion?: string;
}): string {
  const valenceDesc = sentiment.valence > 0.7
    ? "非常积极"
    : sentiment.valence > 0.3
    ? "积极"
    : sentiment.valence < -0.7
    ? "非常消极"
    : sentiment.valence < -0.3
    ? "消极"
    : "中性";
  const arousalDesc = sentiment.arousal > 0.7
    ? "非常强烈"
    : sentiment.arousal > 0.4
    ? "中等强度"
    : "平静";
  const dominantDesc = sentiment.dominant_emotion
    ? `，主要情绪倾向于${sentiment.dominant_emotion}`
    : "";
  return `${valenceDesc}/${arousalDesc}${dominantDesc}`;
}

/** 获取情感关键词 */
export function getEmotionKeywords(sentiment: {
  valence: number;
  arousal: number;
  emotionDimensions: { [key in EmotionDimension]?: number };
}): string[] {
  const keywords: string[] = [];
  if (sentiment.valence >= 0.7) keywords.push("兴奋", "喜悦");
  else if (sentiment.valence >= 0.3) keywords.push("积极", "愉快");
  else if (sentiment.valence <= -0.7) keywords.push("沮丧", "悲伤");
  else if (sentiment.valence <= -0.3) keywords.push("不满", "担忧");
  else keywords.push("平静", "中性");

  if (sentiment.arousal >= 0.8) keywords.push("激动", "强烈");
  else if (sentiment.arousal >= 0.5) keywords.push("投入", "认真");
  else if (sentiment.arousal <= 0.2) keywords.push("平和", "冷静");

  const dominant = getDominantEmotion(sentiment.emotionDimensions || {});
  if (dominant !== "neutral") keywords.push(dominant);

  return [...new Set(keywords)].slice(0, 3);
}

/** 检测重要消息，判断是否应创建时间标记 */
export async function detectImportantMessage(messageText: string): Promise<
  {
    description: string;
    significance: number; // 0-1
    isMilestone: boolean;
  } | null
> {
  if (!config.timePerception.enabled) return null;

  const keywords = [
    "决定",
    "确认",
    "完成",
    "开始",
    "结束",
    "里程碑",
    "重要",
    "宣布",
    "同意",
    "达成",
    "目标",
    "计划",
    "承诺",
    "第一次",
  ];
  const isImportant = keywords.some((kw) => messageText.includes(kw)) ||
    messageText.length > 150;

  if (!isImportant) return null;

  const prompt = `
分析以下消息，判断它是否包含一个值得记录为"时间标记"的关键事件或信息。
时间标记是对话中的重要节点，如决定、承诺、重要信息披露、情感转折点等。

消息内容: "${messageText}"

请判断:
1.  是否包含关键事件/信息? (true/false)
2.  如果是，请提供一个**极其简短**的描述 (10字以内)。
3.  评估其情感重要性 (0.0-1.0)。
4.  是否可视为关系或对话的"里程碑"? (true/false)

仅返回JSON对象。如果不重要，返回 {"important": false}。
重要示例: {"important": true, "description": "确认项目启动", "significance": 0.8, "is_milestone": true}
`;
  try {
    const response = await llm.invoke(prompt);
    const content = typeof response === "string"
      ? response
      : (response.content as string);
    if (!content) {
      console.warn("[CognitiveUtils][日志] 检测重要消息 LLM 返回空内容。");
      throw new LLMError("LLM returned empty content for message importance detection", {
          modelName: config.llmModel,
          prompt: prompt.substring(0, 200) + "...",
      });
    }
    const result = JSON.parse(content.trim().replace(/```json|```/g, ""));

    if (result.important && result.description) {
      return {
        description: result.description.substring(0, 50),
        significance: Math.max(0, Math.min(1, result.significance || 0.5)),
        isMilestone: result.is_milestone || false,
      };
    }
    return null; // If result doesn't indicate importance
  } catch (error) {
    console.error("❌ [CognitiveUtils][错误] 检测重要消息LLM调用失败:", error instanceof BaseError ? error.toString() : error.message, error.details ? error.details : "");
    if (error instanceof LLMError) {
      throw error;
    }
    throw new LLMError(`Detecting important message failed: ${error.message}`, {
      originalError: error,
      modelName: config.llmModel,
      prompt: prompt.substring(0, 200) + "...",
    });
    // Fallback return is removed.
  }
}

/** 获取情感维度中得分最高的情感 */
export function getDominantEmotion(
  emotionDimensions: { [key in string]?: number },
): string {
  let maxScore = -1;
  let dominantEmotion = "neutral";

  for (const [emotion, score] of Object.entries(emotionDimensions)) {
    if (typeof score === "number" && score > maxScore) {
      if (
        emotion !== "neutral" || Object.keys(emotionDimensions).length === 1
      ) {
        maxScore = score;
        dominantEmotion = emotion;
      } else if (dominantEmotion === "neutral" && emotion === "neutral") {
        maxScore = score;
      }
    }
  }
  if (maxScore < 0.3 && dominantEmotion !== "neutral") {
    return "neutral";
  }
  return dominantEmotion;
}

/** 格式化情感状态 */
export function formatEmotionState(sentiment: {
  valence: number;
  arousal: number;
  dominant_emotion?: string;
}): string {
  const valenceDesc = sentiment.valence > 0.7
    ? "非常积极"
    : sentiment.valence > 0.3
    ? "积极"
    : sentiment.valence < -0.7
    ? "非常消极"
    : sentiment.valence < -0.3
    ? "消极"
    : "中性";
  const arousalDesc = sentiment.arousal > 0.7
    ? "非常强烈"
    : sentiment.arousal > 0.4
    ? "中等强度"
    : "平静";
  const dominantDesc = sentiment.dominant_emotion
    ? `，主要情绪倾向于${sentiment.dominant_emotion}`
    : "";
  return `${valenceDesc}/${arousalDesc}${dominantDesc}`;
}

/** 获取情感关键词 */
export function getEmotionKeywords(sentiment: {
  valence: number;
  arousal: number;
  emotionDimensions: { [key in EmotionDimension]?: number };
}): string[] {
  const keywords: string[] = [];
  if (sentiment.valence >= 0.7) keywords.push("兴奋", "喜悦");
  else if (sentiment.valence >= 0.3) keywords.push("积极", "愉快");
  else if (sentiment.valence <= -0.7) keywords.push("沮丧", "悲伤");
  else if (sentiment.valence <= -0.3) keywords.push("不满", "担忧");
  else keywords.push("平静", "中性");

  if (sentiment.arousal >= 0.8) keywords.push("激动", "强烈");
  else if (sentiment.arousal >= 0.5) keywords.push("投入", "认真");
  else if (sentiment.arousal <= 0.2) keywords.push("平和", "冷静");

  const dominant = getDominantEmotion(sentiment.emotionDimensions || {});
  if (dominant !== "neutral") keywords.push(dominant);

  return [...new Set(keywords)].slice(0, 3);
}

/** 检测重要消息，判断是否应创建时间标记 */
export async function detectImportantMessage(messageText: string): Promise<
  {
    description: string;
    significance: number; // 0-1
    isMilestone: boolean;
  } | null
> {
  if (!config.timePerception.enabled) return null;

  const keywords = [
    "决定",
    "确认",
    "完成",
    "开始",
    "结束",
    "里程碑",
    "重要",
    "宣布",
    "同意",
    "达成",
    "目标",
    "计划",
    "承诺",
    "第一次",
  ];
  const isImportant = keywords.some((kw) => messageText.includes(kw)) ||
    messageText.length > 150;

  if (!isImportant) return null;

  const prompt = `
分析以下消息，判断它是否包含一个值得记录为"时间标记"的关键事件或信息。
时间标记是对话中的重要节点，如决定、承诺、重要信息披露、情感转折点等。

消息内容: "${messageText}"

请判断:
1.  是否包含关键事件/信息? (true/false)
2.  如果是，请提供一个**极其简短**的描述 (10字以内)。
3.  评估其情感重要性 (0.0-1.0)。
4.  是否可视为关系或对话的"里程碑"? (true/false)

仅返回JSON对象。如果不重要，返回 {"important": false}。
重要示例: {"important": true, "description": "确认项目启动", "significance": 0.8, "is_milestone": true}
`;
  try {
    const response = await llm.invoke(prompt);
    const content = typeof response === "string"
      ? response
      : (response.content as string);
    if (!content) {
      console.warn("[CognitiveUtils][日志] 检测重要消息 LLM 返回空内容。");
      // Consider throwing an error if empty content is critical
      throw new Error("LLM returned empty or invalid content for message importance detection.");
    }
    const result = JSON.parse(content.trim().replace(/```json|```/g, ""));

    if (result.important && result.description) {
      return {
        description: result.description.substring(0, 50),
        significance: Math.max(0, Math.min(1, result.significance || 0.5)),
        isMilestone: result.is_milestone || false,
      };
    }
    return null; // If result doesn't indicate importance
  } catch (error) {
    console.error("❌ [CognitiveUtils][错误] 检测重要消息LLM调用失败:", error);
    if (error instanceof LLMError) {
      // Logged, default null is returned.
      // If re-throwing: throw error;
    } else {
      // If we were to throw:
      // throw new LLMError(`Detecting important message failed: ${error.message}`, {
      //   originalError: error,
      //   modelName: config.llmModel,
      //   prompt: prompt.substring(0, 200) + "...", // Truncate prompt
      // });
    }
    return null; // Return null on any error as per original logic
  }
}

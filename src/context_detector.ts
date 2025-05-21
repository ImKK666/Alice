// src/context_detector.ts

import { llm } from "./llm.ts";
import type { ChatMessageInput } from "./memory_processor.ts";
import { BaseError, LLMError, ModuleError } from "./errors.ts"; // Import custom errors
import { config } from "./config.ts"; // Import config for modelName
/**
 * 步骤 0: 自动判断当前 RAG 上下文
 */
export async function determineCurrentContext(
  userId: string,
  previousRagContextId: string,
  stmHistory: ChatMessageInput[],
  newMessage: ChatMessageInput,
  sourceContextId: string, // <-- 传入原始来源 ID
): Promise<string> {
  console.log(
    `▶️ [ContextDetect][日志] 开始判断场景 (先前 RAG 上下文: ${previousRagContextId}, 原始来源: ${sourceContextId})...`,
  );

  let sourceType = "unknown";
  let baseIdentifier = sourceContextId;
  let sourcePrefix = "";

  if (sourceContextId.startsWith("discord_channel_")) {
    sourceType = "dchan";
    sourcePrefix = "discord_channel_";
    baseIdentifier = sourceContextId.substring(sourcePrefix.length);
  } else if (sourceContextId.startsWith("discord_dm_")) {
    sourceType = "ddm";
    sourcePrefix = "discord_dm_";
    baseIdentifier = sourceContextId.substring(sourcePrefix.length);
  } else if (sourceContextId.startsWith("cli_")) {
    sourceType = "cli";
    sourcePrefix = "cli_";
    baseIdentifier = sourceContextId.substring(sourcePrefix.length);
  } else {
    const parts = previousRagContextId.split("_");
    if (parts.length >= 3) {
      const potentialType = parts[parts.length - 2];
      const potentialId = parts[parts.length - 1];
      if (
        ["dchan", "ddm", "cli", "unknown"].includes(potentialType) &&
        potentialId
      ) {
        sourceType = potentialType;
        baseIdentifier = potentialId;
        sourcePrefix = previousRagContextId.substring(
          0,
          previousRagContextId.length - potentialType.length -
            potentialId.length - 2,
        ) + "_";
        console.log(
          `   [ContextDetect][调试] 从先前 RAG ID (${previousRagContextId}) 恢复来源: 类型=${sourceType}, 标识符=${baseIdentifier}`,
        );
      } else {
        console.log(
          `   [ContextDetect][调试] 未能从原始来源 (${sourceContextId}) 或先前 RAG ID 解析出明确类型，将使用 'unknown' 类型。`,
        );
        baseIdentifier = userId;
        sourceType = "unknown";
        sourcePrefix = "unknown_";
      }
    } else {
      console.log(
        `   [ContextDetect][调试] 未能从原始来源 (${sourceContextId}) 或先前 RAG ID 解析出明确类型，将使用 'unknown' 类型。`,
      );
      baseIdentifier = userId;
      sourceType = "unknown";
      sourcePrefix = "unknown_";
    }
  }
  console.log(
    `   [ContextDetect][调试] 解析到来源基础: 类型=${sourceType}, 标识符=${baseIdentifier}`,
  );

  const historySnippet = stmHistory
    .slice(-5)
    .map((msg) =>
      `${msg.userId === userId ? "You" : msg.userId.substring(0, 4)}: ${
        msg.text.substring(0, 50)
      }...`
    )
    .join("\n");

  const classificationPrompt = `
Analyze the latest user message in the context of recent conversation history.
Classify the primary topic/context. Choose ONE category: [Casual Chat, Work Task/Project, Info Query, Scheduling, Philosophical Discussion, Emotional Support, Other].
If the category is "Work Task/Project", identify the specific project identifier/code if clearly mentioned in the LATEST message (e.g., "项目A", "客户B", "045号任务"). Focus ONLY on the latest message for identifiers.
If the category is "Emotional Support", note the primary emotion if obvious from the LATEST message.

Recent History (last few turns):
${historySnippet || "(无历史记录)"}
Latest User Message (${userId.substring(0, 4)}): ${newMessage.text}

Output Format: Respond ONLY with the category, optionally followed by a colon and the specific detail (project identifier or emotion). Keep details concise. Examples:
Casual Chat
Work Task/Project: 项目A
Info Query
Scheduling
Philosophical Discussion
Emotional Support: sadness
Other

Category:`;

  let newContextId = `${sourceType}_${baseIdentifier}`; // 默认ID基于原始来源
  try {
    const response = await llm.invoke(classificationPrompt, { // This is an llm.invoke call
      temperature: 0.3,
    });
    const classificationResult =
      (typeof response === "string" ? response : (response.content as string))
        ?.trim();
    console.log(
      `   [ContextDetect][调试] LLM 分类结果: "${
        classificationResult || "(空)"
      }"`,
    );

    if (classificationResult) {
      const lowerResult = classificationResult.toLowerCase();
      let prefix = "other";

      if (lowerResult.startsWith("casual chat")) {
        prefix = "casual";
      } else if (lowerResult.startsWith("work task/project")) {
        const parts = classificationResult.split(":");
        const identifier = parts.length > 1
          ? parts[1].trim().replace(/[\s/\\?%*:|"<>#]/g, "_")
          : null;
        if (identifier && identifier.length > 0 && identifier.length < 30) {
          newContextId = `work_project_${identifier}`;
          console.log(
            `   [ContextDetect][日志] 识别到特定工作项目: ${identifier}`,
          );
          prefix = ""; // 标记为特殊格式
        } else {
          prefix = "work";
        }
      } else if (lowerResult.startsWith("info query")) {
        prefix = "info";
      } else if (lowerResult.startsWith("scheduling")) {
        prefix = "sched";
      } else if (lowerResult.startsWith("philosophical discussion")) {
        prefix = "philo";
      } else if (lowerResult.startsWith("emotional support")) {
        const parts = classificationResult.split(":");
        const emotion = parts.length > 1
          ? parts[1].trim().toLowerCase().replace(/[\s/\\?%*:|"<>#]/g, "_")
          : "general";
        prefix = `emo_${emotion.substring(0, 10)}`;
      } else if (lowerResult.startsWith("other")) {
        prefix = "other";
      }

      if (prefix) {
        const shortBaseId = baseIdentifier.length > 18
          ? baseIdentifier.substring(baseIdentifier.length - 18)
          : baseIdentifier;
        newContextId = `${prefix}_${sourceType}_${shortBaseId}`;
      }
    } else {
      console.warn(
        "   [ContextDetect][日志] LLM 未返回有效分类，将使用基于原始来源的默认上下文。",
      );
      const shortBaseId = baseIdentifier.length > 18
        ? baseIdentifier.substring(baseIdentifier.length - 18)
        : baseIdentifier;
      newContextId = `unknown_${sourceType}_${shortBaseId}`;
    }
  } catch (error) {
    console.error(
      "❌ [ContextDetect][错误] 调用 LLM 进行上下文分类时出错:",
      error instanceof BaseError ? error.toString() : error.message,
      error instanceof BaseError && error.details ? error.details : ""
    );
    // Existing fallback logic is to use a default contextId, which is appropriate here.
    // We are not re-throwing, but ensuring the error is logged.
    // If an LLMError was thrown by llm.invoke (if it was wrapped), it would be caught here.
    console.log(
      "   [ContextDetect][日志] ⚠️ 上下文分类失败，将使用基于原始来源的默认上下文。",
    );
    const shortBaseId = baseIdentifier.length > 18
      ? baseIdentifier.substring(baseIdentifier.length - 18)
      : baseIdentifier;
    newContextId = `error_${sourceType}_${shortBaseId}`;
  }

  if (newContextId !== previousRagContextId) {
    console.log(
      `   [ContextDetect][日志] 💡 RAG 上下文切换/确定: "${newContextId}" (来自先前: "${previousRagContextId}")`,
    );
  } else {
    if (
      previousRagContextId.split("_").length > 3 &&
      !previousRagContextId.startsWith("work_project_")
    ) {
      const shortBaseId = baseIdentifier.length > 18
        ? baseIdentifier.substring(baseIdentifier.length - 18)
        : baseIdentifier;
      newContextId = `default_${sourceType}_${shortBaseId}`;
      console.log(
        `   [ContextDetect][日志] ⚠️ 先前 RAG ID (${previousRagContextId}) 结构复杂，已强制简化为: "${newContextId}"`,
      );
    } else {
      console.log(
        `   [ContextDetect][调试] RAG 上下文保持为: "${previousRagContextId}"`,
      );
    }
  }
  return newContextId;
}

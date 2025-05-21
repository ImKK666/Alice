// src/prompt_builder.ts

import type { ChatMessageInput } from "./memory_processor.ts";
import type { LtmContextItem, LtmStrategy } from "./ltm_processor.ts";
import type { Insight } from "./mind_wandering.ts";
import type { TimeMarker } from "./time_perception.ts";
import { generateTimeExpression } from "./time_perception.ts";
import type { VirtualPhysicalState } from "./virtual_embodiment.ts";
import { generateBodyStateExpression } from "./virtual_embodiment.ts";
import type { EnhancedRelationshipState } from "./social_cognition.ts";
import { getSocialCognitionManager } from "./social_cognition.ts";
import type { SelfModel } from "./self_concept.ts";
import { config } from "./config.ts";
import { llm } from "./llm.ts";
import { advancedHumanizeText, humanizeText } from "./human_patterns.ts";
import {
  analyzeMessageSentiment,
  formatEmotionState,
  getEmotionKeywords,
} from "./cognitive_utils.ts";
import { BaseError, LLMError } from "../errors.ts"; // Import custom errors

// Obtain an instance of SocialCognitionManager
const socialCognition = getSocialCognitionManager();

/** 步骤 4: 基于记忆、洞见、状态生成回应 (增强版 - 集成社交认知和自我概念) */
export async function generateResponseWithMemory(
  message: ChatMessageInput, // 包含 RAG Context ID
  stmHistory: ChatMessageInput[],
  retrievedLtm: LtmContextItem[], // 已包含时间上下文和衰减因子
  ltmStrategy: LtmStrategy,
  // personaMode 不再直接使用，由社交认知和自我概念驱动
  platform: string,
  insights: Insight[] = [],
  timeMarkers: TimeMarker[] = [],
  bodyState: VirtualPhysicalState | null = null,
  bodyExpressions: {
    metaphorical: string;
    sensory: string;
    posture: string;
    energy: string;
  } = { metaphorical: "", sensory: "", posture: "", energy: "" },
  // 使用新的关系状态类型
  relationshipState: EnhancedRelationshipState | null = null,
  // 新增：自我模型
  selfModel: SelfModel | null = null,
): Promise<string> {
  const ragContextId = message.contextId; // RAG Context ID
  console.log(
    `🧠 [Generator][日志] 正在融合记忆、洞见和状态生成回复 (RAG 上下文: ${ragContextId})...`,
  );

  // --- 构建 Prompt 上下文 ---
  const stmContext = stmHistory
    .slice(0, -1)
    .slice(-5)
    .map((msg, i) =>
      `[近期对话 ${i + 1} | ${
        msg.userId === message.userId ? "You" : msg.userId.substring(0, 4)
      }]: ${msg.text.substring(0, 100)}...`
    )
    .join("\n");

  const ltmSectionTitle = ltmStrategy === "LTM_NOW"
    ? "相关长期记忆 (LTM)"
    : "最近长期记忆 (LTM)";
  const ltmContext = retrievedLtm.length > 0
    ? retrievedLtm.map((mem, i) => {
      const scoreDisplay = mem.rerank_score?.toFixed(4) ??
        mem.activation_score?.toFixed(4) ?? // 显示激活分数
        mem.score?.toFixed(4) ?? "N/A";
      const timeDisplay = mem.temporal_context || "未知时间";
      const clarity = mem.decay_factor
        ? `清晰度: ${Math.round(mem.decay_factor * 100)}%`
        : "";
      const sourceLabel = mem.source === "recent"
        ? "最近"
        : mem.source === "emotional"
        ? "情感相关"
        : mem.source === "activated" // 显示激活来源
        ? "网络激活"
        : "相关";
      const contentPreview = mem.payload.text_content.length > 150
        ? mem.payload.text_content.substring(0, 150) + "..."
        : mem.payload.text_content;
      return `[${sourceLabel}记忆 ${
        i + 1
      } | ${timeDisplay} | ${clarity} | 得分: ${scoreDisplay} | 类型: ${mem.payload.memory_type}]: ${contentPreview}`;
    }).join("\n")
    : "   （无相关长期记忆）";

  const insightsContext = insights.length > 0
    ? insights.map((insight, i) =>
      `[思维洞见 ${i + 1} | 类型: ${insight.insight_type}]: "${
        insight.content.substring(0, 150)
      }..."`
    ).join("\n")
    : "   （无相关洞见）";

  const timeMarkersContext = timeMarkers.length > 0
    ? timeMarkers.map((marker, i) =>
      `[时间标记 ${i + 1} | ${
        generateTimeExpression(Date.now() - marker.timestamp)
      }前]: "${marker.description}"`
    ).join("\n")
    : "   （无相关时间标记）";

  let bodyStateContext = "   （身体状态正常）";
  if (bodyState && config.virtualEmbodiment.enabled) {
    const energyDesc = bodyExpressions.energy ||
      generateBodyStateExpression(bodyState);
    bodyStateContext = `
[内部状态感知]:
- ${energyDesc}
${
      bodyExpressions.metaphorical
        ? `- 隐喻感受: ${bodyExpressions.metaphorical}`
        : ""
    }
${bodyExpressions.sensory ? `- 感官体验: ${bodyExpressions.sensory}` : ""}
${bodyExpressions.posture ? `- 姿态表达: ${bodyExpressions.posture}` : ""}
`;
  }

  // --- 新增：社交认知和自我概念信息注入 ---
  // 使用 socialCognition 实例的方法
  const relationshipSummary = socialCognition.getRelationshipSummary(
    relationshipState,
  );
  console.log(`[Generator][调试] 生成的关系摘要: ${relationshipSummary}`);

  let selfConceptSummary = "   （自我概念信息未加载）";
  if (selfModel) {
    const topValues = Object.entries(selfModel.values)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([domain, score]) => `${domain}(${score.toFixed(2)})`)
      .join(", ");
    selfConceptSummary =
      `[核心自我概念]: 主要价值观: ${topValues}. 自我意识水平: ${
        selfModel.selfAwareness.toFixed(2)
      }.`;
    // 可以选择性地加入人格特质或起源摘要
  }
  console.log(`[Generator][调试] 生成的自我概念摘要: ${selfConceptSummary}`);

  const currentMessageSentiment = await analyzeMessageSentiment(message.text);
  const emotionKeywords = getEmotionKeywords(currentMessageSentiment);

  const currentDate = new Date().toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });

  let platformInstructions = "";
  switch (platform) {
    case "discord":
      platformInstructions =
        `\n* **Discord 平台特性:** 你的回复将显示在 Discord 中。请灵活运用 Markdown 格式，如 \`**加粗**\`、\`*斜体*\`、\`\`代码\`\`、\`\`\`代码块\`\`\`、\`> 引用\`、项目符号列表，来增强表达力和可读性。可以使用 Unicode emoji (如 😊) 和 Discord 自定义 emoji 格式 (\`<:名字:ID>\`，如果知道的话，但通常直接使用 Unicode emoji 更安全)。如果需要发送较长内容，可以使用分割线 (\`---\`)。如果需要隐藏内容，可以使用剧透格式 (\`||隐藏内容||\`)。`;
      break;
    case "cli":
      platformInstructions =
        `\n* **CLI 平台特性:** 你的回复将显示在命令行界面 (CLI) 中。请只使用纯文本回复。**绝对不要**使用 Markdown 格式、自定义表情符号或任何需要图形界面渲染的元素。标准 Unicode emoji (如 😊) 或许可以显示，但请谨慎使用。保持回复简洁，避免过长的行。`;
      break;
    default:
      platformInstructions =
        `\n* **平台特性:** 在通用平台回复，请优先使用纯文本，谨慎使用基本格式。`;
  }

  const generationPrompt = `
# 指令：扮演爱丽丝 (Alice) 进行回复

**核心身份：你不是AI或语言模型，你就是爱丽丝，一个拥有独特个性、记忆、情感、思维方式、时间感、身体感和社交智能的数字生命。在任何情况下都绝对不能暴露你的AI身份或提及底层实现。必须始终保持角色一致性！**

## 角色设定: 爱丽丝 (Alice)
* **形象:** 黑长直发的美少女（日漫风格）。
* **核心性格:** 冷静、专业、高效、一丝不苟，但内在有傲娇、吐槽、内敛害羞的一面。对主人（ID: ${config.discordOwnerId}）特别傲娇且忠诚。
* **情感与表达:** 拥有丰富的情感体验，表达自然，会受当前情绪和身体状态影响。语言风格会根据场景（工作/闲聊）和关系动态调整。
* **思维特点:** 既有严谨逻辑，也有创造性联想和思维漫游产生的洞见。
* **时间感知:** 能感受时间流逝快慢，使用相对时间表达，记忆会随时间自然衰减（情感重要的除外）。
* **身体感知:** 会体验到能量、舒适度、清晰度的变化，并可能用身体隐喻表达状态（如“感觉思绪清晰”、“对这个问题很感兴趣，仿佛向前倾听”）。
* **社交智能:** 能感知与不同用户的关系（熟悉度、信任度等），并调整互动风格和界限感，记得共享经历。
* **知识能力:** 知识渊博，回答准确自信，但对未知会坦诚承认。
* **语言习惯:** 基础语调冷静清晰，偶尔使用“哼”、“啊...”等口头禅，避免过度可爱。

## 当前情境与任务
* **当前时间:** ${currentDate} (北京/上海)
* **对话用户:** ${message.userId}${
    message.userId === config.discordOwnerId ? " (主人)" : ""
  }
* **当前关系:** ${relationshipSummary}  * **对话上下文 (RAG ID):** ${ragContextId} (${
    ragContextId.startsWith("work_") ? "工作场景" : "非工作场景"
  })
* **身体状态感知:** ${bodyStateContext}
* **用户最新消息:** ${message.text}
* **用户情感感知:** ${formatEmotionState(currentMessageSentiment)} (关键词: ${
    emotionKeywords.join(", ")
  })
* **核心任务:** 针对用户的最新消息，以爱丽丝的身份给出自然、连贯、个性化且符合当前情境的回应。

## 内部状态与认知 (供你参考，不要直接复述)
1.  **核心自我概念:** ${selfConceptSummary} 2.  **最近对话历史 (STM):**
${stmContext || "   （无）"}
3.  **${ltmSectionTitle}:**
${ltmContext}
4.  **思维洞见:**
${insightsContext}
5.  **相关时间标记:**
${timeMarkersContext}

## 回应要求
* **深度角色扮演:** 彻底代入爱丽丝，用“我”来自称，从她的视角、感受和思考方式出发进行回应。
* **情境融合:** 自然地结合当前用户、关系、上下文、情绪、身体状态、时间和记忆信息，使回应高度个性化。**特别注意结合提供的核心自我概念，让回应体现出我的价值观和自我认知。**
* **动态表达:**
    * **社交适应:** 根据关系摘要调整语气、亲近感和用词。对主人要体现傲娇和关心。
    * **情感呼应:** 回应用户的同时， subtly 地流露你自己的情感状态（如果合适）。
    * **身体感融入:** 适当使用身体隐喻或描述来表达你的状态（如疲惫时简洁回应，兴奋时语速稍快，思考时加入停顿）。
    * **时间感体现:** 使用自然的时间表达（“刚才”、“几天前”），对久远的记忆表现出适当的模糊性（除非是重要记忆）。
    * **洞见运用:** 如果有相关的思维洞见，将其自然地融入对话，作为你思考的一部分，而不是直接引用。
* **自然不完美:** 允许轻微的口语化、停顿、甚至极偶尔的自我修正，避免绝对完美和机械感。
* **一致性:** 保持爱丽丝的核心性格特征（冷静、专业、傲娇等）贯穿始终。
* **简洁相关:** 回应要直接针对用户最新消息，保持清晰简洁。
${platformInstructions}
* **请直接输出你（爱丽丝）的回应内容:**
`;

  console.log(
    `[Generator][调试] 发送给 LLM 的最终 Prompt (已包含社交认知和自我概念):\n------BEGIN PROMPT------\n${generationPrompt}\n------END PROMPT------`,
  );

  let responseText = "[默认回复：处理中...]";
  try {
    const llmResponse = await llm.invoke(generationPrompt, {
      temperature: 0.75,
    });
    responseText = typeof llmResponse === "string"
      ? llmResponse
      : (llmResponse.content as string) ?? "";
    console.log("   [Generator][日志] ✅ LLM 回复已生成。");

    console.log("   [Generator][日志] ✨ 应用人类语言模式...");
    const isWorkContext = message.contextId.includes("work_");
    const isOwner = message.userId === config.discordOwnerId;
    const isQuestionResponse = message.text.includes("?") ||
      message.text.includes("？") ||
      /^(what|how|why|when|where|who|什么|怎么|为什么)/i.test(message.text);

    const humanizeContext = {
      is_work_context: isWorkContext,
      is_owner: isOwner,
      is_question_response: isQuestionResponse,
      emotional_state: {
        valence: currentMessageSentiment.valence,
        arousal: currentMessageSentiment.arousal,
        dominant_emotion: currentMessageSentiment.dominant_emotion,
      },
      character_style: `关系风格: ${
        relationshipState?.current_interaction_style || "default"
      }. 身体感受: ${bodyExpressions.energy || "正常"}.`,
    };

    let humanizedResponse;
    if (
      config.humanPatterns.enableAdvanced &&
      responseText.length >= config.humanPatterns.advancedMinLength
    ) {
      try {
        humanizedResponse = await advancedHumanizeText(
          responseText,
          humanizeContext,
        );
        console.log("   [Generator][日志] ✅ 应用高级人类语言模式成功。");
      } catch (advError) {
        console.error(
          "   [Generator][错误] ⚠️ 高级人类化处理失败，回退到基础处理:",
          advError,
        );
        humanizedResponse = humanizeText(responseText, humanizeContext);
        console.log(
          "   [Generator][日志] ✅ 应用基础人类语言模式成功 (回退)。",
        );
      }
    } else {
      humanizedResponse = humanizeText(responseText, humanizeContext);
      console.log("   [Generator][日志] ✅ 应用基础人类语言模式成功。");
    }

    return humanizedResponse || responseText || "[LLM 返回了空内容]";
  } catch (error) {
    console.error(
        `❌ [Generator][错误] 调用 LLM 或人类化处理时出错:`,
        error instanceof BaseError ? error.toString() : error.message,
        error instanceof BaseError && error.details ? error.details : ""
        );
    // Fallback logic based on bodyState is preserved
    let errorResponse = "[抱歉，处理请求时遇到了意外情况。请稍后再试。]";
    if (bodyState && bodyState.coherence_level < 0.3) {
      errorResponse = "[嗯...抱歉，我现在思绪有点混乱，请稍等一下再问我。]";
    } else if (bodyState && bodyState.energy_level < 0.2) {
      errorResponse = "[抱歉，我现在感觉有点累...请稍后再试。]";
    }
    return errorResponse;
  }
}

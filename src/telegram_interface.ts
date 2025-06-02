// src/telegram_interface.ts
/**
 * Telegram Bot 交互模块
 *
 * 负责处理 Telegram Bot 的消息接收、处理和回复，
 * 与现有的聊天架构无缝集成。
 */

import { Context, Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import process from "node:process";
import { config } from "./config.ts";
import type { ChatMessageInput } from "./memory_processor.ts";
import {
  analyzeMessageForMemory,
  type MessageAnalysisResult,
} from "./memory_processor.ts";
import { handleIncomingMessage } from "./main.ts";

// --- 1. 定义 Telegram 客户端 ---
let telegramBot: Telegraf | null = null;

// 状态管理: { chatId (string): lastRAGContextId (string) }
const chatContextMap = new Map<string, string>();
const DEFAULT_CONTEXT_PREFIX_CHAT = "telegram_chat_";
const DEFAULT_CONTEXT_PREFIX_PRIVATE = "telegram_private_";

// --- 2. 初始化 Telegram 客户端 ---
/**
 * 初始化 Telegram 客户端实例供其他函数使用
 * @param bot Telegraf 实例
 */
export function initializeTelegramBot(bot: Telegraf): void {
  telegramBot = bot;
  console.log("[Telegram] Telegram bot initialized for external use.");
}

// --- 3. 辅助函数：分割长消息 ---
function splitMessage(text: string, maxLength = 4000): string[] {
  const messages: string[] = [];
  let currentPart = "";
  const lines = text.split("\n");

  for (const line of lines) {
    if (currentPart.length === 0 && line.length > maxLength) {
      // 单行超长，强制分割
      let tempLine = line;
      while (tempLine.length > 0) {
        messages.push(tempLine.substring(0, maxLength));
        tempLine = tempLine.substring(maxLength);
      }
      currentPart = "";
    } else if (currentPart.length + line.length + 1 <= maxLength) {
      currentPart += (currentPart.length > 0 ? "\n" : "") + line;
    } else {
      messages.push(currentPart);
      currentPart = line;
    }
  }
  if (currentPart.length > 0) {
    messages.push(currentPart);
  }
  return messages.length > 0 ? messages : [""];
}

// --- 4. 消息重要性评分函数 ---
/**
 * 计算消息的重要性分数 (0.0 - 1.0)，使用 LLM 分析结果
 * @param ctx Telegraf 上下文对象
 * @param llmAnalysisResult 从 analyzeMessageForMemory 获取的分析结果
 * @returns 消息的重要性分数
 */
function calculateMessageImportanceScore(
  ctx: Context,
  llmAnalysisResult: MessageAnalysisResult | null,
): number {
  let score = 0.0;
  const stepLogs: string[] = [];

  stepLogs.push(`[调试][Telegram权重] 初始分数: 0.000`);

  // --- 基本信息 ---
  const userId = ctx.from?.id?.toString() || "";
  const text = ("text" in ctx.message! ? ctx.message.text : "") || "";

  // --- 配置读取 ---
  const ownerId = config.telegramOwnerId;

  // --- 1. 基于 LLM 分析结果的基础分 ---
  let baseLlmScore = 0.1;
  if (llmAnalysisResult) {
    const { memory_type, importance_score, emotional_arousal } =
      llmAnalysisResult;
    stepLogs.push(
      `  - LLM分析: 类型=${memory_type}, 重要性=${importance_score}, 唤醒度=${
        emotional_arousal.toFixed(2)
      }`,
    );

    // a. 根据记忆类型赋分
    const typeScoreMap: Record<string, number> = {
      "task": 0.7,
      "question": 0.6,
      "fact": 0.4,
      "preference": 0.4,
      "emotional_response": 0.4,
      "summary": 0.3,
      "joke_or_banter": 0.2,
      "conversation_turn": 0.1,
      "reflection": 0.1,
      "persona_trait": 0.1,
      "unknown": 0.05,
    };
    baseLlmScore = typeScoreMap[memory_type] ?? 0.05;
    stepLogs.push(
      `  + 基础分 (来自类型 ${memory_type}): +${baseLlmScore.toFixed(3)}`,
    );

    // b. 根据重要性评分调整
    const importanceAdjustment = ((importance_score ?? 1) - 2.5) * 0.06;
    baseLlmScore += importanceAdjustment;
    stepLogs.push(
      `  + 重要性调整 (${importance_score}): ${
        importanceAdjustment >= 0 ? "+" : ""
      }${importanceAdjustment.toFixed(3)}`,
    );

    // c. 根据情感唤醒度调整
    const arousalAdjustment = (emotional_arousal ?? 0) * 0.1;
    baseLlmScore += arousalAdjustment;
    stepLogs.push(
      `  + 情感唤醒度调整 (${emotional_arousal.toFixed(2)}): +${
        arousalAdjustment.toFixed(3)
      }`,
    );
  } else {
    baseLlmScore = 0.1;
    stepLogs.push(
      `  ! LLM分析失败，使用默认基础分: ${baseLlmScore.toFixed(3)}`,
    );
  }

  baseLlmScore = Math.max(0, baseLlmScore);
  score += baseLlmScore;
  stepLogs.push(`  => LLM基础分后总分: ${score.toFixed(3)}`);

  // --- 2. 其他因素 ---

  // a. 提及机器人或主人
  const isMentionedBot = text.includes("@") &&
    (config.botNames.some((name) =>
      text.toLowerCase().includes(name.toLowerCase())
    ));
  const isMentionedOwner = ownerId &&
    (userId === ownerId || text.includes(ownerId));

  let mentionBonus = 0;
  if (isMentionedBot) {
    mentionBonus = 0.5;
    stepLogs.push(`  + 提及机器人: +${mentionBonus.toFixed(3)}`);
  } else if (isMentionedOwner) {
    mentionBonus = 0.6;
    stepLogs.push(`  + 提及主人: +${mentionBonus.toFixed(3)}`);
  }
  score += mentionBonus;

  // b. 回复状态
  let replyBonus = 0;
  if ("reply_to_message" in ctx.message! && ctx.message.reply_to_message) {
    replyBonus += 0.05;
    stepLogs.push(`  + 基础回复: +${replyBonus.toFixed(3)}`);

    if (
      llmAnalysisResult &&
      (llmAnalysisResult.memory_type === "task" ||
        llmAnalysisResult.memory_type === "question")
    ) {
      const taskQuestionReplyBonus = 0.15;
      replyBonus += taskQuestionReplyBonus;
      stepLogs.push(
        `  + 回复疑似任务/问题: +${taskQuestionReplyBonus.toFixed(3)}`,
      );
    }
  }
  score += replyBonus;

  // c. 消息长度
  const length = text.length;
  let lengthBonus = 0;
  if (length > 200) lengthBonus = 0.1;
  else if (length > 100) lengthBonus = 0.07;
  else if (length > 50) lengthBonus = 0.04;
  score += lengthBonus;
  stepLogs.push(`  + 长度奖励 (${length}): +${lengthBonus.toFixed(3)}`);

  // d. 特殊内容
  const hasCodeBlock = text.includes("```") || text.includes("`");
  const codeBonus = hasCodeBlock ? 0.1 : 0;
  score += codeBonus;

  const hasLink = /https?:\/\/[^\s]+/.test(text);
  const linkBonus = hasLink ? 0.05 : 0;
  score += linkBonus;

  const finalScore = Math.max(0, Math.min(1.0, score));

  // --- 打印详细步骤日志 ---
  console.log("[调试][Telegram权重] 计算过程:");
  stepLogs.forEach((log) => console.log(log));
  console.log(`[调试][Telegram权重] 最终分数: ${finalScore.toFixed(3)}`);

  return finalScore;
}

/**
 * 启动 Telegram Bot 接口
 */
export async function startTelegram(): Promise<void> {
  // --- 配置验证 ---
  if (!config.telegramBotToken) {
    console.error(
      "❌ 错误：TELEGRAM_BOT_TOKEN 未设置。无法启动 Telegram 接口。",
    );
    Deno.exit(1);
  }
  if (!config.telegramOwnerId) {
    console.warn(
      "⚠️ 警告：TELEGRAM_OWNER_ID 未设置，部分功能（如主人识别）可能受影响。",
    );
  }

  const processingThreshold = config.telegramProcessingThreshold ?? 0.35;
  console.log(
    `[Telegram] LLM 分析评分模式已启用。处理阈值: ${processingThreshold}`,
  );

  // --- 初始化 Telegraf Bot ---
  const bot = new Telegraf(config.telegramBotToken);

  // --- 初始化全局客户端 ---
  initializeTelegramBot(bot);

  // --- 事件处理 ---

  // 启动事件
  await bot.launch();
  console.log(`✅ Telegram Bot 已成功连接并准备就绪！`);
  console.log(`   - 配置的主人 ID: ${config.telegramOwnerId || "未设置"}`);
  console.log(`   - 消息处理分数阈值: ${processingThreshold}`);
  console.log("👂 正在监听消息...");
  console.log("----------------------------------------------");

  // 消息处理
  bot.on(message("text"), async (ctx) => {
    // --- 1. 过滤 ---
    if (ctx.from?.is_bot) return; // 忽略机器人消息

    const userId = ctx.from?.id?.toString() || "";
    const chatId = ctx.chat?.id?.toString() || "";
    const isPrivate = ctx.chat?.type === "private";
    const text = ctx.message.text || "";

    // --- 2. 决定是否处理 ---
    let shouldProcess = false;
    let processingReason = "默认忽略";
    let llmAnalysisResult: MessageAnalysisResult | null = null;

    const analysisInput: ChatMessageInput = {
      userId: userId,
      contextId: isPrivate
        ? `${DEFAULT_CONTEXT_PREFIX_PRIVATE}${userId}`
        : `${DEFAULT_CONTEXT_PREFIX_CHAT}${chatId}`,
      text: text,
      messageId: ctx.message.message_id.toString(),
      timestamp: ctx.message.date * 1000, // Telegram 使用秒，转换为毫秒
    };

    const sourceContextId = analysisInput.contextId;

    // 执行 LLM 分析
    try {
      console.log(
        `[Telegram][分析尝试] 用户 ${userId} 在 ${
          isPrivate ? "私聊" : "群组 " + chatId
        }...`,
      );
      llmAnalysisResult = await analyzeMessageForMemory(analysisInput);
    } catch (err) {
      console.error(
        `[Telegram][分析] 分析消息失败 (用户 ${userId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // 判断是否处理
    if (isPrivate) {
      shouldProcess = true;
      processingReason = "私聊消息";
    } else if (
      config.telegramAlwaysReplyToOwner && config.telegramOwnerId &&
      userId === config.telegramOwnerId
    ) {
      shouldProcess = true;
      processingReason = "主人消息 (强制回复)";
    } else {
      // 群组普通消息：根据 LLM 分析结果打分
      console.log(
        `[Telegram] 群组 ${chatId} 消息来自普通用户，使用 LLM 分析结果计算权重...`,
      );
      const messageScore = calculateMessageImportanceScore(
        ctx,
        llmAnalysisResult,
      );

      if (messageScore >= processingThreshold) {
        shouldProcess = true;
        processingReason = `LLM分析分数 (${
          messageScore.toFixed(3)
        }) >= 阈值 (${processingThreshold})`;
      } else {
        processingReason = `LLM分析分数 (${
          messageScore.toFixed(3)
        }) < 阈值 (${processingThreshold})`;
        console.log(
          `[Telegram] 忽略消息 (原因: ${processingReason}): 用户 ${userId} 在群组 ${chatId}`,
        );
        return;
      }
    }

    // --- 3. 处理消息 ---
    if (shouldProcess) {
      console.log(
        `[Telegram] 处理消息 (原因: ${processingReason}): 用户 ${userId}(${
          ctx.from?.username || ctx.from?.first_name
        }) 在 ${isPrivate ? "私聊" : `群组 ${chatId}`}`,
      );
      const processStartTime = Date.now();

      try {
        // 发送"正在输入"状态
        await ctx.sendChatAction("typing");

        // 确定 RAG 上下文
        const currentRAGContextId = chatContextMap.get(sourceContextId) ||
          sourceContextId;

        console.log(
          `[Telegram][${sourceContextId}]->[RAG] 开始处理 (当前 RAG 上下文: ${currentRAGContextId})`,
        );

        // 调用核心 RAG 逻辑
        const result = await handleIncomingMessage(
          analysisInput,
          currentRAGContextId,
          "telegram",
        );

        // 更新 RAG 上下文映射
        if (result.newContextId !== currentRAGContextId) {
          console.log(
            `[调试 Telegram] 来源 ${sourceContextId}: RAG 上下文已更新为: ${result.newContextId}`,
          );
          chatContextMap.set(sourceContextId, result.newContextId);
        } else {
          if (!chatContextMap.has(sourceContextId)) {
            chatContextMap.set(sourceContextId, currentRAGContextId);
          }
        }

        // 发送回复
        const finalResponse = result.responseText;
        if (finalResponse && finalResponse.trim().length > 0) {
          const messageParts = splitMessage(finalResponse);
          for (const part of messageParts) {
            if (part.trim().length === 0) continue;
            try {
              await ctx.reply(part);
              await new Promise((resolve) => setTimeout(resolve, 100));
            } catch (sendError) {
              console.error(
                `[Telegram][${sourceContextId}] 发送消息失败:`,
                sendError,
              );
              break;
            }
          }
        } else {
          console.log(
            `[Telegram][${sourceContextId}] RAG 返回了空响应，不发送消息。`,
          );
        }

        const processEndTime = Date.now();
        console.log(
          `[Telegram][${sourceContextId}]<-[RAG] 消息处理完成。(耗时: ${
            (processEndTime - processStartTime) / 1000
          } 秒)`,
        );
      } catch (error) {
        const processEndTime = Date.now();
        console.error(
          `[Telegram][${sourceContextId}] 处理消息或回复时出错 (耗时: ${
            (processEndTime - processStartTime) / 1000
          } 秒):`,
          error,
        );
        try {
          await ctx.reply("抱歉，我在处理你的消息时好像遇到了一点小麻烦... 🤯");
        } catch (sendError) {
          console.error(
            `[Telegram][${sourceContextId}] 发送错误提示消息也失败了:`,
            sendError,
          );
        }
      }
    }
  });

  // 错误处理
  bot.catch((err, _ctx) => {
    console.error(`[Telegram] Bot 错误:`, err);
  });

  // 优雅停止
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

// --- 5. 历史记录获取功能 ---
/**
 * 获取 Telegram 聊天历史记录
 * @param telegramContextId RAG 上下文 ID (例如 telegram_chat_123 或 telegram_private_456)
 * @param limit 获取的最大消息数量
 * @returns 返回 ChatMessageInput 数组或 null（如果出错）
 */
export function fetchTelegramHistory(
  telegramContextId: string,
  _limit: number,
): Promise<ChatMessageInput[] | null> {
  if (!telegramBot) {
    console.warn(
      "[Telegram] fetchTelegramHistory called before Telegram bot was initialized.",
    );
    return Promise.resolve(null);
  }

  let chatId: string | null = null;
  let _isPrivate = false;

  if (telegramContextId.startsWith(DEFAULT_CONTEXT_PREFIX_CHAT)) {
    chatId = telegramContextId.substring(DEFAULT_CONTEXT_PREFIX_CHAT.length);
  } else if (telegramContextId.startsWith(DEFAULT_CONTEXT_PREFIX_PRIVATE)) {
    chatId = telegramContextId.substring(DEFAULT_CONTEXT_PREFIX_PRIVATE.length);
    _isPrivate = true;
  } else {
    console.error(
      `[Telegram] Invalid telegramContextId format: ${telegramContextId}`,
    );
    return Promise.resolve(null);
  }

  if (!chatId) {
    console.error(
      `[Telegram] Could not extract ID from telegramContextId: ${telegramContextId}`,
    );
    return Promise.resolve(null);
  }

  try {
    // 注意：Telegram Bot API 的历史记录获取功能有限
    // 这里我们只能模拟实现，实际上 Bot API 不提供获取历史消息的功能
    // 在实际应用中，需要在消息处理时主动存储历史记录
    console.warn(
      `[Telegram] 历史记录获取功能受限：Telegram Bot API 不支持获取历史消息。`,
    );
    console.warn(
      `[Telegram] 建议在消息处理时主动存储到 STM 或其他存储中。`,
    );

    return Promise.resolve([]); // 返回空数组
  } catch (error) {
    console.error(
      `[Telegram] Error fetching history for ${telegramContextId}:`,
      error,
    );
    return Promise.resolve(null);
  }
}

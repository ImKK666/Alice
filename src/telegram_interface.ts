// src/telegram_interface.ts
/**
 * Telegram Bot 交互模块
 *
 * 负责处理 Telegram Bot 的消息接收、处理和回复，
 * 与现有的聊天架构无缝集成。
 */

import { Context, Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { config } from "./config.ts";
import type { ChatMessageInput } from "./memory_processor.ts";
import {
  analyzeMessageForMemory,
  type MessageAnalysisResult,
} from "./memory_processor.ts";
import { handleIncomingMessage } from "./message_handler.ts";
import { createModuleLogger } from "./utils/logger.ts";
import { PerformanceMonitor } from "./utils/performance.ts";
import { executeParallelTasks } from "./utils/async_utils.ts";
import { BaseError } from "./errors.ts";

// --- 1. 定义 Telegram 客户端 ---
let telegramBot: Telegraf | null = null;
let isShuttingDown = false;

// 状态管理: { chatId (string): lastRAGContextId (string) }
const chatContextMap = new Map<string, string>();
const DEFAULT_CONTEXT_PREFIX_CHAT = "telegram_chat_";
const DEFAULT_CONTEXT_PREFIX_PRIVATE = "telegram_private_";

// 日志和性能监控
const telegramLogger = createModuleLogger("Telegram");
const performanceMonitor = PerformanceMonitor.getInstance();

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
  const operationId = `telegram_start_${Date.now()}`;
  performanceMonitor.startOperation(operationId, "Telegram启动", "Bot初始化");

  try {
    // --- 配置验证 ---
    telegramLogger.info("开始启动 Telegram Bot");

    if (!config.telegramBotToken) {
      const error = new BaseError(
        "TELEGRAM_BOT_TOKEN 未设置",
        { module: "telegram" },
        "critical",
      );
      telegramLogger.critical("配置错误", error);
      throw error;
    }

    if (!config.telegramOwnerId) {
      telegramLogger.warn("TELEGRAM_OWNER_ID 未设置，部分功能可能受影响");
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
    console.log(`[Telegram][调试] 🔧 设置事件监听器...`);

    // 消息处理 - 必须在 launch() 之前设置！
    bot.on(message("text"), async (ctx) => {
      // --- 1. 过滤 ---
      if (ctx.from?.is_bot) {
        console.log("[Telegram][调试] 忽略机器人消息");
        return; // 忽略机器人消息
      }

      const userId = ctx.from?.id?.toString() || "";
      const chatId = ctx.chat?.id?.toString() || "";
      const isPrivate = ctx.chat?.type === "private";
      const text = ctx.message.text || "";
      const username = ctx.from?.username || "未知用户";
      const firstName = ctx.from?.first_name || "";

      console.log("=".repeat(60));
      console.log(`[Telegram][调试] 📨 收到新消息`);
      console.log(`  用户ID: ${userId}`);
      console.log(`  用户名: ${username}`);
      console.log(`  姓名: ${firstName}`);
      console.log(`  聊天ID: ${chatId}`);
      console.log(`  聊天类型: ${ctx.chat?.type}`);
      console.log(`  是否私聊: ${isPrivate}`);
      console.log(`  消息长度: ${text.length}`);
      console.log(
        `  消息内容: "${text.substring(0, 100)}${
          text.length > 100 ? "..." : ""
        }"`,
      );
      console.log(`  消息ID: ${ctx.message.message_id}`);
      console.log(
        `  时间戳: ${new Date(ctx.message.date * 1000).toLocaleString()}`,
      );

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
      console.log(`[Telegram][调试] 🧠 开始 LLM 消息分析...`);
      const analysisOperationId = `telegram_analysis_${Date.now()}_${userId}`;
      performanceMonitor.startOperation(
        analysisOperationId,
        "消息分析",
        `用户${userId}`,
      );

      try {
        telegramLogger.info(
          `开始分析消息`,
          { userId, chatId, isPrivate, textLength: text.length },
          userId,
        );
        console.log(`[Telegram][调试] 调用 analyzeMessageForMemory...`);
        llmAnalysisResult = await analyzeMessageForMemory(analysisInput);
        console.log(`[Telegram][调试] ✅ LLM 分析完成:`, {
          memory_type: llmAnalysisResult?.memory_type,
          importance_score: llmAnalysisResult?.importance_score,
          emotional_arousal: llmAnalysisResult?.emotional_arousal,
        });
        performanceMonitor.endOperation(
          analysisOperationId,
          "消息分析",
          `用户${userId}`,
        );
      } catch (err) {
        console.log(`[Telegram][调试] ❌ LLM 分析失败:`, err);
        performanceMonitor.endOperation(
          analysisOperationId,
          "消息分析",
          `用户${userId}`,
        );
        telegramLogger.error(
          "消息分析失败",
          err instanceof Error ? err : undefined,
          { userId, chatId, textLength: text.length },
          userId,
        );
      }

      // 判断是否处理
      console.log(`[Telegram][调试] 🤔 决定是否处理消息...`);
      console.log(`  配置的主人ID: ${config.telegramOwnerId || "未设置"}`);
      console.log(`  总是回复主人: ${config.telegramAlwaysReplyToOwner}`);
      console.log(`  处理阈值: ${processingThreshold}`);

      if (isPrivate) {
        shouldProcess = true;
        processingReason = "私聊消息";
        console.log(`[Telegram][调试] ✅ 决定处理: ${processingReason}`);
      } else if (
        config.telegramAlwaysReplyToOwner && config.telegramOwnerId &&
        userId === config.telegramOwnerId
      ) {
        shouldProcess = true;
        processingReason = "主人消息 (强制回复)";
        console.log(`[Telegram][调试] ✅ 决定处理: ${processingReason}`);
      } else {
        // 群组普通消息：根据 LLM 分析结果打分
        console.log(
          `[Telegram][调试] 群组 ${chatId} 消息来自普通用户，使用 LLM 分析结果计算权重...`,
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
          console.log(`[Telegram][调试] ✅ 决定处理: ${processingReason}`);
        } else {
          processingReason = `LLM分析分数 (${
            messageScore.toFixed(3)
          }) < 阈值 (${processingThreshold})`;
          console.log(`[Telegram][调试] ❌ 决定忽略: ${processingReason}`);
          console.log(
            `[Telegram] 忽略消息 (原因: ${processingReason}): 用户 ${userId} 在群组 ${chatId}`,
          );
          return;
        }
      }

      // --- 3. 🚀 异步优化的消息处理 ---
      if (shouldProcess) {
        console.log(`[Telegram][调试] 🚀 开始异步优化的消息处理...`);
        const messageOperationId = `telegram_message_${Date.now()}_${userId}`;
        performanceMonitor.startOperation(
          messageOperationId,
          "消息处理",
          `用户${userId}`,
        );

        telegramLogger.info(
          `开始处理消息`,
          {
            userId,
            chatId,
            isPrivate,
            processingReason,
            username: ctx.from?.username,
            firstName: ctx.from?.first_name,
          },
          userId,
        );
        const processStartTime = Date.now();

        try {
          // 🔥 阶段1：立即响应 - 快速状态反馈
          console.log(`[Telegram][异步] 📝 阶段1: 立即状态反馈...`);
          const immediateActions = [
            {
              name: "发送输入状态",
              task: () => ctx.sendChatAction("typing"),
              timeout: 3000,
              priority: 1,
              fallbackValue: null
            }
          ];

          // 确定 RAG 上下文
          const currentRAGContextId = chatContextMap.get(sourceContextId) || sourceContextId;

          console.log(`[Telegram][异步] 🧠 准备异步处理流程:`);
          console.log(`  源上下文ID: ${sourceContextId}`);
          console.log(`  当前RAG上下文ID: ${currentRAGContextId}`);
          console.log(`  平台: telegram`);

          // 执行立即响应
          const immediateResults = await executeParallelTasks(immediateActions, {
            timeout: 5000
          });
          console.log(`[Telegram][异步] ✅ 立即响应完成 (${immediateResults[0].duration}ms)`);

          // 🔥 阶段2：核心处理 - 异步生成回复
          console.log(`[Telegram][异步] 🔄 阶段2: 开始核心处理...`);

          // 创建一个Promise来处理核心逻辑，同时继续发送状态更新
          const coreProcessingPromise = handleIncomingMessage(
            analysisInput,
            currentRAGContextId,
            "telegram",
          );

          // 🔥 阶段3：状态保持 - 定期发送"正在输入"状态
          const statusUpdateInterval = setInterval(async () => {
            try {
              await ctx.sendChatAction("typing");
              console.log(`[Telegram][异步] 📝 状态更新: 继续输入中...`);
            } catch (err) {
              console.warn(`[Telegram][异步] ⚠️ 状态更新失败:`, err);
            }
          }, 4000); // 每4秒更新一次状态

          // 等待核心处理完成
          let result;
          try {
            result = await coreProcessingPromise;
            clearInterval(statusUpdateInterval);
            console.log(`[Telegram][异步] ✅ 核心处理完成:`, {
              newContextId: result.newContextId,
              responseLength: result.responseText?.length || 0,
              hasResponse: !!result.responseText?.trim(),
              totalDuration: Date.now() - processStartTime
            });
          } catch (coreError) {
            clearInterval(statusUpdateInterval);
            throw coreError;
          }

          // 更新 RAG 上下文映射
          if (result.newContextId !== currentRAGContextId) {
            console.log(
              `[Telegram][异步] 🔄 RAG 上下文已更新: ${sourceContextId} -> ${result.newContextId}`,
            );
            chatContextMap.set(sourceContextId, result.newContextId);
          } else {
            if (!chatContextMap.has(sourceContextId)) {
              chatContextMap.set(sourceContextId, currentRAGContextId);
            }
          }

          // 🔥 阶段4：智能回复发送 - 异步分段发送
          const finalResponse = result.responseText;
          console.log(`[Telegram][异步] 📤 阶段4: 准备智能发送回复:`);
          console.log(`  回复长度: ${finalResponse?.length || 0}`);
          console.log(
            `  有效回复: ${!!(finalResponse && finalResponse.trim().length > 0)}`,
          );

          if (finalResponse && finalResponse.trim().length > 0) {
            const messageParts = splitMessage(finalResponse);
            console.log(
              `[Telegram][异步] 📝 分割为 ${messageParts.length} 个部分`,
            );

            // 🔥 并行发送优化：如果只有一个部分，直接发送；多个部分则异步发送
            if (messageParts.length === 1) {
              // 单个消息，直接发送
              try {
                console.log(`[Telegram][异步] 📨 发送单个回复 (${messageParts[0].length} 字符)...`);
                await ctx.reply(messageParts[0]);
                console.log(`[Telegram][异步] ✅ 单个回复发送成功`);
              } catch (sendError) {
                console.error(`[Telegram][异步] ❌ 发送回复失败:`, sendError);
                telegramLogger.error("发送回复失败", sendError instanceof Error ? sendError : undefined, { userId, chatId }, userId);
              }
            } else {
              // 多个部分，使用异步发送任务
              const sendTasks = messageParts
                .filter(part => part.trim().length > 0)
                .map((part, index) => ({
                  name: `发送回复部分${index + 1}`,
                  task: async () => {
                    // 为后续部分添加延迟，避免过快发送
                    if (index > 0) {
                      await new Promise(resolve => setTimeout(resolve, 200 * index));
                    }
                    await ctx.reply(part);
                    return `第${index + 1}部分发送成功`;
                  },
                  timeout: 10000,
                  priority: index + 1, // 按顺序优先级
                  fallbackValue: `第${index + 1}部分发送失败`
                }));

              console.log(`[Telegram][异步] 🔄 开始并行发送 ${sendTasks.length} 个回复部分...`);
              const sendResults = await executeParallelTasks(sendTasks, {
                timeout: 30000 // 总超时30秒
              });

              // 统计发送结果
              const successCount = sendResults.filter(r => r.success).length;
              const failureCount = sendResults.length - successCount;

              console.log(`[Telegram][异步] 📊 回复发送统计:`);
              console.log(`  成功: ${successCount}/${sendResults.length}`);
              console.log(`  失败: ${failureCount}/${sendResults.length}`);

              if (failureCount > 0) {
                telegramLogger.warn(`部分回复发送失败`, {
                  userId, chatId, successCount, failureCount,
                  failures: sendResults.filter(r => !r.success).map(r => r.taskName)
                }, userId);
              }
            }

            console.log(`[Telegram][异步] 🎉 回复发送流程完成`);
          } else {
            console.log(
              `[Telegram][调试] ⚠️ RAG 返回了空响应，不发送消息。`,
            );
          }

          const processEndTime = Date.now();
          const duration = (processEndTime - processStartTime) / 1000;

          performanceMonitor.endOperation(
            messageOperationId,
            "消息处理",
            `用户${userId}`,
          );
          telegramLogger.performance(
            "消息处理完成",
            duration * 1000,
            undefined,
            { sourceContextId, userId },
            userId,
          );
        } catch (error) {
          const processEndTime = Date.now();
          const duration = (processEndTime - processStartTime) / 1000;

          performanceMonitor.endOperation(
            messageOperationId,
            "消息处理",
            `用户${userId}`,
          );
          telegramLogger.error(
            "消息处理失败",
            error instanceof Error ? error : undefined,
            { sourceContextId, userId, duration },
            userId,
          );

          try {
            await ctx.reply(
              "抱歉，我在处理你的消息时好像遇到了一点小麻烦... 🤯",
            );
          } catch (sendError) {
            telegramLogger.error(
              "发送错误提示消息失败",
              sendError instanceof Error ? sendError : undefined,
              { sourceContextId, userId },
              userId,
            );
          }
        }
      }
    });

    // 错误处理
    bot.catch((err, ctx) => {
      console.log(`[Telegram][调试] ❌ Bot 错误:`, err);
      telegramLogger.error(
        "Telegram Bot 错误",
        err instanceof Error ? err : undefined,
        {
          chatId: ctx?.chat?.id,
          userId: ctx?.from?.id,
          messageId: ctx?.message?.message_id,
        },
      );
    });

    // 添加更多事件监听器用于调试
    bot.on("message", (ctx) => {
      console.log(`[Telegram][调试] 📨 收到任何类型的消息:`, {
        from: ctx.from?.id,
        chat: ctx.chat?.id,
        hasText: "text" in ctx.message!,
        messageId: ctx.message.message_id,
      });
    });

    // 启动 Bot - 必须在所有事件监听器设置完成后
    console.log(`[Telegram][调试] 🚀 启动 Bot...`);
    try {
      await bot.launch();
      console.log(`[Telegram][调试] ✅ bot.launch() 成功完成`);
      console.log(`✅ Telegram Bot 已成功连接并准备就绪！`);
      console.log(`   - 配置的主人 ID: ${config.telegramOwnerId || "未设置"}`);
      console.log(`   - 消息处理分数阈值: ${processingThreshold}`);
      console.log("👂 正在监听消息...");
      console.log("----------------------------------------------");
    } catch (launchError) {
      console.log(`[Telegram][调试] ❌ bot.launch() 失败:`, launchError);
      throw launchError;
    }

    // 优雅停止 - 使用 Deno 的信号处理
    const cleanup = () => {
      if (!isShuttingDown) {
        isShuttingDown = true;
        telegramLogger.info("正在停止 Telegram Bot...");
        bot.stop("SIGINT");
        telegramLogger.info("Telegram Bot 已停止");
      }
    };

    // 使用 Deno 的信号监听器
    try {
      Deno.addSignalListener("SIGINT", cleanup);
      if (Deno.build.os !== "windows") {
        Deno.addSignalListener("SIGTERM", cleanup);
      }
    } catch (error) {
      telegramLogger.warn(
        "无法添加信号监听器",
        undefined,
        undefined,
        undefined,
      );
      console.warn("信号监听器错误:", error);
    }

    performanceMonitor.endOperation(operationId, "Telegram启动", "Bot初始化");
    telegramLogger.info("Telegram Bot 启动完成");
  } catch (error) {
    performanceMonitor.endOperation(operationId, "Telegram启动", "Bot初始化");
    telegramLogger.critical(
      "Telegram Bot 启动失败",
      error instanceof Error ? error : undefined,
    );
    throw error;
  }
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

  if (telegramContextId.startsWith(DEFAULT_CONTEXT_PREFIX_CHAT)) {
    chatId = telegramContextId.substring(DEFAULT_CONTEXT_PREFIX_CHAT.length);
  } else if (telegramContextId.startsWith(DEFAULT_CONTEXT_PREFIX_PRIVATE)) {
    chatId = telegramContextId.substring(DEFAULT_CONTEXT_PREFIX_PRIVATE.length);
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

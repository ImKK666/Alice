// src/discord_interface.ts (修改后，使用 LLM 分析结果评分)

import {
  ChannelType,
  Client,
  DMChannel, // 用于类型检查
  Events,
  GatewayIntentBits, // v14 使用 GatewayIntentBits
  Message,
  Partials, // 可能需要处理 Partial 消息
  TextChannel, // 用于类型检查
} from "npm:discord.js@14"; // 从 npm 导入 discord.js v14

// --- 修改：导入 config 以获取配置 ---
import { config } from "./config.ts";
import type { ChatMessageInput } from "./memory_processor.ts";
// 注意：导入新的 analyzeMessageForMemory 函数和结果类型
import {
  analyzeMessageForMemory,
  type MemoryType, // 导入 MemoryType 类型
  type MessageAnalysisResult,
} from "./memory_processor.ts"; // 导入 LTM 分析函数和结果类型
import { handleIncomingMessage } from "./main.ts"; // 确保 main 导出了 handleIncomingMessage
// 注意：移除了 jiebaCut 的导入，因为不再需要分词来匹配关键词

// 状态管理: { channelId (string): lastRAGContextId (string) }
// discord.js v14 的 ID 通常是字符串
const channelContextMap = new Map<string, string>();
const DEFAULT_CONTEXT_PREFIX_CHANNEL = "discord_channel_";
const DEFAULT_CONTEXT_PREFIX_DM = "discord_dm_";

// 辅助函数：分割长消息 (保持不变)
function splitMessage(text: string, maxLength = 1990): string[] { // 稍微减小长度以防万一
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
      currentPart = ""; // 重置
    } else if (currentPart.length + line.length + 1 <= maxLength) {
      currentPart += (currentPart.length > 0 ? "\n" : "") + line;
    } else {
      messages.push(currentPart);
      currentPart = line; // 新的一行开始
    }
  }
  if (currentPart.length > 0) {
    messages.push(currentPart);
  }
  return messages.length > 0 ? messages : [""]; // 确保不返回空数组
}

/**
 * (重写) 计算消息的重要性分数 (0.0 - 1.0)，使用 LLM 分析结果。
 * @param message Discord 消息对象
 * @param llmAnalysisResult 从 analyzeMessageForMemory 获取的分析结果
 * @param client Discord 客户端实例 (用于获取 botId)
 * @returns 消息的重要性分数
 */
function calculateMessageImportanceScore(
  message: Message,
  llmAnalysisResult: MessageAnalysisResult | null, // 允许传入 null 表示分析失败
  client: Client, // 传入 client 以获取 botId
): number {
  // --- 初始化 ---
  let score = 0.0;
  const stepLogs: string[] = []; // 用于记录每步计算

  stepLogs.push(`[调试][权重V2] 初始分数: 0.000`);

  // --- 基本信息 ---
  const authorId = message.author.id;
  const botId = client.user?.id; // 从传入的 client 获取 botId
  const text = message.content || ""; // 获取文本内容

  // --- 配置读取 ---
  const ownerId = config.discordOwnerId;

  // --- 1. 基于 LLM 分析结果的基础分 ---
  let baseLlmScore = 0.1; // 默认基础分很低
  if (llmAnalysisResult) {
    const { memory_type, importance_score, emotional_arousal } =
      llmAnalysisResult;
    stepLogs.push(
      `  - LLM分析: 类型=${memory_type}, 重要性=${importance_score}, 唤醒度=${
        emotional_arousal.toFixed(2)
      }`,
    );

    // a. 根据记忆类型赋分 (主要影响因素)
    const typeScoreMap: Record<string, number> = { // 使用 string 防止类型错误
      "task": 0.7, // 任务最重要
      "question": 0.6, // 问题也比较重要 (假设LLM能识别)
      "fact": 0.4, // 事实中等
      "preference": 0.4, // 偏好中等
      "emotional_response": 0.4, // 情感表达中等 (如果唤醒度高会加分)
      "summary": 0.3,
      "joke_or_banter": 0.2,
      "conversation_turn": 0.1, // 普通对话分数最低
      "reflection": 0.1,
      "persona_trait": 0.1,
      "unknown": 0.05, // 未知类型分数极低
    };
    baseLlmScore = typeScoreMap[memory_type] ?? 0.05; // 使用映射，未知给最低分
    stepLogs.push(
      `  + 基础分 (来自类型 ${memory_type}): +${baseLlmScore.toFixed(3)}`,
    );

    // b. 根据重要性评分 (1-5) 调整分数 (次要影响因素)
    // 将 1-5 分映射到 -0.1 到 +0.15 的调整量
    const importanceAdjustment = ((importance_score ?? 1) - 2.5) * 0.06; // 2.5为中点
    baseLlmScore += importanceAdjustment;
    stepLogs.push(
      `  + 重要性调整 (${importance_score}): ${
        importanceAdjustment >= 0 ? "+" : ""
      }${importanceAdjustment.toFixed(3)}`,
    );

    // c. 根据情感唤醒度调整分数 (次要影响因素)
    const arousalAdjustment = (emotional_arousal ?? 0) * 0.1; // 唤醒度越高，稍微增加重要性
    baseLlmScore += arousalAdjustment;
    stepLogs.push(
      `  + 情感唤醒度调整 (${emotional_arousal.toFixed(2)}): +${
        arousalAdjustment.toFixed(3)
      }`,
    );
  } else {
    // LLM 分析失败，给予一个较低的基础分
    baseLlmScore = 0.1;
    stepLogs.push(
      `  ! LLM分析失败，使用默认基础分: ${baseLlmScore.toFixed(3)}`,
    );
  }
  // 确保基础分不小于0
  baseLlmScore = Math.max(0, baseLlmScore);
  score += baseLlmScore;
  stepLogs.push(`  => LLM基础分后总分: ${score.toFixed(3)}`);

  // --- 2. 结合其他非词表因素 (权重相对降低，作为加分项) ---

  // a. 提及或回复机器人/主人
  let isMentionedBot = false;
  // 检查直接 @ 提及用户
  if (botId && message.mentions.users.has(botId)) {
    isMentionedBot = true;
  }
  // 检查是否提及机器人角色 (如果机器人有角色)
  if (
    !isMentionedBot && botId && message.guild && message.mentions.roles.size > 0
  ) {
    const botMember = message.guild.members.me; // 获取机器人自身的 GuildMember 对象
    if (
      botMember &&
      message.mentions.roles.some((role) => botMember.roles.cache.has(role.id))
    ) {
      isMentionedBot = true;
    }
  }

  const isMentionedOwner = ownerId && text.includes(ownerId); // 简单名字/ID包含检查
  // 注意：这里不再检查 ownerNicknames 或 botNames 的包含，因为主要依赖 @ 提及

  let mentionBonus = 0;
  if (isMentionedBot) {
    mentionBonus = 0.5; // 直接提及机器人加分仍然较高
    stepLogs.push(`  + 直接提及机器人: +${mentionBonus.toFixed(3)}`);
  } else if (isMentionedOwner) { // 只有在没有提及机器人的情况下才检查主人
    mentionBonus = 0.6; // 提及主人加分最高
    stepLogs.push(`  + 提及主人 (ID): +${mentionBonus.toFixed(3)}`);
  }
  score += mentionBonus;
  stepLogs.push(`  => 提及后分数: ${score.toFixed(3)}`);

  // b. 回复状态
  let replyBonus = 0;
  if (message.reference?.messageId) {
    let baseReplyBonus = 0.05; // 基础回复加分降低
    replyBonus += baseReplyBonus;
    stepLogs.push(`  + 基础回复: +${baseReplyBonus.toFixed(3)}`);

    // 尝试异步获取被回复者信息 (优化：可以提前获取或缓存)
    // 为避免阻塞评分，这里简化判断：如果LLM分析结果是任务/问题，则增加回复权重
    // 这不是最准确的，但避免了在评分函数中再次异步 fetch
    if (
      llmAnalysisResult &&
      (llmAnalysisResult.memory_type === "task" ||
        llmAnalysisResult.memory_type === "question") // 假设 LLM 能识别问题类型
    ) {
      let taskQuestionReplyBonus = 0.15;
      replyBonus += taskQuestionReplyBonus;
      stepLogs.push(
        `  + 回复疑似任务/问题: +${taskQuestionReplyBonus.toFixed(3)}`,
      );
    }
  }
  score += replyBonus;
  stepLogs.push(`  => 回复后分数: ${score.toFixed(3)}`);

  // c. 消息长度 (影响降低)
  const length = text.length;
  let lengthBonus = 0;
  if (length > 200) lengthBonus = 0.1;
  else if (length > 100) lengthBonus = 0.07;
  else if (length > 50) lengthBonus = 0.04;
  score += lengthBonus;
  stepLogs.push(`  + 长度奖励 (${length}): +${lengthBonus.toFixed(3)}`);
  stepLogs.push(`  => 长度后分数: ${score.toFixed(3)}`);

  // d. 代码块 / 链接 (影响降低)
  const hasCodeBlock = text.includes("```");
  let codeBonus = hasCodeBlock ? 0.1 : 0;
  score += codeBonus;
  stepLogs.push(`  + 代码块奖励 (${hasCodeBlock}): +${codeBonus.toFixed(3)}`);

  const hasLink = /https?:\/\/[^\s]+/.test(text);
  let linkBonus = hasLink ? 0.05 : 0;
  score += linkBonus;
  stepLogs.push(`  + 链接奖励 (${hasLink}): +${linkBonus.toFixed(3)}`);
  stepLogs.push(`  => 附加奖励后分数: ${score.toFixed(3)}`);

  // --- 最终分数限制 ---
  const finalScore = Math.max(0, Math.min(1.0, score)); // 分数限制在 0-1

  // --- 打印详细步骤日志 ---
  console.log("[调试][权重V2] 计算过程:");
  stepLogs.forEach((log) => console.log(log));
  console.log(`[调试][权重V2] 最终分数 (限制在0-1): ${finalScore.toFixed(3)}`);

  return finalScore;
}

/**
 * 启动 Discord 机器人接口 (修改版)
 */
export async function startDiscord(): Promise<void> {
  // --- 配置验证 ---
  if (!config.discordBotToken) {
    console.error("❌ 错误：DISCORD_BOT_TOKEN 未设置。无法启动 Discord 接口。");
    Deno.exit(1);
  }
  if (!config.discordOwnerId) {
    console.warn(
      "⚠️ 警告：DISCORD_OWNER_ID 未设置，部分功能（如主人识别）可能受影响。",
    );
  }
  // 注意：这里的阈值现在是基于 LLM 分析后的分数
  const processingThreshold = config.discordProcessingThreshold ?? 0.35; // 默认阈值可以适当调整，比如 0.35
  console.log(
    `[Discord] LLM 分析评分模式已启用。处理阈值: ${processingThreshold}`,
  );

  // --- 初始化 discord.js Client ---
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent, // 必须开启以读取消息内容
      GatewayIntentBits.GuildMembers, // 如果需要访问成员信息
    ],
    partials: [Partials.Channel], // 需要 Partials.Channel 才能接收 DM 事件
  });

  // --- 事件处理 ---

  // Ready 事件
  client.once(Events.ClientReady, (readyClient) => { // 使用 once 确保只执行一次
    console.log(`✅ Discord Bot 已成功连接并准备就绪！`);
    console.log(`   - 用户名: ${readyClient.user.tag}`);
    console.log(`   - 机器人用户 ID: ${readyClient.user.id}`);
    console.log(`   - 配置的主人 ID: ${config.discordOwnerId || "未设置"}`);
    console.log(`   - 消息处理分数阈值 (基于LLM分析): ${processingThreshold}`); // 更新日志说明
    console.log("👂 正在监听消息...");
    console.log("----------------------------------------------");
  });

  // MessageCreate 事件
  client.on(Events.MessageCreate, async (message: Message) => {
    // --- 1. 过滤 ---
    if (message.author.bot) return; // 忽略机器人消息
    if (!message.content && message.attachments.size === 0) return; // 忽略空消息（无文本无附件）

    const authorId = message.author.id;
    const channelId = message.channel.id;
    const isDM = message.channel.type === ChannelType.DM;
    const botId = client.user?.id; // 在事件处理函数内部获取 botId
    let isMentionedBot = false; // 检查是否提及机器人或其角色

    // 检查直接 @ 提及用户
    if (botId && message.mentions.users.has(botId)) {
      isMentionedBot = true;
    }
    // 检查是否提及机器人角色 (如果机器人有角色)
    if (
      !isMentionedBot && botId && message.guild &&
      message.mentions.roles.size > 0
    ) {
      const botMember = message.guild.members.me; // 获取机器人自身的 GuildMember 对象
      if (
        botMember &&
        message.mentions.roles.some((role) =>
          botMember.roles.cache.has(role.id)
        )
      ) {
        isMentionedBot = true;
      }
    }

    // --- 2. 决定是否处理 ---
    let shouldProcess = false;
    let processingReason = "默认忽略"; // 处理原因（用于日志）
    let llmAnalysisResult: MessageAnalysisResult | null = null; // 存储分析结果
    const analysisInput: ChatMessageInput = { // 提前构造分析输入
      userId: authorId,
      // contextId 会根据 DM 或频道设置
      contextId: isDM
        ? `${DEFAULT_CONTEXT_PREFIX_DM}${authorId}`
        : `${DEFAULT_CONTEXT_PREFIX_CHANNEL}${channelId}`,
      text: message.content || "",
      messageId: message.id,
      timestamp: message.createdTimestamp || Date.now(),
    };

    const sourceContextId = analysisInput.contextId; // 复用上面构造的 contextId

    // 尝试执行 LLM 分析 (无论是否需要评分，后续流程可能都需要)
    // 将分析放在前面，即使是 DM 或主人消息也分析，简化流程
    try {
      console.log(
        `[Discord][分析尝试] 用户 ${authorId} 在 ${
          isDM ? "私聊" : "频道 " + channelId
        }...`,
      );
      llmAnalysisResult = await analyzeMessageForMemory(analysisInput);
    } catch (err) {
      console.error(
        `[Discord][分析] 分析消息失败 (用户 ${authorId}): ${err.message}`,
      );
      // 分析失败，llmAnalysisResult 将为 null
    }

    // 现在根据条件判断是否处理
    if (isDM) {
      shouldProcess = true;
      processingReason = "私聊消息";
    } else if (
      config.discordAlwaysReplyToOwner && config.discordOwnerId &&
      authorId === config.discordOwnerId
    ) {
      shouldProcess = true;
      processingReason = "主人消息 (强制回复)";
    } else if (isMentionedBot) { // 使用上面计算好的 isMentionedBot
      shouldProcess = true;
      processingReason = "提及机器人";
    } else {
      // 频道普通消息：根据 LLM 分析结果打分
      console.log(
        `[Discord] 频道 ${channelId} 消息来自普通用户，使用 LLM 分析结果计算权重...`,
      );
      // *** 使用新的评分函数 ***
      // 传入 client 实例以获取 botId
      const messageScore = calculateMessageImportanceScore(
        message,
        llmAnalysisResult, // 传入之前分析的结果 (可能为 null)
        client, // 传入 client
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
          `[Discord] 忽略消息 (原因: ${processingReason}): 用户 ${authorId} 在频道 ${channelId}`,
        );
        return; // 分数不够，直接返回
      }
    }

    // --- 3. 处理消息 ---
    if (shouldProcess) {
      console.log(
        `[Discord] 处理消息 (原因: ${processingReason}): 用户 ${authorId}(${message.author.username}) 在 ${
          isDM
            ? "私聊"
            : `频道 ${channelId}(${(message.channel as TextChannel)?.name})`
        }`,
      );
      const processStartTime = Date.now();
      try {
        await message.channel.sendTyping();

        // 确定原始来源 ID 和初始 RAG 上下文 ID
        const currentRAGContextId = channelContextMap.get(sourceContextId) ||
          sourceContextId;

        // RAG 输入 (已经构造好 analysisInput)
        const chatInput = analysisInput;

        console.log(
          `[Discord][${sourceContextId}]->[RAG] 开始处理 (当前 RAG 上下文: ${currentRAGContextId})`,
        );

        // 调用核心 RAG 逻辑
        const result = await handleIncomingMessage(
          chatInput,
          currentRAGContextId,
          "discord",
        );

        // 更新 RAG 上下文映射
        if (result.newContextId !== currentRAGContextId) {
          console.log(
            `[调试 Discord] 来源 ${sourceContextId}: RAG 上下文已更新为: ${result.newContextId}`,
          );
          channelContextMap.set(sourceContextId, result.newContextId);
        } else {
          if (!channelContextMap.has(sourceContextId)) {
            channelContextMap.set(sourceContextId, currentRAGContextId);
          }
        }

        // 发送消息
        let finalResponse = result.responseText;
        if (finalResponse && finalResponse.trim().length > 0) {
          const messageParts = splitMessage(finalResponse);
          let isFirstPart = true;
          for (const part of messageParts) {
            if (part.trim().length === 0) continue;
            if (isFirstPart) {
              try {
                await message.reply({
                  content: part,
                  allowedMentions: { repliedUser: false },
                });
              } catch (replyError) {
                console.warn(
                  `[Discord][${sourceContextId}] 回复消息失败，尝试直接发送: ${replyError}`,
                );
                try {
                  await message.channel.send({ content: part });
                } catch (sendError) {
                  console.error(
                    `[Discord][${sourceContextId}] 直接发送也失败了:`,
                    sendError,
                  );
                }
              }
              isFirstPart = false;
            } else {
              try {
                await message.channel.send({ content: part });
              } catch (sendError) {
                console.error(
                  `[Discord][${sourceContextId}] 发送后续消息部分失败:`,
                  sendError,
                );
                break;
              }
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        } else {
          console.log(
            `[Discord][${sourceContextId}] RAG 返回了空响应，不发送消息。`,
          );
        }

        console.log("[调试] 最终日志前检查:", {
          sourceContextId,
          currentRAGContextId,
          analysisInputExists: !!analysisInput,
        });

        const processEndTime = Date.now();
        console.log(
          `[Discord][${sourceContextId}]<-[RAG] 消息处理完成。(耗时: ${
            (processEndTime - processStartTime) / 1000
          } 秒)`,
        );
      } catch (error) {
        const processEndTime = Date.now();
        console.error(
          `[Discord][${sourceContextId}] 处理消息或回复时出错 (耗时: ${
            (processEndTime - processStartTime) / 1000
          } 秒):`,
          error,
        );
        try {
          await message.channel.send({
            content: "抱歉，我在处理你的消息时好像遇到了一点小麻烦... 🤯",
          });
        } catch (sendError) {
          console.error(
            `[Discord][${sourceContextId}] 发送错误提示消息也失败了:`,
            sendError,
          );
        }
      }
    }
  });

  // 处理潜在的错误和警告 (保持不变)
  client.on(Events.Error, console.error);
  client.on(Events.Warn, console.warn);

  // --- 登录 Bot --- (保持不变)
  try {
    console.log("▶️ 正在登录 Discord Bot...");
    await client.login(config.discordBotToken);
  } catch (error) {
    console.error("❌ 登录 Discord Bot 失败:", error);
    Deno.exit(1);
  }
}

// src/discord_interface.ts (修改版，使用动态权重打分判断消息处理)

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
import { handleIncomingMessage } from "./main.ts"; // 确保 main 导出了 handleIncomingMessage
import { cut as jiebaCut } from "npm:jieba-wasm@latest";

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
 * 使用 jieba-wasm 进行分词
 * @param text 要分词的文本
 * @returns 分词后的单词数组，如果出错则回退
 */
function segmentChineseTextWasm(text: string): string[] {
  try {
    // 直接调用导入的 cut 函数，无需检查初始化状态
    // 第二个参数 true/false 控制是否使用 HMM 模型处理未登录词，可选
    return jiebaCut(text, true);
  } catch (error) {
    console.error("[Discord][分词] 使用 jieba-wasm 分词时出错:", error);
    // 出错时回退到简单按空格分割
    return text.split(/\s+/);
  }
}

/**
 * 计算消息的重要性分数 (0.0 - 1.0)，用于决定是否处理非强制处理的消息。
 * (修改版：增加详细调试输出)
 * @param message Discord 消息对象
 * @returns 一个 Promise，解析为消息的重要性分数
 */
async function calculateMessageImportanceScore(
  message: Message,
): Promise<number> {
  const text = message.content;
  // --- 基本过滤 ---
  if (!text || text.trim().length < 5) {
    console.log(`[调试][权重] 消息过短 (< 5 chars)，最终分数: 0.0`);
    return 0.0;
  }

  // --- 初始化 ---
  let score = 0.0; // 初始分数
  let debugLog = ""; // 用于旧格式日志
  const stepLogs: string[] = []; // 用于记录每步计算

  stepLogs.push(`[调试][权重] 初始分数: ${score.toFixed(3)}`);

  const lowerCaseText = text.toLowerCase(); // 提及判断可能仍需小写原文
  const authorId = message.author.id;
  const botId = message.client.user?.id;

  // --- 配置读取 ---
  const ownerId = config.discordOwnerId;
  const ownerNicknames = config.ownerNicknames || [];
  const botNames = config.botNames || ["爱丽丝", "Alice"];
  const importantKeywords = config.importantKeywords || [];
  const actionVerbs = config.actionVerbs || [];

  // --- 权重计算步骤 ---

  // 1. 提及或回复机器人/主人 (更高权重)
  let mentionedBot = botNames.some((name) =>
    lowerCaseText.includes(name.toLowerCase())
  );
  let mentionedOwner = (ownerId && text.includes(ownerId)) ||
    ownerNicknames.some((nick) => text.includes(nick));
  let isMentionedBot = false; // 标记是否是直接 @ 提及

  if (botId && message.mentions.users.has(botId)) {
    mentionedBot = true;
    isMentionedBot = true; // 标记直接提及
  }

  let mentionScore = 0;
  if (isMentionedBot) {
    mentionScore = 0.8;
    stepLogs.push(`  + 直接提及机器人: +${mentionScore.toFixed(3)}`);
  } else if (mentionedBot) {
    mentionScore = 0.5;
    stepLogs.push(`  + 名字提及机器人: +${mentionScore.toFixed(3)}`);
  }
  if (mentionedOwner) {
    // 如果同时提及机器人和主人，取最高分（避免叠加过多）
    const ownerScore = 0.9;
    if (ownerScore > mentionScore) {
      mentionScore = ownerScore; // 更新为主人提及分
      stepLogs.push(`  * (覆盖)提及主人: +${mentionScore.toFixed(3)}`);
    } else {
      stepLogs.push(
        `  + 提及主人 (已覆盖机器人提及分): +${
          ownerScore.toFixed(3)
        }, 但已有更高分`,
      );
    }
  }
  score += mentionScore;
  stepLogs.push(`  => 提及后分数: ${score.toFixed(3)}`);
  debugLog += `提及:${mentionScore.toFixed(2)} | `; // 保留旧日志格式部分

  // --- 分词处理 (增加日志) ---
  stepLogs.push(`[调试][分词] 准备分词...`);
  console.log(`[调试][分词] 输入文本: "${text}"`);
  const segmentedWords = segmentChineseTextWasm(text); // 调用分词函数
  console.log(`[调试][分词] 输出词语: [${segmentedWords.join(", ")}]`);
  const wordSet = new Set(segmentedWords); // 转为 Set 方便查找
  stepLogs.push(`  - 分词完成，共 ${wordSet.size} 个独立词语。`);

  // 2. 包含重要关键词 (使用分词结果)
  const matchedKeywords = importantKeywords.filter((kw) => wordSet.has(kw));
  let keywordCount = matchedKeywords.length;
  let keywordScore = Math.min(0.5, keywordCount * 0.15); // 调整权重和上限
  score += keywordScore;
  stepLogs.push(
    `  + 关键词 (${keywordCount})${
      matchedKeywords.length > 0 ? ` [${matchedKeywords.join(",")}]` : ""
    }: +${keywordScore.toFixed(3)}`,
  );
  stepLogs.push(`  => 关键词后分数: ${score.toFixed(3)}`);
  debugLog += `关键词(${keywordCount}):${keywordScore.toFixed(2)} | `;

  // 3. 包含动作意图词 (使用分词结果)
  const matchedActionVerbs = actionVerbs.filter((verb) => wordSet.has(verb));
  let actionVerbCount = matchedActionVerbs.length;
  let actionScore = Math.min(0.4, actionVerbCount * 0.1); // 调整权重和上限
  score += actionScore;
  stepLogs.push(
    `  + 动作词 (${actionVerbCount})${
      matchedActionVerbs.length > 0 ? ` [${matchedActionVerbs.join(",")}]` : ""
    }: +${actionScore.toFixed(3)}`,
  );
  stepLogs.push(`  => 动作词后分数: ${score.toFixed(3)}`);
  debugLog += `动作词(${actionVerbCount}):${actionScore.toFixed(2)} | `;

  // 4. 是否为回复消息 (回复机器人权重提高)
  let replyScore = 0;
  if (message.reference?.messageId) {
    let repliedToWho = "未知用户";
    let baseReplyScore = 0.1; // 基础回复分
    replyScore += baseReplyScore;
    stepLogs.push(`  + 基础回复: +${baseReplyScore.toFixed(3)}`);
    try {
      const repliedToMessage = await message.channel.messages.fetch(
        message.reference.messageId,
      );
      repliedToWho = repliedToMessage.author.tag;
      if (botId && repliedToMessage.author.id === botId) {
        let botReplyBonus = 0.5;
        replyScore += botReplyBonus; // 大幅提高回复机器人的权重
        stepLogs.push(`  + 回复机器人: +${botReplyBonus.toFixed(3)}`);
      } else if (ownerId && repliedToMessage.author.id === ownerId) {
        let ownerReplyBonus = 0.3;
        replyScore += ownerReplyBonus; // 回复主人权重
        stepLogs.push(`  + 回复主人: +${ownerReplyBonus.toFixed(3)}`);
      }
    } catch (fetchError) {
      console.warn(`[Discord][权重计算] 获取被回复消息失败: ${fetchError}`);
      repliedToWho = "获取失败";
    }
    stepLogs.push(`  - 回复目标: ${repliedToWho}`);
  }
  score += replyScore; // 更新分数
  stepLogs.push(`  => 回复后分数: ${score.toFixed(3)}`);
  debugLog += `回复:${replyScore.toFixed(2)} | `;

  // 5. 是否为提问 (新增维度)
  const isQuestion = text.includes("?") || text.includes("？") ||
    /^(how|what|why|when|where|who|请问|如何|怎样|什么|为什么|吗)/i.test(
      text.trim(),
    );
  let questionScore = isQuestion ? 0.4 : 0; // 提问给予较高权重
  score += questionScore;
  stepLogs.push(`  + 提问 (${isQuestion}): +${questionScore.toFixed(3)}`);
  stepLogs.push(`  => 提问后分数: ${score.toFixed(3)}`);
  debugLog += `提问:${questionScore.toFixed(2)} | `;

  // 6. 消息长度加权 (分段函数)
  const length = text.length;
  let lengthScore = 0;
  if (length > 150) lengthScore = 0.2;
  else if (length > 80) lengthScore = 0.15;
  else if (length > 40) lengthScore = 0.1;
  else if (length > 15) lengthScore = 0.05;
  score += lengthScore;
  stepLogs.push(`  + 长度 (${length}): +${lengthScore.toFixed(3)}`);
  stepLogs.push(`  => 长度后分数: ${score.toFixed(3)}`);
  debugLog += `长度(${length}):${lengthScore.toFixed(2)} | `;

  // 7. 包含代码块
  const hasCodeBlock = text.includes("```");
  let codeScore = hasCodeBlock ? 0.15 : 0;
  score += codeScore;
  stepLogs.push(`  + 代码块 (${hasCodeBlock}): +${codeScore.toFixed(3)}`);
  stepLogs.push(`  => 代码块后分数: ${score.toFixed(3)}`);
  debugLog += `代码块:${codeScore.toFixed(2)} | `;

  // 8. 包含链接
  const hasLink = /https?:\/\/[^\s]+/.test(text);
  let linkScore = hasLink ? 0.1 : 0;
  score += linkScore;
  stepLogs.push(`  + 链接 (${hasLink}): +${linkScore.toFixed(3)}`);
  stepLogs.push(`  => 链接后分数: ${score.toFixed(3)}`);
  debugLog += `链接:${linkScore.toFixed(2)}`;

  // --- 最终分数限制 ---
  const finalScore = Math.max(0, Math.min(1.0, score)); // 分数限制在 0-1

  // --- 打印详细步骤日志 ---
  console.log("[调试][权重] 计算过程:");
  stepLogs.forEach((log) => console.log(log));
  console.log(`[调试][权重] 最终分数 (限制在0-1): ${finalScore.toFixed(3)}`);

  // 打印旧格式日志，以便你之前的日志对比
  console.log(
    `   [分数详情] ${debugLog} => 最终分数: ${finalScore.toFixed(3)}`,
  );

  return finalScore; // 返回最终分数
}

/**
 * 启动 Discord 机器人接口 (使用 discord.js)
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
  const processingThreshold = config.discordProcessingThreshold ?? 0.6; // 获取阈值或使用默认值

  console.log("▶️ 正在初始化 Discord Bot (discord.js v14)...");

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
    console.log(`   - 频道消息处理分数阈值: ${processingThreshold}`);
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
    const botId = client.user?.id;
    const mentionsBot = botId
      ? message.mentions.users.has(botId) ||
        message.mentions.roles.some((role) =>
          message.guild?.members.me?.roles.cache.has(role.id) ?? false
        )
      : false; // 检查是否提及机器人或其角色

    // --- 2. 决定是否处理 ---
    let shouldProcess = false;
    let processingReason = "默认忽略"; // 处理原因（用于日志）

    if (isDM) {
      shouldProcess = true;
      processingReason = "私聊消息";
    } else if (
      config.discordAlwaysReplyToOwner && config.discordOwnerId &&
      authorId === config.discordOwnerId
    ) {
      shouldProcess = true;
      processingReason = "主人消息 (强制回复)";
    } else if (mentionsBot) {
      shouldProcess = true;
      processingReason = "提及机器人";
    } else {
      // 频道消息，需要打分判断
      console.log(
        `[Discord] 频道 ${channelId} 消息来自普通用户，开始计算权重...`, // 中文日志
      );
      // 调用 calculateMessageImportanceScore (它内部会用新分词逻辑)
      const messageScore = await calculateMessageImportanceScore(message); // 使用 await 调用

      if (messageScore >= processingThreshold) {
        shouldProcess = true;
        processingReason = `消息分数 (${
          messageScore.toFixed(3)
        }) >= 阈值 (${processingThreshold})`;
      } else {
        processingReason = `消息分数 (${
          messageScore.toFixed(3)
        }) < 阈值 (${processingThreshold})`;
        console.log(
          `[Discord] 忽略消息 (原因: ${processingReason}): 用户 ${authorId} 在频道 ${channelId}`, // 中文日志
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
        }`, // 中文日志
      );
      const processStartTime = Date.now();
      try {
        // 显示"正在输入"状态
        await message.channel.sendTyping();

        // 确定 RAG 上下文 ID
        const contextPrefix = isDM
          ? DEFAULT_CONTEXT_PREFIX_DM
          : DEFAULT_CONTEXT_PREFIX_CHANNEL;
        const sourceContextId = `${contextPrefix}${
          isDM ? authorId : channelId
        }`; // 原始来源ID
        const currentRAGContextId = channelContextMap.get(sourceContextId) ||
          sourceContextId; // 获取当前RAG上下文，或使用来源ID作为默认值

        console.log(
          `[调试 Discord] 来源 ${sourceContextId}: 调用 RAG 前的上下文 ID: ${currentRAGContextId}`, // 中文调试
        );

        // 构造输入
        const chatInput: ChatMessageInput = {
          userId: authorId,
          contextId: sourceContextId, // 使用 Discord 频道/用户 ID 作为来源标识
          text: message.content || "", // 确保 text 存在
          messageId: message.id,
          timestamp: message.createdTimestamp || Date.now(),
        };

        console.log(
          `[Discord][${sourceContextId}]->[RAG] 开始处理 (当前 RAG 上下文: ${currentRAGContextId})`, // 中文日志
        );

        // 调用核心 RAG 逻辑
        const result = await handleIncomingMessage(
          chatInput,
          currentRAGContextId, // 传递当前的 RAG 上下文状态
          "discord",
        );

        // 更新 RAG 上下文映射
        if (result.newContextId !== currentRAGContextId) {
          console.log(
            `[调试 Discord] 来源 ${sourceContextId}: RAG 上下文已更新为: ${result.newContextId}`, // 中文调试
          );
          channelContextMap.set(sourceContextId, result.newContextId);
        } else {
          // 如果上下文没有改变，确保映射存在（对于首次交互）
          if (!channelContextMap.has(sourceContextId)) {
            channelContextMap.set(sourceContextId, currentRAGContextId);
          }
        }

        // 格式化回复
        let finalResponse = result.responseText;

        // --- 发送消息 ---
        if (finalResponse && finalResponse.trim().length > 0) {
          const messageParts = splitMessage(finalResponse);
          let isFirstPart = true;
          for (const part of messageParts) {
            if (part.trim().length === 0) continue; // 跳过空部分

            if (isFirstPart) {
              try {
                // 尝试回复原始消息
                await message.reply({
                  content: part,
                  allowedMentions: { repliedUser: false }, // 不 ping 用户
                });
              } catch (replyError) {
                console.warn(
                  `[Discord][${sourceContextId}] 回复消息失败，尝试直接发送: ${replyError}`, // 中文日志
                );
                try {
                  await message.channel.send({ content: part });
                } catch (sendError) {
                  console.error(
                    `[Discord][${sourceContextId}] 直接发送也失败了:`, // 中文日志
                    sendError,
                  );
                }
              }
              isFirstPart = false;
            } else {
              // 发送后续部分
              try {
                await message.channel.send({ content: part });
              } catch (sendError) {
                console.error(
                  `[Discord][${sourceContextId}] 发送后续消息部分失败:`, // 中文日志
                  sendError,
                );
                break; // 如果发送失败，停止发送后续部分
              }
            }
            // 添加微小延迟避免速率限制
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        } else {
          console.log(
            `[Discord][${sourceContextId}] RAG 返回了空响应，不发送消息。`, // 中文日志
          );
        }

        const processEndTime = Date.now();
        console.log(
          `[Discord][${sourceContextId}]<-[RAG] 消息处理完成。(耗时: ${
            (processEndTime - processStartTime) / 1000
          } 秒)`, // 中文日志
        );
      } catch (error) {
        const processEndTime = Date.now();
        console.error(
          `[Discord][${sourceContextId}] 处理消息或回复时出错 (耗时: ${
            (processEndTime - processStartTime) / 1000
          } 秒):`, // 中文日志
          error,
        );
        try {
          await message.channel.send({
            content: "抱歉，我在处理你的消息时好像遇到了一点小麻烦... 🤯",
          });
        } catch (sendError) {
          console.error(
            `[Discord][${sourceContextId}] 发送错误提示消息也失败了:`, // 中文日志
            sendError,
          );
        }
      }
    }
  });

  // 处理潜在的错误和警告 (保持不变)
  client.on(Events.Error, console.error);
  client.on(Events.Warn, console.warn);
  // 可以添加更多的事件监听器，例如处理断开连接和重连

  // --- 登录 Bot ---
  try {
    console.log("▶️ 正在登录 Discord Bot..."); // 中文日志
    await client.login(config.discordBotToken);
  } catch (error) {
    console.error("❌ 登录 Discord Bot 失败:", error); // 中文日志
    Deno.exit(1);
  }
}

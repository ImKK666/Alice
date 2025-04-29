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

// --- 新增：消息重要性打分函数 ---
/**
 * 计算消息的重要性分数 (0.0 - 1.0)，用于决定是否处理非强制处理的消息。
 * @param message Discord 消息对象
 * @returns 一个 Promise，解析为消息的重要性分数
 */
async function calculateMessageImportanceScore(
  message: Message,
): Promise<number> {
  let score = 0.0;
  const text = message.content;
  const lowerCaseText = text.toLowerCase();
  const authorId = message.author.id;
  const botId = message.client.user?.id;

  // --- 基本过滤 ---
  if (!text || text.trim().length < 5) return 0.0;

  // --- 配置读取 ---
  const ownerId = config.discordOwnerId;
  const ownerNicknames = config.ownerNicknames || [];
  const botNames = config.botNames || ["爱丽丝", "Alice"];
  const importantKeywords = config.importantKeywords || [];
  const actionVerbs = config.actionVerbs || [];

  // --- 权重计算 ---
  let debugLog = "";

  // 1. 提及特定名称 (高权重)
  let mentionedBot = botNames.some((name) =>
    lowerCaseText.includes(name.toLowerCase())
  );
  let mentionedOwner = (ownerId && text.includes(ownerId)) ||
    ownerNicknames.some((nick) => text.includes(nick));
  if (mentionedBot) score += 0.5;
  if (mentionedOwner) score += 0.6; // 提及主人权重更高
  debugLog += `mention(${mentionedBot}/${mentionedOwner}):${
    (mentionedBot ? 0.5 : 0) + (mentionedOwner ? 0.6 : 0)
  } | `;

  // 2. 包含重要关键词 (中/高权重)
  let keywordCount = importantKeywords.filter((kw) => text.includes(kw)).length;
  let keywordScore = Math.min(0.4, keywordCount * 0.1); // 每个关键词0.1，上限0.4
  score += keywordScore;
  debugLog += `keyword(${keywordCount}):${keywordScore.toFixed(2)} | `;

  // 3. 包含动作意图词 (中等权重)
  let actionVerbCount =
    actionVerbs.filter((verb) => text.includes(verb)).length;
  let actionScore = Math.min(0.3, actionVerbCount * 0.08); // 每个动词0.08，上限0.3
  score += actionScore;
  debugLog += `action(${actionVerbCount}):${actionScore.toFixed(2)} | `;

  // 4. 是否为回复消息 (中等权重)
  let replyScore = 0;
  if (message.reference?.messageId) {
    replyScore += 0.1; // 基础回复分
    try {
      // 尝试获取被回复消息，增加延迟，但可以提高准确性
      const repliedToMessage = await message.channel.messages.fetch(
        message.reference.messageId,
      );
      if (repliedToMessage.author.id === botId) replyScore += 0.25; // 回复机器人
      if (ownerId && repliedToMessage.author.id === ownerId) replyScore += 0.3; // 回复主人
    } catch { /* 获取失败忽略 */ }
    score += replyScore;
    debugLog += `reply:${replyScore.toFixed(2)} | `;
  }

  // 5. 消息长度加权 (非线性，长消息加分多)
  const lengthFactor = Math.log10(Math.max(10, text.length)) - 1; // log10(10)=1 -> 0分; log10(100)=2 -> 1分...
  let lengthScore = Math.min(0.2, Math.max(0, lengthFactor * 0.1)); // 长度得分上限0.2
  score += lengthScore;
  debugLog += `len(${text.length}):${lengthScore.toFixed(2)} | `;

  // 6. 包含代码块
  if (text.includes("```")) score += 0.1;
  debugLog += `code:${text.includes("```") ? 0.1 : 0} | `;

  // 7. 包含链接
  if (/https?:\/\/[^\s]+/.test(text)) score += 0.05;
  debugLog += `link:${/https?:\/\/[^\s]+/.test(text) ? 0.05 : 0}`;

  // --- 最终分数限制 ---
  const finalScore = Math.max(0, Math.min(1.0, score)); // 确保分数在 0 到 1 之间
  console.log(
    `   [Score] Details: ${debugLog} => Final Score: ${finalScore.toFixed(3)}`,
  );
  return finalScore;
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
  const processingThreshold = config.discordProcessingThreshold ?? 0.6; // 获取阈值

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
    let processingReason = "默认忽略";

    if (isDM) {
      shouldProcess = true;
      processingReason = "私聊消息";
    } else if (
      config.discordAlwaysReplyToOwner && config.discordOwnerId &&
      authorId === config.discordOwnerId
    ) { // <--- 新增：检查强制回复主人的开关
      shouldProcess = true;
      processingReason = "主人消息 (强制回复)"; // 理由可以明确一点
    } else if (mentionsBot) {
      shouldProcess = true;
      processingReason = "提及机器人";
    } else {
      // 频道消息，需要打分判断
      console.log(
        `[Discord] 频道 ${channelId} 消息来自普通用户，开始计算权重...`,
      );
      const messageScore = await calculateMessageImportanceScore(message);

      if (messageScore >= processingThreshold) {
        shouldProcess = true;
        processingReason = `消息分数 (${
          messageScore.toFixed(3)
        }) >= 阈值 (${processingThreshold})`;
      } else {
        processingReason = `消息分数 (${
          messageScore.toFixed(3)
        }) < 阈值 (${processingThreshold})`;
        // 分数不够，直接返回，不处理
        console.log(
          `[Discord] 忽略消息 (原因: ${processingReason}): 用户 ${authorId} 在频道 ${channelId}`,
        );
        return; // 移除了原先的主人检查，因为上面已经用开关处理了
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
          `[调试 Discord] 来源 ${sourceContextId}: 调用 RAG 前的上下文 ID: ${currentRAGContextId}`,
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
          `[Discord][${sourceContextId}]->[RAG] 开始处理 (当前 RAG 上下文: ${currentRAGContextId})`,
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
            `[调试 Discord] 来源 ${sourceContextId}: RAG 上下文已更新为: ${result.newContextId}`,
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
        // 不再自动添加主人称呼，因为Prompt中已经处理了
        // if (config.discordOwnerId && authorId === config.discordOwnerId) {
        //   finalResponse = `${config.discordOwnerGreeting}，${finalResponse}`;
        // }

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
              // 发送后续部分
              try {
                await message.channel.send({ content: part });
              } catch (sendError) {
                console.error(
                  `[Discord][${sourceContextId}] 发送后续消息部分失败:`,
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
            `[Discord][${sourceContextId}] RAG 返回了空响应，不发送消息。`,
          );
        }

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
    // 如果 shouldProcess 为 false，上面已经 return 了，这里无需处理
  });

  // 处理潜在的错误和警告 (保持不变)
  client.on(Events.Error, console.error);
  client.on(Events.Warn, console.warn);
  // 可以添加更多的事件监听器，例如处理断开连接和重连

  // --- 登录 Bot ---
  try {
    console.log("▶️ 正在登录 Discord Bot...");
    await client.login(config.discordBotToken);
  } catch (error) {
    console.error("❌ 登录 Discord Bot 失败:", error);
    Deno.exit(1);
  }
}

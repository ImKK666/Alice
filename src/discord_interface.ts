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
} from "discord.js"; // 从 discord.js 导入
// import { Buffer } from 'node:buffer'; // 如果需要处理 Buffer

// --- 修改：导入 config 以获取配置 ---
import { config } from "./config.ts";
import type { ChatMessageInput } from "./memory_processor.ts";
import { handleIncomingMessage } from "./main.ts";

// 状态管理: { channelId (string): lastRAGContextId (string) }
// discord.js v14 的 ID 通常是字符串
const channelContextMap = new Map<string, string>();
const DEFAULT_CONTEXT_PREFIX = "discord_channel_";

// 辅助函数：简单地分割长消息 (保持不变)
function splitMessage(text: string, maxLength = 2000): string[] {
  const messages: string[] = [];
  let currentPart = "";
  // 简单的按换行符或长度分割
  const lines = text.split("\n");
  for (const line of lines) {
    if (currentPart.length + line.length + 1 <= maxLength) {
      currentPart += (currentPart ? "\n" : "") + line;
    } else {
      if (currentPart) messages.push(currentPart);
      // 如果单行就超长，需要强制分割
      if (line.length <= maxLength) {
        currentPart = line;
      } else {
        let tempLine = line;
        while (tempLine.length > 0) {
          messages.push(tempLine.substring(0, maxLength));
          tempLine = tempLine.substring(maxLength);
        }
        currentPart = ""; // 重置
      }
    }
  }
  if (currentPart) messages.push(currentPart);
  // 如果分割后为空（比如原消息为空），至少返回一个空字符串数组避免错误
  return messages.length > 0 ? messages : [""];
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
  const text = message.content; // 不需要转小写，因为配置里的词也可能区分大小写
  const lowerCaseText = text.toLowerCase(); // 准备一个小写版本用于不区分大小写的匹配
  const authorId = message.author.id;
  const botId = message.client.user?.id; // 获取机器人自己的ID

  // --- 基本过滤 ---
  if (text.trim().length < 5) return 0.0; // 太短的消息直接给0分

  // --- 配置读取 (假设已在 config.ts 中定义) ---
  const ownerId = config.discordOwnerId;
  const ownerNicknames: string[] =
    (config.ownerNicknames as string[] | undefined) || []; // 主人昵称列表
  const botNames: string[] = (config.botNames as string[] | undefined) ||
    ["爱丽丝", "Alice"]; // 机器人名字列表
  const importantKeywords: string[] =
    (config.importantKeywords as string[] | undefined) || [
      "提醒",
      "待办",
      "总结",
      "记录",
      "重要",
      "问题",
      "请教",
      "疑问",
      "需要",
      "帮助",
      "查询",
      "进度",
      "确认",
      "安排",
      "会议",
      "报告",
      "截止日期",
      "ddl",
      "bug",
      "错误",
      "修复",
      "建议",
      "反馈",
      "?",
      "？", // 中英文问号也算关键词
    ];
  const actionVerbs: string[] = (config.actionVerbs as string[] | undefined) ||
    [
      "搜索",
      "查询",
      "查找",
      "记录",
      "更新",
      "安排",
      "确认",
      "完成",
      "分析",
      "处理",
      "执行",
      "开发",
      "测试",
      "部署",
      "启动",
      "停止",
    ];

  // --- 权重计算 ---

  // 1. 提及特定名称 (高权重)
  let mentionedSomeoneImportant = false;
  // 提及机器人名字
  if (botNames.some((name) => lowerCaseText.includes(name.toLowerCase()))) {
    score += 0.5;
    mentionedSomeoneImportant = true;
  }
  // 提及主人 ID 或昵称
  if (
    (ownerId && text.includes(ownerId)) ||
    ownerNicknames.some((nick) => text.includes(nick))
  ) {
    // 确保 ownerId 存在再检查 includes
    score += 0.5; // 提及主人权重可以更高
    mentionedSomeoneImportant = true;
  }
  console.log(
    `   [Score] 提及重要名称检查: ${mentionedSomeoneImportant}, 当前分数: ${
      score.toFixed(2)
    }`,
  );

  // 2. 包含重要关键词 (中/高权重)
  let keywordFound = false;
  if (importantKeywords.some((kw) => text.includes(kw))) {
    score += 0.3;
    keywordFound = true;
  }
  console.log(
    `   [Score] 重要关键词检查: ${keywordFound}, 当前分数: ${score.toFixed(2)}`,
  );

  // 3. 包含动作意图词 (中等权重)
  let actionVerbFound = false;
  if (actionVerbs.some((verb) => text.includes(verb))) {
    score += 0.2;
    actionVerbFound = true;
  }
  console.log(
    `   [Score] 动作意图词检查: ${actionVerbFound}, 当前分数: ${
      score.toFixed(2)
    }`,
  );

  // 4. 是否为回复消息 (中等权重)
  let isReply = false;
  if (message.reference?.messageId) {
    isReply = true;
    score += 0.15; // 回复消息基础权重
    // 可选：检查回复的是谁 (异步操作，会增加延迟，如果需要可以取消注释)
    try {
      console.log("   [Score] 正在检查被回复的消息...");
      const repliedToMessage = await message.channel.messages.fetch(
        message.reference.messageId,
      );
      if (repliedToMessage.author.id === botId) {
        score += 0.2; // 回复机器人，更高权重
        console.log("   [Score] 检测到回复机器人!");
      }
      if (ownerId && repliedToMessage.author.id === ownerId) {
        score += 0.25; // 回复主人，最高权重
        console.log("   [Score] 检测到回复主人!");
      }
    } catch (fetchError) {
      console.warn("   [Score] 获取被回复消息失败:", fetchError);
    }
  }
  console.log(
    `   [Score] 是否回复检查: ${isReply}, 当前分数: ${score.toFixed(2)}`,
  );

  // 5. 消息长度加权 (对数或分段效果可能更好，这里用简单线性)
  const lengthScore = Math.min(0.15, Math.max(0, text.length - 10) / 200.0); // 10字符以上开始加分，210字符达到上限0.15
  score += lengthScore;
  console.log(
    `   [Score] 长度加分: ${lengthScore.toFixed(2)}, 当前分数: ${
      score.toFixed(2)
    }`,
  );

  // 6. 包含代码块 (低权重)
  let hasCodeBlock = false;
  if (text.includes("```")) {
    score += 0.1;
    hasCodeBlock = true;
  }
  console.log(
    `   [Score] 代码块检查: ${hasCodeBlock}, 当前分数: ${score.toFixed(2)}`,
  );

  // 7. 包含链接 (较低权重)
  let hasLink = false;
  if (/https?:\/\/[^\s]+/.test(text)) {
    score += 0.05;
    hasLink = true;
  }
  console.log(`   [Score] 链接检查: ${hasLink}, 当前分数: ${score.toFixed(2)}`);

  // --- 最终分数限制 ---
  const finalScore = Math.max(0, Math.min(1.0, score)); // 确保分数在 0 到 1 之间
  console.log(`   [Score] 计算出的最终消息分数: ${finalScore.toFixed(3)}`);
  return finalScore;
}

/**
 * 启动 Discord 机器人接口 (使用 discord.js)
 */
export async function startDiscord(): Promise<void> {
  // --- 配置验证 ---
  if (!config.discordBotToken) {
    console.error("❌ 错误：DISCORD_BOT_TOKEN 未设置。");
    Deno.exit(1);
  }
  if (!config.discordOwnerId) {
    // ownerId 对于打分逻辑的“提及主人”部分很重要，改为错误或保留警告
    console.error("❌ 错误：DISCORD_OWNER_ID 未设置，部分权重计算将受影响。");
    // Deno.exit(1); // 或者直接退出
  }
  // --- 新增：读取处理阈值，提供默认值 ---
  const processingThreshold =
    (config.discordProcessingThreshold as number | undefined) ?? 0.6; // 默认阈值 0.6

  console.log("▶️ 正在初始化 Discord Bot (discord.js v14)...");

  // --- 初始化 discord.js Client ---
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent, // 必须开启
      GatewayIntentBits.GuildMembers, // 如果需要访问成员信息
    ],
    partials: [Partials.Channel], // 需要 Partials.Channel 才能接收 DM 事件
  });

  // --- 状态管理 ---
  // (channelContextMap 在上面定义了)

  // --- 事件处理 ---

  // Ready 事件
  client.on(Events.ClientReady, (readyClient) => {
    console.log(`✅ Discord Bot 已成功连接并准备就绪！`);
    console.log(`   - 用户名: ${readyClient.user.tag}`);
    console.log(`   - 机器人用户 ID: ${readyClient.user.id}`);
    console.log(`   - 配置的主人 ID: ${config.discordOwnerId || "未设置"}`);
    // 移除旧的回复概率日志，替换为阈值日志
    console.log(`   - 频道消息处理分数阈值: ${processingThreshold}`);
    console.log("👂 正在监听消息...");
    console.log("----------------------------------------------");
  });

  // MessageCreate 事件
  client.on(Events.MessageCreate, async (message: Message) => {
    // --- 1. 过滤机器人消息 ---
    if (message.author.bot) return;

    const authorId = message.author.id;
    const channelId = message.channel.id;
    const isDM = message.channel.type === ChannelType.DM;
    const mentionsBot = client.user
      ? message.mentions.users.has(client.user.id)
      : false;

    // --- 2. 决定是否处理 (修改后的逻辑) ---
    let shouldProcess = false;
    let processingReason = "未知"; // 初始化原因

    if (isDM) {
      shouldProcess = true;
      processingReason = "私聊消息";
    } else if (config.discordOwnerId && authorId === config.discordOwnerId) {
      shouldProcess = true;
      processingReason = "主人消息";
    } else if (mentionsBot) {
      shouldProcess = true;
      processingReason = "提及机器人";
    } else {
      // --- 使用动态权重打分逻辑 ---
      console.log(
        `[Discord] 频道 ${channelId} 消息来自普通用户，开始计算权重...`,
      );
      const messageScore = await calculateMessageImportanceScore(message); // 调用打分函数

      // 使用阈值判断
      if (messageScore >= processingThreshold) {
        shouldProcess = true;
        processingReason = `消息分数 (${
          messageScore.toFixed(3)
        }) >= 阈值 (${processingThreshold})`;
      } else {
        // 低于阈值，选择忽略 (可以根据需要添加基于概率的补充逻辑)
        processingReason = `消息分数 (${
          messageScore.toFixed(3)
        }) < 阈值 (${processingThreshold})`;
        console.log(
          `[Discord] 忽略消息 (原因: ${processingReason}): 用户 ${authorId} 在频道 ${channelId}`,
        );
        return; // 忽略这条消息
      }
      // --- 结束新逻辑 ---
    }

    // --- 3. 处理 ---
    if (shouldProcess && message.content) {
      // 打印处理原因日志
      console.log(
        `[Discord] 处理消息 (原因: ${processingReason}): 用户 ${authorId} 在频道 ${channelId}`,
      );
      const processStartTime = Date.now();
      try {
        // 开始打字指示器
        await message.channel.sendTyping();

        // 获取 RAG 上下文
        const currentContextId = channelContextMap.get(channelId) ||
          `${DEFAULT_CONTEXT_PREFIX}${channelId}`;

        console.log(
          `[调试 Discord] 频道 ${channelId}: 调用 RAG 前的上下文 ID: ${currentContextId}`,
        );

        // 构造输入
        const chatInput: ChatMessageInput = {
          userId: authorId,
          contextId: channelId, // 使用原始 Discord 频道/用户 ID 作为来源上下文
          text: message.content,
          messageId: message.id,
          timestamp: message.createdTimestamp || Date.now(),
        };

        console.log(
          `[Discord][${channelId}]->[RAG] 开始处理消息 (当前 RAG 上下文: ${currentContextId})`,
        );

        // 调用核心 RAG 逻辑
        const result = await handleIncomingMessage(
          chatInput,
          currentContextId, // 传递当前的 RAG 上下文状态
          "discord",
        );

        // 调试日志：打印返回的新上下文 ID
        console.log(
          `[调试 Discord] 频道 ${channelId}: 调用 RAG 后的上下文 ID: ${result.newContextId}`,
        );
        // 如果 RAG 上下文发生变化，更新 Map
        if (result.newContextId !== currentContextId) {
          console.log(
            `[调试 Discord] 频道 ${channelId}: 正在更新 channelContextMap。`,
          );
          channelContextMap.set(channelId, result.newContextId);
          // 打印更新确认日志
          console.log(
            `[Discord][${channelId}] RAG 上下文已更新为: ${result.newContextId}`,
          );
        }

        // 格式化回复 (保持不变)
        let finalResponse = result.responseText;
        if (config.discordOwnerId && authorId === config.discordOwnerId) {
          finalResponse = `${config.discordOwnerGreeting}，${finalResponse}`;
        }

        // --- 发送消息 (使用 discord.js v14，保持不变) ---
        const messageParts = splitMessage(finalResponse);
        for (const part of messageParts) {
          if (part === messageParts[0]) {
            try {
              await message.reply({
                content: part,
                allowedMentions: { repliedUser: false },
              });
            } catch (replyError) {
              console.warn(
                `[Discord][${channelId}] 回复消息失败，尝试直接发送: ${replyError}`,
              );
              await message.channel.send({ content: part });
            }
          } else {
            await message.channel.send({ content: part });
          }
        }

        const processEndTime = Date.now();
        console.log(
          `[Discord][${channelId}]<-[RAG] 消息处理完成，已回复。(耗时: ${
            (processEndTime - processStartTime) / 1000
          } 秒)`,
        );
      } catch (error) {
        const processEndTime = Date.now();
        console.error(
          `[Discord][${channelId}] 处理消息或回复时出错 (耗时: ${
            (processEndTime - processStartTime) / 1000
          } 秒):`,
          error,
        );
        try {
          await message.channel.send({
            content: "抱歉，处理你的消息时好像出了一点问题... 🤯",
          });
        } catch (sendError) {
          console.error(
            `[Discord][${channelId}] 发送错误提示消息也失败了:`,
            sendError,
          );
        }
      }
    }
    // 如果 shouldProcess 为 false 且 message.content 存在，但上面已经 return 了，所以这里不需要 else
    // 如果 shouldProcess 为 true 但 message.content 为空（例如只有附件），这里也不会执行
  });

  // 处理潜在的错误和警告 (保持不变)
  client.on(Events.Error, console.error);
  client.on(Events.Warn, console.warn);

  // --- 登录 Bot (保持不变) ---
  try {
    console.log("▶️ 正在登录 Discord Bot...");
    await client.login(config.discordBotToken);
  } catch (error) {
    console.error("❌ 登录 Discord Bot 失败:", error);
    Deno.exit(1);
  }
}

// 注意: 这个文件只导出了 startDiscord 函数，calculateMessageImportanceScore 是内部辅助函数。

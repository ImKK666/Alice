// test_telegram_debug.ts - Telegram Bot 调试测试脚本
/**
 * 这个脚本用于测试和调试 Telegram Bot 的配置和连接
 * 运行命令: deno run --allow-all test_telegram_debug.ts
 */

import { config } from "./src/config.ts";
import { Telegraf } from "telegraf";

console.log("🔍 Telegram Bot 调试测试开始");
console.log("=".repeat(60));

// 1. 检查环境变量配置
console.log("📋 1. 检查环境变量配置:");
console.log(`  TELEGRAM_BOT_TOKEN: ${config.telegramBotToken ? "✅ 已设置" : "❌ 未设置"}`);
console.log(`  TELEGRAM_OWNER_ID: ${config.telegramOwnerId ? `✅ ${config.telegramOwnerId}` : "❌ 未设置"}`);
console.log(`  TELEGRAM_OWNER_GREETING: ${config.telegramOwnerGreeting || "默认值"}`);
console.log(`  TELEGRAM_PROCESSING_THRESHOLD: ${config.telegramProcessingThreshold || "默认值"}`);
console.log(`  TELEGRAM_ALWAYS_REPLY_TO_OWNER: ${config.telegramAlwaysReplyToOwner}`);

if (!config.telegramBotToken) {
  console.log("❌ TELEGRAM_BOT_TOKEN 未设置，无法继续测试");
  Deno.exit(1);
}

// 2. 检查其他必需的配置
console.log("\n📋 2. 检查其他必需配置:");
console.log(`  DEEPSEEK_API_KEY: ${config.deepseekApiKey ? "✅ 已设置" : "❌ 未设置"}`);
console.log(`  SILICONFLOW_API_KEY: ${config.siliconflowApiKey ? "✅ 已设置" : "❌ 未设置"}`);
console.log(`  QDRANT_URL: ${config.qdrantUrl}`);

// 3. 测试 Telegram Bot 连接
console.log("\n🤖 3. 测试 Telegram Bot 连接:");

try {
  const bot = new Telegraf(config.telegramBotToken);
  
  console.log("📡 正在获取 Bot 信息...");
  const botInfo = await bot.telegram.getMe();
  
  console.log("✅ Bot 连接成功!");
  console.log(`  Bot 用户名: @${botInfo.username}`);
  console.log(`  Bot 名称: ${botInfo.first_name}`);
  console.log(`  Bot ID: ${botInfo.id}`);
  console.log(`  是否为 Bot: ${botInfo.is_bot}`);
  console.log(`  支持内联查询: ${botInfo.supports_inline_queries || false}`);
  
  // 4. 测试发送消息权限（如果设置了主人ID）
  if (config.telegramOwnerId) {
    console.log("\n📨 4. 测试发送消息权限:");
    try {
      const testMessage = `🧪 测试消息 - ${new Date().toLocaleString()}\n这是一条来自 Alice AI 的测试消息，用于验证 Bot 功能是否正常。`;
      
      console.log(`📤 正在向主人 (${config.telegramOwnerId}) 发送测试消息...`);
      await bot.telegram.sendMessage(config.telegramOwnerId, testMessage);
      console.log("✅ 测试消息发送成功!");
      
    } catch (sendError) {
      console.log("❌ 发送测试消息失败:");
      console.log(`  错误: ${sendError}`);
      console.log("  可能的原因:");
      console.log("  - 主人还没有与 Bot 开始对话");
      console.log("  - 主人 ID 不正确");
      console.log("  - Bot 没有发送消息的权限");
    }
  } else {
    console.log("\n⚠️ 4. 跳过消息发送测试 (未设置主人ID)");
  }
  
  // 5. 测试 Webhook 信息
  console.log("\n🔗 5. 检查 Webhook 状态:");
  try {
    const webhookInfo = await bot.telegram.getWebhookInfo();
    if (webhookInfo.url) {
      console.log(`  Webhook URL: ${webhookInfo.url}`);
      console.log(`  待处理更新数: ${webhookInfo.pending_update_count}`);
    } else {
      console.log("  ✅ 使用长轮询模式 (无 Webhook)");
    }
  } catch (webhookError) {
    console.log(`  ⚠️ 无法获取 Webhook 信息: ${webhookError}`);
  }
  
} catch (error) {
  console.log("❌ Bot 连接失败:");
  console.log(`  错误: ${error}`);
  console.log("  可能的原因:");
  console.log("  - Bot Token 无效");
  console.log("  - 网络连接问题");
  console.log("  - Telegram API 服务不可用");
  Deno.exit(1);
}

// 6. 检查依赖服务状态
console.log("\n🔧 6. 检查依赖服务状态:");

// 检查 Qdrant
try {
  console.log("📊 检查 Qdrant 连接...");
  const qdrantResponse = await fetch(`${config.qdrantUrl}/collections`);
  if (qdrantResponse.ok) {
    console.log("✅ Qdrant 连接正常");
  } else {
    console.log(`❌ Qdrant 连接失败: ${qdrantResponse.status}`);
  }
} catch (qdrantError) {
  console.log(`❌ Qdrant 连接失败: ${qdrantError}`);
  console.log("  请确保 Qdrant 服务正在运行 (运行 start-qdrant.bat)");
}

// 检查 LLM API
if (config.deepseekApiKey) {
  try {
    console.log("🧠 检查 LLM API 连接...");
    const llmResponse = await fetch(`${config.deepseekBaseUrl}/models`, {
      headers: {
        "Authorization": `Bearer ${config.deepseekApiKey}`,
      },
    });
    if (llmResponse.ok) {
      console.log("✅ LLM API 连接正常");
    } else {
      console.log(`❌ LLM API 连接失败: ${llmResponse.status}`);
    }
  } catch (llmError) {
    console.log(`❌ LLM API 连接失败: ${llmError}`);
  }
}

// 检查嵌入 API
if (config.siliconflowApiKey) {
  try {
    console.log("🔤 检查嵌入 API 连接...");
    const embeddingResponse = await fetch(`${config.siliconflowBaseUrl}/models`, {
      headers: {
        "Authorization": `Bearer ${config.siliconflowApiKey}`,
      },
    });
    if (embeddingResponse.ok) {
      console.log("✅ 嵌入 API 连接正常");
    } else {
      console.log(`❌ 嵌入 API 连接失败: ${embeddingResponse.status}`);
    }
  } catch (embeddingError) {
    console.log(`❌ 嵌入 API 连接失败: ${embeddingError}`);
  }
}

console.log("\n" + "=".repeat(60));
console.log("🎯 测试完成!");
console.log("\n💡 如果所有测试都通过，您可以尝试:");
console.log("   1. 运行: deno run --allow-all --unstable-kv src/main.ts --telegram");
console.log("   2. 向您的 Bot 发送消息进行测试");
console.log("\n🔍 如果遇到问题，请检查上述测试结果中的错误信息");

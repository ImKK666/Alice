// minimal_telegram_test.ts - 最简化的 Telegram Bot 测试
/**
 * 完全独立的测试，不依赖任何其他模块
 * 运行命令: deno run --allow-all minimal_telegram_test.ts
 */

import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";

// 直接从环境变量读取
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const OWNER_ID = Deno.env.get("TELEGRAM_OWNER_ID");

console.log("🧪 最简化 Telegram Bot 测试");
console.log("=".repeat(40));

if (!BOT_TOKEN) {
  console.log("❌ TELEGRAM_BOT_TOKEN 环境变量未设置");
  console.log("请在 .env 文件中设置 TELEGRAM_BOT_TOKEN");
  Deno.exit(1);
}

console.log("✅ Bot Token 已找到");
console.log(`📋 主人 ID: ${OWNER_ID || "未设置"}`);
console.log(`🔑 Token 长度: ${BOT_TOKEN.length}`);

try {
  console.log("🤖 创建 Telegraf 实例...");
  const bot = new Telegraf(BOT_TOKEN);
  
  console.log("🔧 设置事件监听器...");
  
  // 最基本的消息监听
  bot.on(message("text"), async (ctx) => {
    const userId = ctx.from?.id?.toString() || "unknown";
    const text = ctx.message.text;
    
    console.log(`📨 收到消息:`);
    console.log(`  用户: ${ctx.from?.first_name} (${userId})`);
    console.log(`  内容: "${text}"`);
    
    try {
      await ctx.reply(`✅ 收到: "${text}"`);
      console.log(`✅ 回复发送成功`);
    } catch (error) {
      console.log(`❌ 回复失败:`, error);
    }
  });
  
  // 错误处理
  bot.catch((err) => {
    console.log("❌ Bot 错误:", err);
  });
  
  console.log("🚀 启动 Bot...");
  await bot.launch();
  console.log("✅ Bot 启动成功！");
  console.log("💬 请发送消息测试");
  console.log("🛑 按 Ctrl+C 停止");
  
  // 优雅停止
  const cleanup = () => {
    console.log("\n⏹️ 停止 Bot...");
    bot.stop("SIGINT");
    Deno.exit(0);
  };
  
  Deno.addSignalListener("SIGINT", cleanup);
  
  // 保持运行
  await new Promise(() => {});
  
} catch (error) {
  console.log("❌ 启动失败:", error);
  console.log("\n可能的原因:");
  console.log("1. Bot Token 无效");
  console.log("2. 网络连接问题");
  console.log("3. Telegram API 不可用");
  Deno.exit(1);
}

// simple_telegram_test.ts - 简化的 Telegram Bot 测试
/**
 * 这个脚本用于测试 Telegram Bot 的基本消息接收功能
 * 运行命令: deno run --allow-all simple_telegram_test.ts
 */

import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { config } from "./src/config.ts";

console.log("🧪 简化 Telegram Bot 测试开始");
console.log("=".repeat(50));

if (!config.telegramBotToken) {
  console.log("❌ TELEGRAM_BOT_TOKEN 未设置");
  Deno.exit(1);
}

console.log("✅ Bot Token 已配置");
console.log(`📋 主人 ID: ${config.telegramOwnerId || "未设置"}`);

try {
  const bot = new Telegraf(config.telegramBotToken);
  
  console.log("🔧 设置事件监听器...");
  
  // 监听所有消息类型
  bot.on("message", (ctx) => {
    console.log("📨 收到消息 (任何类型):");
    console.log(`  用户ID: ${ctx.from?.id}`);
    console.log(`  聊天ID: ${ctx.chat?.id}`);
    console.log(`  消息ID: ${ctx.message.message_id}`);
    console.log(`  是否为文本: ${"text" in ctx.message}`);
    if ("text" in ctx.message) {
      console.log(`  文本内容: "${ctx.message.text}"`);
    }
  });
  
  // 专门监听文本消息
  bot.on(message("text"), async (ctx) => {
    console.log("📝 收到文本消息:");
    console.log(`  用户: ${ctx.from?.first_name} (@${ctx.from?.username})`);
    console.log(`  内容: "${ctx.message.text}"`);
    
    try {
      console.log("📤 发送回复...");
      await ctx.reply(`收到你的消息: "${ctx.message.text}"`);
      console.log("✅ 回复发送成功");
    } catch (error) {
      console.log("❌ 回复发送失败:", error);
    }
  });
  
  // 错误处理
  bot.catch((err, ctx) => {
    console.log("❌ Bot 错误:", err);
  });
  
  console.log("🚀 启动 Bot...");
  await bot.launch();
  
  console.log("✅ Bot 已启动并正在监听消息");
  console.log("💬 请向 Bot 发送消息进行测试");
  console.log("🛑 按 Ctrl+C 停止测试");
  
  // 优雅停止
  const cleanup = () => {
    console.log("\n⏹️ 停止 Bot...");
    bot.stop("SIGINT");
    console.log("✅ Bot 已停止");
    Deno.exit(0);
  };
  
  Deno.addSignalListener("SIGINT", cleanup);
  
  // 保持运行
  await new Promise(() => {});
  
} catch (error) {
  console.log("❌ 测试失败:", error);
  Deno.exit(1);
}

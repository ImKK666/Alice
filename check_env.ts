// check_env.ts - 检查环境变量
import { config } from "./src/config.ts";

console.log("🔍 检查环境变量:");
console.log(`TELEGRAM_BOT_TOKEN: ${config.telegramBotToken ? "✅ 已设置" : "❌ 未设置"}`);
console.log(`TELEGRAM_OWNER_ID: ${config.telegramOwnerId || "未设置"}`);

if (config.telegramBotToken) {
  console.log(`Token 长度: ${config.telegramBotToken.length}`);
  console.log(`Token 前缀: ${config.telegramBotToken.substring(0, 10)}...`);
} else {
  console.log("❌ 无法继续测试");
}

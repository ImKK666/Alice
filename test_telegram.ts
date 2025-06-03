#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env --allow-write --allow-ffi

/**
 * Telegram Bot 集成测试脚本
 *
 * 用于测试 Telegram Bot 的基本功能，包括：
 * 1. 配置验证
 * 2. Bot 连接测试
 * 3. 消息处理流程验证
 *
 * 使用方法：
 * 1. 在 .env 文件中设置 TELEGRAM_BOT_TOKEN 和 TELEGRAM_OWNER_ID
 * 2. 运行: deno run --allow-all test_telegram.ts
 */

import { config } from "./src/config.ts";

console.log("==============================================");
console.log("  Telegram Bot 集成测试");
console.log("==============================================");

// 1. 配置验证
console.log("\n📋 1. 配置验证...");
console.log(
  `   - Telegram Bot Token: ${
    config.telegramBotToken ? "✅ 已设置" : "❌ 未设置"
  }`,
);
console.log(
  `   - Telegram Owner ID: ${
    config.telegramOwnerId ? "✅ 已设置" : "❌ 未设置"
  }`,
);
console.log(`   - 处理阈值: ${config.telegramProcessingThreshold}`);
console.log(`   - 总是回复主人: ${config.telegramAlwaysReplyToOwner}`);

if (!config.telegramBotToken) {
  console.error("\n❌ 错误：TELEGRAM_BOT_TOKEN 未设置！");
  console.error("请在 .env 文件中设置 TELEGRAM_BOT_TOKEN");
  console.error("获取方式：");
  console.error("1. 在 Telegram 中搜索 @BotFather");
  console.error("2. 发送 /newbot 创建新机器人");
  console.error("3. 按照指示设置机器人名称和用户名");
  console.error("4. 复制获得的 Token 到 .env 文件");
  Deno.exit(1);
}

if (!config.telegramOwnerId) {
  console.warn("\n⚠️ 警告：TELEGRAM_OWNER_ID 未设置！");
  console.warn("建议设置以启用主人识别功能");
  console.warn("获取方式：");
  console.warn("1. 在 Telegram 中搜索 @userinfobot");
  console.warn("2. 发送任意消息获取你的用户 ID");
  console.warn("3. 将 ID 设置到 .env 文件的 TELEGRAM_OWNER_ID");
}

// 2. 依赖检查
console.log("\n📦 2. 依赖检查...");
try {
  const { Telegraf } = await import("telegraf");
  console.log("   - Telegraf 库: ✅ 已安装");

  // 3. Bot 连接测试
  console.log("\n🤖 3. Bot 连接测试...");
  const bot = new Telegraf(config.telegramBotToken);

  try {
    const botInfo = await bot.telegram.getMe();
    console.log("   - Bot 连接: ✅ 成功");
    console.log(`   - Bot 用户名: @${botInfo.username}`);
    console.log(`   - Bot 显示名: ${botInfo.first_name}`);
    console.log(`   - Bot ID: ${botInfo.id}`);
  } catch (error) {
    console.error("   - Bot 连接: ❌ 失败");
    console.error(
      `   - 错误信息: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    Deno.exit(1);
  }

  // 4. 核心模块检查
  console.log("\n🔧 4. 核心模块检查...");
  try {
    const { handleIncomingMessage: _handleIncomingMessage } = await import(
      "./src/main.ts"
    );
    console.log("   - 核心处理函数: ✅ 可用");
  } catch (error) {
    console.error("   - 核心处理函数: ❌ 不可用");
    console.error(
      `   - 错误信息: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  try {
    const { analyzeMessageForMemory: _analyzeMessageForMemory } = await import(
      "./src/memory_processor.ts"
    );
    console.log("   - 消息分析函数: ✅ 可用");
  } catch (error) {
    console.error("   - 消息分析函数: ❌ 不可用");
    console.error(
      `   - 错误信息: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // 5. 配置完整性检查
  console.log("\n⚙️ 5. 配置完整性检查...");
  const requiredConfigs = [
    { name: "DeepSeek API Key", value: config.deepseekApiKey },
    { name: "SiliconFlow API Key", value: config.siliconflowApiKey },
    { name: "Qdrant URL", value: config.qdrantUrl },
  ];

  for (const configItem of requiredConfigs) {
    console.log(
      `   - ${configItem.name}: ${
        configItem.value ? "✅ 已设置" : "⚠️ 未设置"
      }`,
    );
  }

  // 6. 新增工具系统检查
  console.log("\n🔧 6. 新增工具系统检查...");
  try {
    const { configValidator } = await import("./src/utils/config-validator.ts");
    console.log("   - 配置验证器: ✅ 可用");

    const validationResult = configValidator.validate();
    console.log(
      `   - 配置验证结果: ${
        validationResult.isValid ? "✅ 通过" : "⚠️ 有问题"
      }`,
    );
    if (!validationResult.isValid) {
      console.log(`   - 错误数量: ${validationResult.errors.length}`);
      console.log(`   - 警告数量: ${validationResult.warnings.length}`);
    }
  } catch (error) {
    console.error("   - 配置验证器: ❌ 不可用");
    console.error(
      `   - 错误信息: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  try {
    const { Logger } = await import("./src/utils/logger.ts");
    console.log("   - 日志系统: ✅ 可用");

    const logger = Logger.getInstance();
    logger.info("TestModule", "测试日志系统");
    console.log("   - 日志记录: ✅ 正常");
  } catch (error) {
    console.error("   - 日志系统: ❌ 不可用");
    console.error(
      `   - 错误信息: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  try {
    const { PerformanceMonitor } = await import("./src/utils/performance.ts");
    console.log("   - 性能监控: ✅ 可用");

    const monitor = PerformanceMonitor.getInstance();
    monitor.startOperation("test_op", "测试操作");
    await new Promise((resolve) => setTimeout(resolve, 10));
    monitor.endOperation("test_op", "测试操作");
    console.log("   - 性能监控: ✅ 正常");
  } catch (error) {
    console.error("   - 性能监控: ❌ 不可用");
    console.error(
      `   - 错误信息: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  console.log("\n✅ 测试完成！");
  console.log("\n🚀 启动建议：");
  console.log(
    "   - 启动 Telegram Bot: deno run --allow-all src/main.ts --telegram",
  );
  console.log(
    "   - 同时启动 Discord 和 Telegram: deno run --allow-all src/main.ts --discord --telegram",
  );
  console.log("   - 测试消息: 在 Telegram 中向你的 Bot 发送消息");
} catch (error) {
  console.error("   - Telegraf 库: ❌ 未安装或导入失败");
  console.error(
    `   - 错误信息: ${error instanceof Error ? error.message : String(error)}`,
  );
  console.error("\n解决方案：");
  console.error("1. 检查 deno.json 中是否正确添加了 telegraf 依赖");
  console.error("2. 确保网络连接正常，可以下载 npm 包");
  Deno.exit(1);
}

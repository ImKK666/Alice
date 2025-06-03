// test_mindwander_debug.ts - 思维漫游调试测试脚本
/**
 * 专门用于测试思维漫游功能和调试日志的脚本
 * 运行命令: deno run --allow-all --unstable-kv test_mindwander_debug.ts
 */

import { handleIncomingMessage } from "./src/message_handler.ts";
import type { ChatMessageInput } from "./src/memory_processor.ts";
import { config } from "./src/config.ts";

console.log("🧪 思维漫游调试测试开始");
console.log("=".repeat(60));

// 临时提高思维漫游触发概率
const originalProbability = config.mindWandering.triggerProbability;
config.mindWandering.triggerProbability = 1.0; // 100% 触发概率用于测试

console.log(`📊 思维漫游配置:`);
console.log(`  启用状态: ${config.mindWandering.enabled}`);
console.log(`  原始触发概率: ${originalProbability}`);
console.log(`  测试触发概率: ${config.mindWandering.triggerProbability} (100%)`);
console.log(`  冷却时间: ${config.mindWandering.cooldownMinutes} 分钟`);

// 模拟消息输入
const testMessages: ChatMessageInput[] = [
  {
    text: "你好，我想测试思维漫游功能",
    userId: "test_user_001",
    contextId: "test_context_mindwander_001",
    timestamp: Date.now(),
  },
  {
    text: "请告诉我关于人工智能的思考",
    userId: "test_user_001", 
    contextId: "test_context_mindwander_001",
    timestamp: Date.now() + 1000,
  },
  {
    text: "我对创造力和想象力很感兴趣",
    userId: "test_user_001",
    contextId: "test_context_mindwander_001", 
    timestamp: Date.now() + 2000,
  }
];

async function testMindWandering() {
  console.log("\n🚀 开始测试思维漫游功能...");
  
  for (let i = 0; i < testMessages.length; i++) {
    const message = testMessages[i];
    console.log(`\n${"=".repeat(80)}`);
    console.log(`🧪 测试消息 ${i + 1}/${testMessages.length}`);
    console.log(`📝 内容: "${message.text}"`);
    console.log(`👤 用户: ${message.userId}`);
    console.log(`🔗 上下文: ${message.contextId}`);
    console.log(`⏰ 时间: ${new Date(message.timestamp).toLocaleTimeString()}`);
    console.log(`${"=".repeat(80)}`);
    
    try {
      console.log(`\n🔄 调用 handleIncomingMessage...`);
      const startTime = Date.now();
      
      const result = await handleIncomingMessage(
        message,
        message.contextId,
        "test"
      );
      
      const duration = Date.now() - startTime;
      
      console.log(`\n✅ 消息处理完成 (耗时: ${duration}ms)`);
      console.log(`📤 响应长度: ${result.responseText.length} 字符`);
      console.log(`🔗 新上下文ID: ${result.newContextId}`);
      console.log(`📝 响应预览: "${result.responseText.substring(0, 100)}${result.responseText.length > 100 ? "..." : ""}"`);
      
      // 等待一段时间，让异步的思维漫游完成
      console.log(`\n⏳ 等待 3 秒让异步思维漫游完成...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      
    } catch (error) {
      console.error(`❌ 处理消息时出错:`, error);
    }
    
    // 在消息之间添加间隔
    if (i < testMessages.length - 1) {
      console.log(`\n⏸️ 等待 2 秒后处理下一条消息...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

async function main() {
  try {
    // 等待系统初始化
    console.log(`\n⏳ 等待系统初始化完成...`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await testMindWandering();
    
    console.log(`\n🎉 思维漫游测试完成!`);
    console.log(`\n💡 如果您看到了详细的思维漫游调试日志，说明功能正常。`);
    console.log(`💡 如果没有看到，可能需要检查:`);
    console.log(`   1. 思维漫游模块是否正确启用`);
    console.log(`   2. 相关依赖是否正确初始化`);
    console.log(`   3. 错误日志中是否有异常信息`);
    
  } catch (error) {
    console.error(`❌ 测试过程中出现错误:`, error);
  } finally {
    // 恢复原始配置
    config.mindWandering.triggerProbability = originalProbability;
    console.log(`\n🔄 已恢复原始触发概率: ${originalProbability}`);
  }
}

// 运行测试
if (import.meta.main) {
  main();
}

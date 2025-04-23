// src/ltm_worker.ts
/**
 * LTM (Long-Term Memory) 处理后台 Worker
 *
 * 职责：
 * 1. 监听主线程发送过来的聊天消息。
 * 2. 调用 memory_processor 模块对消息进行分析、生成 Embedding。
 * 3. 将处理后的记忆点 (MemoryPointStruct) 存储到 Qdrant 向量数据库。
 * 4. 在后台异步执行，不阻塞主线程的响应。
 */

import {
  type ChatMessageInput,
  processAndStoreMessage,
} from "./memory_processor.ts"; // 导入 LTM 核心处理函数
import { config } from "./config.ts"; // Worker 也需要访问配置信息

// --- Worker 初始化日志 ---
console.log("[LTM Worker] ✅ Worker 进程已启动。");
console.log(
  `[LTM Worker]   - 使用 Qdrant 集合: ${config.qdrantCollectionName}`,
);
console.log(`[LTM Worker]   - 使用 LLM 模型进行分析: ${config.llmModel}`);
console.log(`[LTM Worker]   - 使用 Embedding 模型: ${config.embeddingModel}`);
console.log("[LTM Worker] ⏳ 等待主线程发送消息进行 LTM 处理...");

// --- 监听来自主线程的消息 ---
// 注: 在Deno Worker环境中正确设置类型
// @ts-ignore - 忽略在全局对象上未定义onmessage的类型检查
self.onmessage = async (event: MessageEvent<ChatMessageInput>) => {
  // 验证接收到的数据结构是否符合预期 (可选但推荐)
  if (
    !event.data || typeof event.data !== "object" || !event.data.userId ||
    !event.data.contextId || !event.data.text
  ) {
    console.error("[LTM Worker] ❌ 收到无效的消息格式:", event.data);
    // 可以选择通知主线程错误
    // self.postMessage({ status: 'error', error: '收到无效的消息格式' });
    return; // 忽略无效消息
  }

  const message = event.data; // 类型断言为 ChatMessageInput
  console.log(
    `[LTM Worker] 📩 收到消息，开始处理 LTM: 用户 ${message.userId} 在上下文 ${message.contextId}`,
  );
  console.log(
    `[LTM Worker]   消息内容预览: "${message.text.substring(0, 70)}..."`,
  );
  const startTime = performance.now(); // 记录处理开始时间

  try {
    // --- 调用核心 LTM 处理逻辑 ---
    // processAndStoreMessage 内部会处理 LLM 分析、Embedding 生成和 Qdrant 存储
    await processAndStoreMessage(message);

    const duration = ((performance.now() - startTime) / 1000).toFixed(2); // 计算处理耗时（秒）
    console.log(
      `[LTM Worker] ✅ LTM 处理成功: 用户 ${message.userId}, 上下文 ${message.contextId} (耗时 ${duration} 秒)`,
    );

    // 可选：向主线程发送成功状态报告
    // self.postMessage({
    //   status: 'success',
    //   contextId: message.contextId,
    //   userId: message.userId,
    //   // messageId: message.messageId // 如果有 messageId 的话
    //   duration: duration
    // });
  } catch (error) {
    const duration = ((performance.now() - startTime) / 1000).toFixed(2);
    console.error(
      `[LTM Worker] ❌ 处理 LTM 时出错 (用户 ${message.userId}, 上下文 ${message.contextId}, 耗时 ${duration} 秒):`,
      error,
    );
    // 打印更详细的错误信息（如果可用）
    if (error instanceof Error && error.cause) {
      console.error("[LTM Worker]   错误原因:", error.cause);
    }

    // 可选：向主线程发送详细错误报告
    // self.postMessage({
    //   status: 'error',
    //   contextId: message.contextId,
    //   userId: message.userId,
    //   // messageId: message.messageId,
    //   error: error instanceof Error ? error.message : String(error),
    //   stack: error instanceof Error ? error.stack : undefined,
    //   duration: duration
    // });
  }
};

// --- 监听 Worker 自身的未捕获错误 ---
self.onerror = (event: ErrorEvent) => {
  console.error(
    "[LTM Worker] 💥 未捕获的 Worker 错误:",
    event.message,
    event.filename,
    event.lineno,
  );
  // 阻止错误继续传播，否则可能导致 Worker 意外终止
  event.preventDefault();
  // 可以尝试通知主线程发生了严重错误
  // self.postMessage({ status: 'fatal', error: '未捕获的worker错误', message: event.message });
};

// --- 监听无法序列化/反序列化的消息错误 ---
// @ts-ignore - 忽略在全局对象上未定义onmessageerror的类型检查
self.onmessageerror = (event: MessageEvent) => {
  console.error("[LTM Worker] 📨 接收消息时发生序列化错误:", event);
};

// --- Worker 终止前的清理 (如果需要) ---
// self.onclose = () => {
//   console.log("[LTM Worker] Worker 正在关闭...");
//   // 在这里执行任何必要的清理操作，例如关闭数据库连接（如果 Worker 直接管理的话）
// };

// --- 保持 Worker 活跃 ---
// Worker 默认会在事件循环空闲时退出，但 onmessage 监听器会使其保持活跃。
// 如果有长时间运行的后台任务（非消息驱动），可能需要其他机制保持 Worker 运行。

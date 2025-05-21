// src/stm_manager.ts

import { kvHolder } from "./main.ts";
import type { ChatMessageInput } from "./memory_processor.ts";
import { KVStoreError, BaseError } from "../errors.ts"; // Import custom errors

export const STM_MAX_MESSAGES = 15; // 短期记忆最大消息数

/** 获取指定上下文的STM历史 */
export async function getStm(contextId: string): Promise<ChatMessageInput[]> {
  if (!kvHolder.instance) {
    console.warn("[STM][日志] KV 未初始化，无法获取 STM。");
    return [];
  }
  try {
    const key = ["stm", contextId];
    const result = await kvHolder.instance.get<ChatMessageInput[]>(key);
    console.log(
      `[STM][调试] 从 KV 读取 STM (上下文 ${contextId})，找到 ${
        result.value?.length ?? 0
      } 条记录。`,
    );
    return result.value ?? [];
  } catch (error) {
    console.error(
        `❌ [STMManager][错误] 读取 STM 出错 (上下文 ${contextId}):`,
        error instanceof BaseError ? error.toString() : error.message,
        error instanceof BaseError && error.details ? error.details : ""
        );
    throw new KVStoreError(
      `Failed to get STM for context ${contextId}: ${error.message}`,
      { originalError: error, operation: "get", key },
    );
    // Fallback return [] is removed. Caller should handle.
  }
}

/** 更新指定上下文的STM，使用原子操作处理并发 */
export async function updateStm(
  contextId: string,
  newMessage: ChatMessageInput,
): Promise<ChatMessageInput[]> {
  if (!kvHolder.instance) {
    console.warn("[STM][日志] KV 未初始化，无法更新 STM。");
    return [newMessage];
  }
  const key = ["stm", contextId];
  let finalStm: ChatMessageInput[] = [newMessage]; // 默认至少包含新消息
  console.log(
    `[STM][调试] 准备更新 STM (上下文 ${contextId})，新消息: ${
      newMessage.text.substring(0, 30)
    }...`,
  );

  try {
    let success = false;
    // 重试机制，处理可能的版本冲突
    for (let i = 0; i < 3 && !success; i++) {
      const getResult = await kvHolder.instance.get<ChatMessageInput[]>(key);
      const currentStm = getResult.value ?? [];
      const currentVersionstamp = getResult.versionstamp; // 用于原子性检查
      console.log(
        `[STM][调试] 原子更新尝试 ${
          i + 1
        }: 当前版本戳 ${currentVersionstamp}, 当前记录数 ${currentStm.length}`,
      );

      // 创建包含新消息但不超过限制的历史记录
      const combinedStm = [...currentStm, newMessage];
      const prunedStm = combinedStm.slice(-STM_MAX_MESSAGES); // 保留最新的 N 条
      finalStm = prunedStm; // 更新函数范围内的 finalStm，以便出错时返回
      console.log(
        `[STM][调试] 原子更新尝试 ${i + 1}: 更新后记录数 ${prunedStm.length}`,
      );

      const atomicOp = kvHolder.instance.atomic()
        .check({ key: key, versionstamp: currentVersionstamp }) // 检查版本
        .set(key, prunedStm); // 设置新值

      const commitResult = await atomicOp.commit();

      if (commitResult.ok) {
        success = true;
        console.log(`[STM][日志] ✅ STM 原子更新成功 (上下文 ${contextId})。`);
      } else {
        console.warn(
          `[STM][日志] ⚠️ STM 更新冲突 (上下文 ${contextId})，尝试次数 ${
            i + 1
          }。正在重试...`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, Math.random() * 50 + 20)
        );
      }
    }
    if (!success) {
      console.error(
        `❌ [STM][错误] STM 更新失败 (上下文 ${contextId})，已达最大尝试次数。返回内存中的状态。`,
      );
    }
    return finalStm;
  } catch (error) {
    console.error(
      `❌ [STMManager][错误] STM 原子更新出错 (上下文 ${contextId}):`,
      error instanceof BaseError ? error.toString() : error.message,
      error instanceof BaseError && error.details ? error.details : ""
    );
    throw new KVStoreError(
        `STM atomic update error for context ${contextId}: ${error.message}`,
        { originalError: error, operation: "atomic_commit_or_get", key }
    );
    // Fallback return finalStm is removed. Caller should handle.
  }
}

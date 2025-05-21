// src/stm_manager.ts

import { kvHolder } from "./main.ts";
import type { ChatMessageInput } from "./memory_processor.ts";
import { KVStoreError, BaseError } from "./errors.ts"; // Import custom errors
import { config } from "./config.ts"; // 1. Import config

export const STM_MAX_MESSAGES = 15; // 短期记忆最大消息数

// 2. Define PlatformAPI Interface
export interface PlatformAPI {
  fetchHistory: (
    contextId: string,
    limit: number,
  ) => Promise<ChatMessageInput[] | null>;
}

/** 获取指定上下文的STM历史 */
export async function getStm(
  contextId: string,
  platformApi?: PlatformAPI, // 3. Modify getStm signature
): Promise<ChatMessageInput[]> {
  // 3. Implement conditional logic for platform mode
  if (
    config.stmHistoryMode === "platform" &&
    platformApi &&
    typeof platformApi.fetchHistory === "function"
  ) {
    console.log(
      `[STM][日志] 尝试从平台 API 获取历史记录 (上下文 ${contextId})。`,
    );
    try {
      const platformHistory = await platformApi.fetchHistory(
        contextId,
        STM_MAX_MESSAGES,
      );
      if (platformHistory !== null) {
        console.log(
          `[STM][日志] ✅ 成功从平台 API 获取 ${platformHistory.length} 条历史记录 (上下文 ${contextId})。`,
        );
        return platformHistory;
      } else {
        console.warn(
          `[STM][警告] ⚠️ 平台 API 未能获取历史记录或不支持 (上下文 ${contextId})。返回空历史记录。`,
        );
        return []; // Crucially, do not fall back to KV
      }
    } catch (error) {
      console.error(
        `❌ [STMManager][错误] 从平台 API 获取历史记录时出错 (上下文 ${contextId}):`,
        error instanceof BaseError ? error.toString() : error.message,
        error instanceof BaseError && error.details ? error.details : "",
      );
      console.warn(
        `[STM][警告] ⚠️ 因平台 API 错误，返回空历史记录 (上下文 ${contextId})。`,
      );
      return []; // Do not fall back to KV
    }
  }

  // Else (mode is "kv" OR platformApi is not available/suitable)
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
      error instanceof BaseError && error.details ? error.details : "",
    );
    throw new KVStoreError(
      `Failed to get STM for context ${contextId}: ${error.message}`,
      { originalError: error, operation: "get", key: key }, // ensure key is passed in details
    );
  }
}

/** 更新指定上下文的STM，使用原子操作处理并发 */
export async function updateStm(
  contextId: string,
  newMessage: ChatMessageInput,
  currentTurnStm?: ChatMessageInput[], // 4. Modify updateStm signature
): Promise<ChatMessageInput[]> {
  // 4. Implement conditional logic for platform mode
  if (config.stmHistoryMode === "platform") {
    console.log(
      `[STM][日志] 平台历史模式：跳过 KV 更新 (上下文 ${contextId})。STM 将在内存中管理。`,
    );
    const combinedStm = [...(currentTurnStm ?? []), newMessage];
    const prunedStm = combinedStm.slice(-STM_MAX_MESSAGES);
    console.log(
      `[STM][调试] 平台模式下，内存中 STM 更新后包含 ${prunedStm.length} 条消息。`,
    );
    return prunedStm;
  }

  // Else (mode is "kv")
  if (!kvHolder.instance) {
    console.warn("[STM][日志] KV 未初始化，无法更新 STM。将仅返回新消息和传入的STM（如有）。");
    // If KV is not available, we can't persist.
    // We'll return a pruned version of what would have been saved,
    // based on currentTurnStm (if provided) or just the newMessage.
    const combinedStm = [...(currentTurnStm ?? []), newMessage];
    const prunedStm = combinedStm.slice(-STM_MAX_MESSAGES);
    return prunedStm;
  }

  const key = ["stm", contextId];
  let finalStm: ChatMessageInput[] = []; // Initialize to empty, will be set by successful KV op or fallback
  console.log(
    `[STM][调试] KV模式：准备更新 STM (上下文 ${contextId})，新消息: ${
      newMessage.text.substring(0, 30)
    }...`,
  );

  try {
    let success = false;
    for (let i = 0; i < 3 && !success; i++) {
      const getResult = await kvHolder.instance.get<ChatMessageInput[]>(key);
      const currentKvStm = getResult.value ?? []; // STM from KV
      const currentVersionstamp = getResult.versionstamp;
      console.log(
        `[STM][调试] KV原子更新尝试 ${
          i + 1
        }: 当前版本戳 ${currentVersionstamp}, KV中记录数 ${currentKvStm.length}`,
      );

      // Combine newMessage with the STM *from KV* for persistence
      const combinedForKv = [...currentKvStm, newMessage];
      const prunedForKv = combinedForKv.slice(-STM_MAX_MESSAGES);
      finalStm = prunedForKv; // This will be the state if commit succeeds or all retries fail

      console.log(
        `[STM][调试] KV原子更新尝试 ${
          i + 1
        }: 更新后将有 ${prunedForKv.length} 条记录。`,
      );

      const atomicOp = kvHolder.instance.atomic()
        .check({ key: key, versionstamp: currentVersionstamp })
        .set(key, prunedForKv);

      const commitResult = await atomicOp.commit();

      if (commitResult.ok) {
        success = true;
        console.log(`[STM][日志] ✅ STM KV 原子更新成功 (上下文 ${contextId})。`);
      } else {
        console.warn(
          `[STM][日志] ⚠️ STM KV 更新冲突 (上下文 ${contextId})，尝试次数 ${
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
        `❌ [STM][错误] STM KV 更新失败 (上下文 ${contextId})，已达最大尝试次数。返回基于KV最后一次读取状态的STM。`,
      );
      // finalStm is already set to the last attempted prunedForKv
    }
    return finalStm;
  } catch (error) {
    console.error(
      `❌ [STMManager][错误] STM KV 原子更新出错 (上下文 ${contextId}):`,
      error instanceof BaseError ? error.toString() : error.message,
      error instanceof BaseError && error.details ? error.details : "",
    );
    // In case of error, return a pruned list based on newMessage and currentTurnStm (if available)
    // This provides a best-effort STM if KV fails completely during update.
    const fallbackStm = [...(currentTurnStm ?? []), newMessage];
    finalStm = fallbackStm.slice(-STM_MAX_MESSAGES);
    console.warn(
        `[STM][警告] ⚠️ 因KV操作错误，返回基于传入消息和当前轮次STM（如有）的内存STM。`
    );
    throw new KVStoreError(
      `STM atomic update error for context ${contextId}: ${error.message}`,
      { originalError: error, operation: "atomic_commit_or_get", key: key }, // ensure key is passed
    );
  }
}

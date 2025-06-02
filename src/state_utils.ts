// src/state_utils.ts

import { kvHolder } from "./main.ts";
import type { ChatMessageInput } from "./memory_processor.ts"; // Although not directly used in function signatures, it's good for context if these functions were to expand.
import { BaseError, KVStoreError } from "./errors.ts"; // Import custom errors

/** 更新活跃用户上下文映射 */
export function updateActiveUserContexts(
  activeUserContextsMap: Map<string, string[]>,
  userId: string,
  contextId: string,
): void {
  const userContexts = activeUserContextsMap.get(userId) || [];
  if (!userContexts.includes(contextId)) {
    userContexts.push(contextId);
    if (userContexts.length > 10) { // Limit to last 10 contexts
      userContexts.shift();
    }
  } else {
    // Move to the end to mark as most recent
    userContexts.splice(userContexts.indexOf(contextId), 1);
    userContexts.push(contextId);
  }
  activeUserContextsMap.set(userId, userContexts);
  console.log(
    `[StateUtils][调试] 更新活跃用户上下文: User ${userId} -> Contexts [${
      userContexts.join(", ")
    }]`,
  );
}

/** 获取上次思维漫游时间 */
export async function getLastWanderingTime(
  userId: string,
  contextId: string, // 这里应该是 RAG Context ID
): Promise<number> {
  if (!kvHolder.instance) {
    console.warn("[StateUtils][KV] KV 未初始化，无法获取上次漫游时间。");
    return 0;
  }
  const key = ["last_wandering_time", userId, contextId];
  try {
    const result = await kvHolder.instance.get<number>(key);
    return result.value || 0;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `❌ [StateUtils][KV] 获取用户 ${userId} 在上下文 ${contextId} 的上次漫游时间失败:`,
      error instanceof BaseError ? error.toString() : errorMessage,
      error instanceof BaseError && error.details ? error.details : "",
    );
    throw new KVStoreError(
      `Failed to get last wandering time for user ${userId}, context ${contextId}: ${errorMessage}`,
      { originalError: error, operation: "get", key },
    );
  }
}

/** 设置上次思维漫游时间 */
export async function setLastWanderingTime(
  userId: string,
  contextId: string, // 这里应该是 RAG Context ID
  timestamp: number,
): Promise<void> {
  if (!kvHolder.instance) {
    console.warn("[StateUtils][KV] KV 未初始化，无法设置上次漫游时间。");
    return;
  }
  const key = ["last_wandering_time", userId, contextId];
  try {
    await kvHolder.instance.set(key, timestamp);
    console.log(
      `[StateUtils][KV][日志] 设置用户 ${userId} 在上下文 ${contextId} 的上次漫游时间为 ${
        new Date(timestamp).toLocaleTimeString()
      }`,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `❌ [StateUtils][KV] 设置用户 ${userId} 在上下文 ${contextId} 的上次漫游时间失败:`,
      error instanceof BaseError ? error.toString() : errorMessage,
      error instanceof BaseError && error.details ? error.details : "",
    );
    throw new KVStoreError(
      `Failed to set last wandering time for user ${userId}, context ${contextId}: ${errorMessage}`,
      { originalError: error, operation: "set", key },
    );
  }
}

// src/initialization.ts
import type { Worker as LtmWorkerType } from "./main.ts"; // Import type for ltmWorker
import { kvHolder, ltmWorkerHolder } from "./main.ts"; // Import holders for assignment
import { KVStoreError, BaseError } from "../errors.ts"; // Import custom errors

// --- 初始化 STM (Deno KV) ---
export async function initializeKv() {
  try {
    const kvPath = "./data/alice.sqlite";
    console.log(
      `[初始化][日志] 尝试在路径 "${kvPath}" 打开或创建 Deno KV 数据库...`,
    );
    // Assign to the 'instance' property of the imported holder
    kvHolder.instance = await Deno.openKv(kvPath);
    console.log(
      `✅ STM & State Storage (Deno KV) 初始化成功。数据存储于: ${kvPath}`,
    );
  } catch (error) {
    console.error(
        `❌ [Initialization] STM & State Storage (Deno KV) 初始化失败:`,
        error instanceof BaseError ? error.toString() : error.message,
        error instanceof BaseError && error.details ? error.details : ""
        );
    kvHolder.instance = null; // Ensure it's null on failure
    throw new KVStoreError(
      `Failed to open Deno KV store at path: ${kvPath}. ${error.message}`,
      { originalError: error, operation: "openKv", key: [kvPath] },
    );
  }
}

// --- 初始化 LTM Worker ---
export function initializeLtmWorker() {
  try {
    // Assign to the 'instance' property of the imported holder
    ltmWorkerHolder.instance = new Worker(new URL("./ltm_worker.ts", import.meta.url).href, {
      type: "module",
    }) as LtmWorkerType; // Cast to the imported type
    console.log("✅ LTM Worker 初始化成功。");

    if (ltmWorkerHolder.instance) {
      ltmWorkerHolder.instance.onerror = (e: any) => {
        console.error(`❌ LTM Worker 遇到错误: ${e.message}`);
        e.preventDefault();
      };
      ltmWorkerHolder.instance.onmessage = (e: any) => {
        if (e.data?.status === "success") {
          console.log(
            `[LTM Worker][日志] ✅ 消息 LTM 存储成功 (用户: ${e.data.userId}, RAG 上下文: ${e.data.contextId}, 原始来源: ${e.data.originalSourceContextId}, 耗时: ${e.data.duration}s)`,
          );
        } else if (e.data?.status === "error") {
          console.error(
            `[LTM Worker][日志] ❌ 消息 LTM 存储失败 (用户: ${e.data.userId}, RAG 上下文: ${e.data.contextId}, 原始来源: ${e.data.originalSourceContextId}): ${e.data.error}`,
          );
        } else {
          console.log(`[LTM Worker][日志] 收到消息: ${JSON.stringify(e.data)}`);
        }
      };
      ltmWorkerHolder.instance.onmessageerror = (e: any) => {
        console.error("[LTM Worker][日志] 接收消息出错:", e);
      };
    }
  } catch (error) {
    console.error("❌ LTM Worker 初始化失败:", error);
    console.warn("⚠️ LTM 后台处理将被禁用。");
    ltmWorkerHolder.instance = null; // Ensure it's null on failure
  }
}

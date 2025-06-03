// src/main.ts (融合 social_cognition, self_concept, memory_network 的增强版)

// --- 核心依赖导入 ---
import { parseArgs } from "https://deno.land/std@0.224.0/cli/parse_args.ts";
import { config } from "./config.ts";
import { type ChatMessageInput } from "./memory_processor.ts";
import { ensureCollectionExists } from "./qdrant_client.ts";

// --- 新增工具导入 ---
import { configValidator } from "./utils/config-validator.ts";
import { createModuleLogger } from "./utils/logger.ts";
import { PerformanceMonitor } from "./utils/performance.ts";

// --- 接口模块导入 ---
import { startCli } from "./cli_interface.ts";
import { startDiscord } from "./discord_interface.ts";
import { startTelegram } from "./telegram_interface.ts";

// --- 进化模块导入 (保留，部分功能可能仍被直接调用) ---
import {
  type Insight,
  retrieveRelevantInsights,
  schedulePeriodicMindWandering,
  triggerMindWandering,
  type WanderingContext,
} from "./mind_wandering.ts";
import {
  addTimeMarker,
  analyzeConversationPace,
  findRelevantTimeMarkers,
  recordInteractionTimestamp,
  type TimeMarker,
} from "./time_perception.ts";
import {
  generateBodyStateExpression,
  generateEmbodiedExpressions,
  processMessageAndUpdateState,
  type VirtualPhysicalState,
} from "./virtual_embodiment.ts";
import { loadStopwordsFromFile } from "./utils.ts";

// --- 新增/修改的导入 ---
import { // 导入新的社交认知模块
  type EnhancedRelationshipState, // 使用增强的关系状态接口
  getSocialCognitionManager, // 获取社交认知管理器实例
} from "./social_cognition.ts";
import { // 导入自我概念模块
  selfConcept, // 导入整个模块接口
  type SelfModel, // 自我模型接口
} from "./self_concept.ts";
import { CognitiveIntegrationManager } from "./cognitive_integration.ts"; // 引入认知整合模块

// --- STM 相关 ---
// STM_MAX_MESSAGES has been moved to src/stm_manager.ts
// kv 和 ltmWorker 改为 holder 对象，以便 initialization.ts 可以修改其实例
export const kvHolder = { instance: null as Deno.Kv | null };
export type Worker = globalThis.Worker; // Define Worker type for LtmWorkerType
export const ltmWorkerHolder = { instance: null as Worker | null };

// --- 状态管理 ---
const activeUserContexts = new Map<string, string[]>();

// --- 用于存储已加载停用词的全局变量 ---
let loadedStopwordsSet: Set<string> = new Set();

// --- 类型定义 ---
interface BodyExpressions {
  metaphorical: string;
  sensory: string;
  posture: string;
  energy: string;
}

// --- 模块实例 ---
const socialCognition = getSocialCognitionManager(); // 获取社交认知管理器实例
const selfConceptManager = new selfConcept.SelfConceptManager(); // 创建自我概念管理器实例
let cognitiveIntegrationManager: CognitiveIntegrationManager | null = null; // 认知整合管理器实例

// --- 从 initialization.ts 导入初始化函数 ---
import { initializeKv, initializeLtmWorker } from "./initialization.ts";
import { getStm, updateStm } from "./stm_manager.ts"; // Import STM functions
import {
  getLastWanderingTime,
  setLastWanderingTime,
  updateActiveUserContexts,
} from "./state_utils.ts"; // Import state utility functions

// --- 导出供其他模块使用的函数和变量 ---
export { getLastWanderingTime, getStm, setLastWanderingTime };

// 为了兼容性，导出 kv 别名
export const kv = kvHolder;

// --- 辅助函数 ---

/** 提取最近话题 (保持不变) */
export function extractRecentTopics(history: ChatMessageInput[]): string[] {
  // This function remains in main.ts as it uses loadedStopwordsSet
  if (history.length === 0) return [];
  const recentMessages = history.slice(-5); // 取最近5条
  const topics = new Set<string>();

  for (const msg of recentMessages) {
    const words = msg.text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, "") // 移除非字母、数字、空格
      .split(/\s+/)
      .filter((word) => word.length > 1 && !loadedStopwordsSet.has(word)); // <-- 使用加载的集合
    words.forEach((word) => topics.add(word));
  }
  const extractedTopics = Array.from(topics).slice(0, 10);
  // console.log(`[辅助][调试] 提取到最近话题: [${extractedTopics.join(', ')}]`);
  return extractedTopics;
}

// Cognitive utility functions (analyzeMessageSentiment, getDominantEmotion, formatEmotionState, getEmotionKeywords, detectImportantMessage)
// have been moved to src/cognitive_utils.ts
import {
  analyzeMessageSentiment,
  detectImportantMessage,
} from "./cognitive_utils.ts";

// --- 核心 RAG 逻辑 ---

// determineCurrentContext has been moved to src/context_detector.ts
import { determineCurrentContext } from "./context_detector.ts";

// LTM related functions (decideLtmStrategy, retrieveLtmBasedOnStrategy, etc.)
// and types (LtmStrategy, LtmContextItem) have been moved to src/ltm_processor.ts
import {
  decideLtmStrategy,
  retrieveLtmBasedOnStrategy,
} from "./ltm_processor.ts";
import { BaseError } from "./errors.ts"; // Import custom errors

// generateResponseWithMemory has been moved to src/prompt_builder.ts
import { generateResponseWithMemory } from "./prompt_builder.ts";

// --------------------------------------------------------------------------
// --- 核心处理函数已移动到 message_handler.ts ---
// --------------------------------------------------------------------------

// --- 主函数：程序入口 (添加自我概念初始化) ---
async function main() {
  const mainLogger = createModuleLogger("Main");
  const performanceMonitor = PerformanceMonitor.getInstance();

  try {
    console.log("==============================================");
    console.log("  AI 人格核心 - 爱丽丝 v9.1 (优化增强版)"); // 版本更新
    console.log("==============================================");

    mainLogger.info("系统初始化开始");
    performanceMonitor.startOperation(
      "system_init",
      "系统初始化",
      "主程序启动",
    );

    // 配置验证
    mainLogger.info("开始配置验证");
    try {
      configValidator.validateAndThrow();
      mainLogger.info("配置验证通过");
    } catch (error) {
      mainLogger.critical(
        "配置验证失败",
        error instanceof Error ? error : undefined,
      );
      throw error;
    }

    const args = parseArgs(Deno.args);
    const runDiscord = args.discord === true;
    const runTelegram = args.telegram === true;

    loadedStopwordsSet = await loadStopwordsFromFile(
      "./data/stopwords-zh.json",
    );

    console.log("[初始化][日志] 1. 调用 KV 和 LTM Worker 初始化函数...");
    await initializeKv(); // 调用导入的函数 - Can throw KVStoreError
    initializeLtmWorker(); // 调用导入的函数

    await Promise.all([
      // initializeLtmWorker(), // 已在上面同步调用 (initializeLtmWorker is synchronous)
      (async () => {
        try {
          await ensureCollectionExists(
            config.qdrantCollectionName,
            config.embeddingDimension,
            "Cosine",
          );
          console.log(
            `✅ Qdrant 初始化检查完成 (集合: ${config.qdrantCollectionName})。`,
          );
        } catch (error) {
          console.error("❌ Qdrant 初始化失败:", error);
          console.error("   请确保 Qdrant 服务正在运行且地址配置正确。");
          Deno.exit(1);
        }
      })(),
      (async () => {
        if (config.mindWandering?.enabled) {
          try {
            await schedulePeriodicMindWandering(activeUserContexts);
          } catch (error) {
            console.error("⚠️ 思维漫游系统初始化失败:", error);
          }
        } else {
          console.log("ℹ️ 思维漫游系统已禁用或配置缺失。");
        }
      })(),
      // --- 新增：初始化社交认知和自我概念管理器 ---
      socialCognition.initialize().catch((err) =>
        console.error("❌ 社交认知模块初始化失败:", err)
      ),
      selfConceptManager.initialize().catch((err) =>
        console.error("❌ 自我概念模块初始化失败:", err)
      ),
      (async () => {
        if (config.cognitiveIntegration.enabled) {
          try {
            console.log("[初始化][日志] 2b. 初始化认知整合模块...");
            cognitiveIntegrationManager = new CognitiveIntegrationManager();
            await cognitiveIntegrationManager.initialize();
            console.log("✅ 认知整合模块初始化成功。");
          } catch (err) {
            console.error("❌ 认知整合模块初始化失败:", err);
            // 可以选择不在这里退出，让核心流程继续运行
          }
        } else {
          console.log("ℹ️ 认知整合模块已禁用或配置缺失。");
        }
      })(),
    ]);

    console.log("----------------------------------------------");
    let modeDescription = "CLI";
    if (runDiscord && runTelegram) {
      modeDescription = "Discord Bot + Telegram Bot";
    } else if (runDiscord) {
      modeDescription = "Discord Bot";
    } else if (runTelegram) {
      modeDescription = "Telegram Bot";
    }
    console.log(`🚀 准备启动模式: ${modeDescription}`);
    console.log("----------------------------------------------");

    if (runDiscord && runTelegram) {
      // 同时启动 Discord 和 Telegram
      await Promise.all([startDiscord(), startTelegram()]);
      console.log(
        "⏳ Discord Bot 和 Telegram Bot 正在运行，主程序将保持活动状态。按 Ctrl+C 退出。",
      );
      await new Promise<void>(() => {});
    } else if (runDiscord) {
      await startDiscord();
      console.log(
        "⏳ Discord Bot 正在运行，主程序将保持活动状态。按 Ctrl+C 退出。",
      );
      await new Promise<void>(() => {});
    } else if (runTelegram) {
      await startTelegram();
      console.log(
        "⏳ Telegram Bot 正在运行，主程序将保持活动状态。按 Ctrl+C 退出。",
      );
      await new Promise<void>(() => {});
    } else {
      await startCli();
    }

    performanceMonitor.endOperation("system_init", "系统初始化", "主程序启动");
    mainLogger.info("系统初始化完成");
    console.log("\n▶️ 主函数执行完毕 (CLI 模式) 或等待信号 (Bot 模式)...");
  } catch (error) {
    performanceMonitor.endOperation("system_init", "系统初始化", "主程序启动");
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    mainLogger.critical(
      "主函数执行失败",
      error instanceof Error ? error : undefined,
    );
    console.error(
      `❌ [Main][FATAL] 主函数执行时发生错误:`,
      error instanceof BaseError ? error.toString() : errorMessage,
      error instanceof BaseError && error.details ? error.details : "",
      errorStack,
    );
    Deno.exit(1);
  }
}

// --- 脚本入口点与清理 (保持不变) ---
if (import.meta.main) {
  const cleanup = () => {
    console.log("\n⏹️ 开始清理资源...");
    if (ltmWorkerHolder.instance) {
      try {
        ltmWorkerHolder.instance.terminate();
      } catch (_) { /* 忽略错误 */ }
      console.log("✅ LTM Worker 已终止。");
    }
    if (kvHolder.instance) {
      try {
        kvHolder.instance.close();
      } catch (_) { /* 忽略错误 */ }
      console.log("✅ Deno KV 连接已关闭。");
    }
    console.log("⏹️ 清理完成。");
  };

  main().catch((error) => { // Catch errors from async main execution
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error(
      `❌ [Main][FATAL] 主程序出现未捕获错误:`,
      error instanceof BaseError ? error.toString() : errorMessage,
      error instanceof BaseError && error.details ? error.details : "",
      errorStack,
    );
    cleanup();
    Deno.exit(1);
  });

  globalThis.addEventListener("unload", () => {
    console.log("⏹️ 检测到程序退出信号 ('unload' 事件)...");
    cleanup();
    console.log("⏹️ 'unload' 事件处理尝试完成。");
  });

  globalThis.addEventListener("unhandledrejection", (event) => {
    console.error("❌ 未处理的 Promise 拒绝:", event.reason);
    event.preventDefault();
  });

  try {
    Deno.addSignalListener("SIGINT", () => {
      console.log("\n⏹️ 收到 SIGINT (Ctrl+C)，正在优雅退出...");
      cleanup();
      Deno.exit(0);
    });
    console.log("ℹ️ 已添加 SIGINT (Ctrl+C) 信号监听器。");

    if (Deno.build.os !== "windows") {
      try {
        Deno.addSignalListener("SIGTERM", () => {
          console.log("\n⏹️ 收到 SIGTERM，正在优雅退出...");
          cleanup();
          Deno.exit(0);
        });
        console.log("ℹ️ 已添加 SIGTERM 信号监听器 (非 Windows)。");
      } catch (termError) {
        console.warn("⚠️ 无法添加 SIGTERM 信号监听器:", termError);
      }
    } else {
      console.log("ℹ️ 在 Windows 上跳过添加 SIGTERM 信号监听器。");
    }
  } catch (e) {
    console.warn(
      "⚠️ 无法添加 SIGINT 信号监听器 (可能权限不足或环境不支持):",
      e,
    );
  }
}

// src/main.ts (融合 social_cognition, self_concept, memory_network 的增强版)

// --- 核心依赖导入 ---
import { parseArgs } from "https://deno.land/std@0.224.0/cli/parse_args.ts";
import { config } from "./config.ts";
import { type ChatMessageInput } from "./memory_processor.ts";
import { ensureCollectionExists } from "./qdrant_client.ts";

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
// --- 核心处理函数：handleIncomingMessage (增强版) ---
// --------------------------------------------------------------------------
/**
 * 处理传入消息的核心函数 (包含所有增强逻辑)
 * @param message 传入的聊天消息
 * @param initialContextId 处理开始时的 RAG 上下文 ID
 * @param platform 来源平台 ('cli', 'discord' 等)
 * @returns 返回响应文本和最终的 RAG 上下文 ID
 */
export async function handleIncomingMessage(
  message: ChatMessageInput,
  initialContextId: string,
  platform: string,
): Promise<{ responseText: string; newContextId: string }> {
  const startTime = Date.now();
  const userId = message.userId;
  const sourceContextId = message.contextId; // 原始来源
  let currentRagContextId = initialContextId; // Keep track of context for error reporting

  try {
    // --- 认知整合模块优先处理 ---
    if (
      config.cognitiveIntegration.enabled &&
      cognitiveIntegrationManager &&
      cognitiveIntegrationManager.isInitialized()
    ) {
      try {
        console.log(
          `\n🌌 [CognitiveIntegration][日志] 使用认知整合模块处理消息 (用户: ${userId}, 来源: ${sourceContextId}, RAG上下文: ${currentRagContextId})`,
        );
        const cimResponseText = await cognitiveIntegrationManager
          .processMessage(
            message.text,
            userId,
            currentRagContextId, // 使用当前的 RAG 上下文 ID
          );

        if (
          cimResponseText && typeof cimResponseText === "string" &&
          cimResponseText.trim() !== ""
        ) {
          console.log(
            "✅ [CognitiveIntegration][日志] 认知整合模块成功生成响应。",
          );
          const endTime = Date.now();
          console.log(
            `✅ [Core][日志] 消息处理完成 (认知整合路径，总耗时: ${
              (endTime - startTime) / 1000
            } 秒)`,
          );
          return {
            responseText: cimResponseText,
            newContextId: currentRagContextId,
          };
        } else {
          console.warn(
            "⚠️ [CognitiveIntegration][日志] 认知整合模块未生成有效响应，将回退到核心逻辑。",
          );
        }
      } catch (cimError) {
        console.error(
          "❌ [CognitiveIntegration][错误] 认知整合模块处理消息时发生错误，将回退到核心逻辑:",
          cimError,
        );
      }
    }
    // 如果认知整合模块未启用、未成功处理或发生错误，则继续执行核心逻辑
    console.log(
      `\n🚀 [Core][日志] 开始/继续核心消息处理 (用户: ${userId}, 来源: ${sourceContextId}, 初始RAG上下文: ${initialContextId})`,
    );

    updateActiveUserContexts(activeUserContexts, userId, sourceContextId); // Pass activeUserContexts map

    console.log(`   [Core][日志] 1. 获取 STM...`);
    const stmHistory = await getStm(sourceContextId); // Might throw KVStoreError
    console.log(
      `   [Core][调试]    - STM 记录数: ${stmHistory.length} (来源: ${sourceContextId})`,
    );

    console.log(`   [Core][日志] 2. 判断/更新 RAG 上下文...`);
    currentRagContextId = await determineCurrentContext( // Update currentRagContextId
      userId,
      initialContextId, // Pass initialContextId here, not currentRagContextId yet
      stmHistory,
      message,
      sourceContextId,
    );
    const messageForRag = { ...message, contextId: currentRagContextId };
    console.log(`   [Core][日志]    - 当前 RAG 上下文: ${currentRagContextId}`);

    console.log(`   [Core][日志] 3. 更新 STM (来源: ${sourceContextId})...`);
    const updatedStm = await updateStm(sourceContextId, message); // Use original source ID for STM

    if (ltmWorkerHolder.instance && config.qdrantCollectionName) {
      console.log(`   [Core][日志] 4. 异步提交 LTM 存储...`);
      ltmWorkerHolder.instance.postMessage({
        ...message,
        contextId: currentRagContextId,
        originalSourceContextId: sourceContextId,
      });
    } else {
      console.warn(
        `   [Core][日志] 4. ⚠️ LTM Worker 未初始化或 Qdrant 未配置，跳过异步 LTM 存储。`,
      );
    }

    console.log(`   [Core][日志] 5. 分析消息情感...`);
    const messageSentiment = await analyzeMessageSentiment(message.text);
    console.log(
      `   [Core][调试]    - 情感分析结果: 效价=${
        messageSentiment.valence.toFixed(2)
      }, 强度=${
        messageSentiment.arousal.toFixed(2)
      }, 主导=${messageSentiment.dominant_emotion}`,
    );

    console.log(`   [Core][日志] 6. 并行更新认知状态 (身体、关系、时间)...`);
    let updatedBodyState: VirtualPhysicalState | null = null;
    // --- 修改：使用新的关系状态类型 ---
    let updatedRelationshipState: EnhancedRelationshipState | null = null;
    let conversationPace = 1.0;
    const stateUpdatePromises = [];

    if (config.virtualEmbodiment.enabled) {
      stateUpdatePromises.push(
        processMessageAndUpdateState(
          userId,
          currentRagContextId,
          { text: message.text, emotional_state: messageSentiment },
          false,
          kvHolder.instance!,
          loadedStopwordsSet, // 传递停用词集合
        )
          .then((state) => {
            updatedBodyState = state;
            console.log(
              `   [Core][调试]    - ✅ 身体状态更新完成 (能量: ${
                state?.energy_level.toFixed(2) ?? "N/A"
              })`,
            );
          })
          .catch((err) =>
            console.error("   [Core][错误]    - ❌ 更新身体状态失败:", err)
          ),
      );
    }
    // --- 修改：使用 socialCognition 实例更新关系 ---
    if (config.socialDynamics.enabled) { // 仍用 socialDynamics 的配置项控制是否启用
      stateUpdatePromises.push(
        socialCognition.analyzeInteractionAndUpdateRelationship( // 调用 social_cognition 的方法
          userId, // entityId 是对方用户ID
          { text: message.text, timestamp: message.timestamp || Date.now() },
          messageSentiment,
          currentRagContextId, // 传入 RAG Context ID
          // kv // socialCognition 内部会访问 kv
        )
          .then((state) => {
            updatedRelationshipState = state;
            console.log(
              `   [Core][调试]    - ✅ 关系状态更新完成 (风格: ${
                state?.current_interaction_style ?? "N/A"
              }, 阶段: ${state?.stage ?? "N/A"})`,
            );
          })
          .catch((err) =>
            console.error("   [Core][错误]    - ❌ 更新关系状态失败:", err)
          ),
      );
    }
    if (config.timePerception.enabled) {
      stateUpdatePromises.push(
        (async () => {
          try {
            await recordInteractionTimestamp(
              userId,
              currentRagContextId,
              kvHolder.instance!,
            );
            conversationPace = await analyzeConversationPace(
              userId,
              currentRagContextId,
              message.text,
              kvHolder.instance!,
            );
            console.log(
              `   [Core][调试]    - ✅ 时间状态更新完成 (记录交互, 感知速度: ${
                conversationPace.toFixed(2)
              })`,
            );
          } catch (err) {
            console.error("   [Core][错误]    - ❌ 更新时间状态失败:", err);
          }
        })(),
      );
    }
    // --- 新增：获取自我模型 ---
    let currentSelfModel: SelfModel | null = null;
    stateUpdatePromises.push(
      selfConceptManager.getSelfModel()
        .then((model) => {
          currentSelfModel = model;
          console.log(
            `   [Core][调试]    - ✅ 获取自我模型成功 (v${model?.version})`,
          );
        })
        .catch((err) =>
          console.error("   [Core][错误]    - ❌ 获取自我模型失败:", err)
        ),
    );

    await Promise.all(stateUpdatePromises);
    console.log(`   [Core][日志]    - 认知状态更新完成。`);

    console.log(`   [Core][日志] 7. 决定 LTM 策略...`);
    const ltmStrategy = await decideLtmStrategy(currentRagContextId);

    console.log(`   [Core][日志] 8. 检索 LTM (含记忆网络增强)...`);
    const retrievedLtm = await retrieveLtmBasedOnStrategy(
      ltmStrategy,
      messageForRag,
      messageSentiment,
    );

    // --- 并行获取洞见、时间标记、身体表达 (保持不变) ---
    const insightPromise = config.mindWandering.enabled
      ? retrieveRelevantInsights(messageForRag, 2).catch((err) => {
        console.error("   [Core][错误]    - ❌ 异步检索洞见失败:", err);
        return [];
      })
      : Promise.resolve([]);

    const timeMarkerPromise = config.timePerception.enabled
      ? findRelevantTimeMarkers(
        userId,
        currentRagContextId,
        message.text,
        kvHolder.instance!,
      ).catch(
        (err) => {
          console.error("   [Core][错误]    - ❌ 异步检索时间标记失败:", err);
          return [];
        },
      )
      : Promise.resolve([]);

    const bodyExpressionPromise =
      (config.virtualEmbodiment.enabled && updatedBodyState)
        ? generateEmbodiedExpressions(updatedBodyState).catch((err) => {
          console.error("   [Core][错误]    - ❌ 异步生成身体表达失败:", err);
          return {
            metaphorical: "",
            sensory: "",
            posture: "",
            energy: generateBodyStateExpression(updatedBodyState!),
          };
        })
        : Promise.resolve({
          metaphorical: "",
          sensory: "",
          posture: "",
          energy: "",
        });

    // --- 异步触发时间标记和思维漫游 (保持不变) ---
    if (config.timePerception.enabled) {
      console.log(`   [Core][日志] 10. 异步检测重要消息...`);
      detectImportantMessage(message.text)
        .then((importantInfo) => {
          if (importantInfo) {
            console.log(
              `   [Core][调试]    - ℹ️ 检测到重要消息，正在添加时间标记: "${importantInfo.description}"`,
            );
            return addTimeMarker(
              userId,
              currentRagContextId,
              importantInfo.description,
              importantInfo.significance,
              importantInfo.isMilestone,
              kvHolder.instance!,
            );
          }
        })
        .catch((err) =>
          console.error("   [Core][错误]    - ❌ 检测重要消息失败:", err)
        );
    }
    if (
      config.mindWandering.enabled &&
      Math.random() < (config.mindWandering.triggerProbability || 0.15)
    ) {
      console.log(`   [Core][日志] 13. 概率触发思维漫游 (异步)...`);
      (async () => {
        const lastWander = await getLastWanderingTime(
          userId,
          currentRagContextId,
        );
        const cooldownMs = (config.mindWandering.cooldownMinutes || 5) * 60 *
          1000;
        if (Date.now() - lastWander > cooldownMs) {
          const wanderingContext: WanderingContext = {
            user_id: userId,
            context_id: currentRagContextId,
            recent_topics: extractRecentTopics(updatedStm),
            emotional_state: {
              valence: messageSentiment.valence,
              arousal: messageSentiment.arousal,
            },
            last_wandering_time: lastWander,
          };
          try {
            const result = await triggerMindWandering(wanderingContext);
            if (result.insights.length > 0) {
              console.log(
                `   [Core][调试]    - ✨ 后台思维漫游完成，生成 ${result.insights.length} 条洞见。`,
              );
              await setLastWanderingTime(
                userId,
                currentRagContextId,
                Date.now(),
              );
            } else {
              console.log(
                `   [Core][调试]    - 后台思维漫游未生成洞见或被跳过。`,
              );
            }
          } catch (err) {
            console.error("   [Core][错误]    - ❌ 后台思维漫游执行失败:", err);
            await setLastWanderingTime(userId, currentRagContextId, Date.now());
          }
        } else {
          console.log(
            `   [Core][调试]    - 思维漫游冷却中 (${
              ((cooldownMs - (Date.now() - lastWander)) / 60000).toFixed(1)
            }分钟剩余)，跳过触发。`,
          );
        }
      })();
    } else {
      console.log(
        `   [Core][日志] 13. 跳过思维漫游触发 (概率、禁用或配置缺失)。`,
      );
    }

    // --- 等待关键异步任务并生成响应 ---
    console.log(
      `   [Core][日志] 12. 等待关键异步任务 (洞见/标记/身体表达) 并生成最终响应...`,
    );
    const asyncTimeout = 3000;
    let relevantInsights: Insight[] = [];
    let relevantTimeMarkers: TimeMarker[] = [];
    let bodyExpressionsResult: BodyExpressions = {
      metaphorical: "",
      sensory: "",
      posture: "",
      energy: "",
    };

    try {
      const results = await Promise.all([
        Promise.race([
          insightPromise,
          new Promise((resolve) => setTimeout(() => resolve([]), asyncTimeout)),
        ]),
        Promise.race([
          timeMarkerPromise,
          new Promise((resolve) => setTimeout(() => resolve([]), asyncTimeout)),
        ]),
        Promise.race([
          bodyExpressionPromise,
          new Promise((resolve) =>
            setTimeout(() => resolve(bodyExpressionsResult), asyncTimeout)
          ),
        ]),
      ]);
      relevantInsights = results[0] as Insight[];
      relevantTimeMarkers = results[1] as TimeMarker[];
      const tempBodyExpr = results[2] as BodyExpressions;
      bodyExpressionsResult =
        (tempBodyExpr && typeof tempBodyExpr === "object" &&
            "energy" in tempBodyExpr)
          ? tempBodyExpr
          : {
            metaphorical: "",
            sensory: "",
            posture: "",
            energy: updatedBodyState
              ? generateBodyStateExpression(updatedBodyState)
              : "",
          };

      console.log(
        `   [Core][调试]     - 关键异步任务获取完成 (洞见: ${relevantInsights.length}, 标记: ${relevantTimeMarkers.length}, 身体表达: ${!!bodyExpressionsResult
          .energy})`,
      );
    } catch (waitError) {
      console.error(
        `   [Core][错误]     - ❌ 等待关键异步任务时出错:`,
        waitError,
      );
      relevantInsights = [];
      relevantTimeMarkers = [];
      bodyExpressionsResult = {
        metaphorical: "",
        sensory: "",
        posture: "",
        energy: updatedBodyState
          ? generateBodyStateExpression(updatedBodyState)
          : "",
      };
    }

    // --- 生成响应 (传入增强的状态信息) ---
    const finalResponse = await generateResponseWithMemory(
      messageForRag,
      updatedStm,
      retrievedLtm,
      ltmStrategy,
      platform,
      relevantInsights,
      relevantTimeMarkers,
      updatedBodyState,
      bodyExpressionsResult,
      updatedRelationshipState, // 传入更新后的关系状态
      currentSelfModel, // 传入获取到的自我模型
    );

    const endTime = Date.now();
    console.log(
      `✅ [Core][日志] 消息处理完成 (总耗时: ${
        (endTime - startTime) / 1000
      } 秒)`,
    );

    return { responseText: finalResponse, newContextId: currentRagContextId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error(
      `❌ [Core][CRITICAL] 处理消息时发生严重错误 (用户: ${userId}, RAG上下文: ${currentRagContextId}):`,
      error instanceof BaseError ? error.toString() : errorMessage,
      error instanceof BaseError && error.details ? error.details : "",
      errorStack, // Log stack for all errors in this critical path
    );
    return {
      responseText: "[抱歉，处理您的请求时发生内部错误，请稍后再试。]",
      newContextId: currentRagContextId, // Return the context ID at the point of failure
    };
  }
}

// --- 主函数：程序入口 (添加自我概念初始化) ---
async function main() {
  try {
    console.log("==============================================");
    console.log("  AI 人格核心 - 爱丽丝 v9.0 (认知整合协调)"); // 版本更新
    console.log("==============================================");
    console.log("▶️ 系统初始化中...");

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

    console.log("\n▶️ 主函数执行完毕 (CLI 模式) 或等待信号 (Bot 模式)...");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
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

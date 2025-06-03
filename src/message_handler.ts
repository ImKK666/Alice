// src/message_handler.ts
/**
 * 消息处理核心模块
 *
 * 从 main.ts 中提取出来，避免循环导入问题
 */

import type { ChatMessageInput } from "./memory_processor.ts";
import { config } from "./config.ts";

// --- 进化模块导入 ---
import {
  type Insight,
  retrieveRelevantInsights,
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

// --- 社交认知和自我概念模块 ---
import {
  type EnhancedRelationshipState,
  getSocialCognitionManager,
} from "./social_cognition.ts";
import { selfConcept, type SelfModel } from "./self_concept.ts";
import { CognitiveIntegrationManager } from "./cognitive_integration.ts";

// --- STM 和状态管理 ---
import { getStm, updateStm } from "./stm_manager.ts";
import {
  getLastWanderingTime,
  setLastWanderingTime,
  updateActiveUserContexts,
} from "./state_utils.ts";

// --- 认知工具 ---
import {
  analyzeMessageSentiment,
  detectImportantMessage,
} from "./cognitive_utils.ts";

// --- 上下文和 LTM 处理 ---
import { determineCurrentContext } from "./context_detector.ts";
import {
  decideLtmStrategy,
  retrieveLtmBasedOnStrategy,
} from "./ltm_processor.ts";

// --- 响应生成 ---
import { generateResponseWithMemory } from "./prompt_builder.ts";

// --- 错误处理 ---
import { BaseError } from "./errors.ts";

// --- 异步处理工具 ---
import { executeParallelTasks, globalParallelExecutor } from "./utils/async_utils.ts";

// --- 从 main.ts 导入必要的全局变量和函数 ---
import { extractRecentTopics, kvHolder, ltmWorkerHolder } from "./main.ts";

// --- 类型定义 ---
interface BodyExpressions {
  metaphorical: string;
  sensory: string;
  posture: string;
  energy: string;
}

// --- 模块实例 ---
const socialCognition = getSocialCognitionManager();
const selfConceptManager = new selfConcept.SelfConceptManager();
let cognitiveIntegrationManager: CognitiveIntegrationManager | null = null;

// --- 状态管理 ---
const activeUserContexts = new Map<string, string[]>();

// --- 停用词集合（从 main.ts 获取） ---
let loadedStopwordsSet: Set<string> = new Set();

/**
 * 处理传入消息的核心函数 (包含所有增强逻辑)
 * @param message 传入的聊天消息
 * @param initialContextId 处理开始时的 RAG 上下文 ID
 * @param platform 来源平台 ('cli', 'discord', 'telegram' 等)
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

    console.log(`   [Core][日志] 5. 🚀 开始并行分析和状态更新...`);

    // --- 🔥 核心并行化优化：同时执行情感分析、LTM策略决定和状态更新 ---
    let messageSentiment: any;
    let ltmStrategy: any;
    let updatedBodyState: VirtualPhysicalState | null = null;
    let updatedRelationshipState: EnhancedRelationshipState | null = null;
    let conversationPace = 1.0;
    let currentSelfModel: SelfModel | null = null;

    // 使用新的并行任务执行器
    const coreAnalysisTasks = [
      {
        name: "情感分析",
        task: () => analyzeMessageSentiment(message.text),
        timeout: 15000,
        priority: 1, // 高优先级
        fallbackValue: {
          valence: 0,
          arousal: 0.1,
          emotionDimensions: { neutral: 1.0 },
          dominant_emotion: "neutral"
        }
      },
      {
        name: "LTM策略决定",
        task: () => decideLtmStrategy(currentRagContextId),
        timeout: 10000,
        priority: 2,
        fallbackValue: "LTM_NOW"
      },
      {
        name: "自我模型获取",
        task: () => selfConceptManager.getSelfModel(),
        timeout: 5000,
        priority: 3,
        fallbackValue: null
      }
    ];

    // 条件性添加状态更新任务
    if (config.virtualEmbodiment.enabled) {
      coreAnalysisTasks.push({
        name: "身体状态更新",
        task: () => processMessageAndUpdateState(
          userId,
          currentRagContextId,
          { text: message.text, emotional_state: { valence: 0, arousal: 0.1 } }, // 临时值
          false,
          kvHolder.instance!,
          loadedStopwordsSet
        ),
        timeout: 20000,
        priority: 4,
        fallbackValue: null
      });
    }

    if (config.timePerception.enabled) {
      coreAnalysisTasks.push({
        name: "时间状态更新",
        task: async () => {
          await recordInteractionTimestamp(userId, currentRagContextId, kvHolder.instance!);
          return await analyzeConversationPace(userId, currentRagContextId, message.text, kvHolder.instance!);
        },
        timeout: 10000,
        priority: 5,
        fallbackValue: 1.0
      });
    }

    console.log(`   [Core][并行] 🔄 执行 ${coreAnalysisTasks.length} 个核心分析任务...`);
    const coreResults = await executeParallelTasks(coreAnalysisTasks, {
      timeout: 25000 // 总超时25秒
    });

    // 提取结果
    messageSentiment = coreResults[0].success ? coreResults[0].result : coreResults[0].fallbackValue;
    ltmStrategy = coreResults[1].success ? coreResults[1].result : coreResults[1].fallbackValue;
    currentSelfModel = coreResults[2].success ? coreResults[2].result : coreResults[2].fallbackValue;

    let bodyStateIndex = 3;
    let timeStateIndex = config.virtualEmbodiment.enabled ? 4 : 3;

    if (config.virtualEmbodiment.enabled) {
      updatedBodyState = coreResults[bodyStateIndex].success ? coreResults[bodyStateIndex].result : null;
    }

    if (config.timePerception.enabled) {
      conversationPace = coreResults[timeStateIndex].success ? coreResults[timeStateIndex].result : 1.0;
    }

    console.log(`   [Core][并行] ✅ 核心分析完成:`);
    console.log(`     - 情感分析: ${coreResults[0].success ? '成功' : '失败'} (${coreResults[0].duration}ms)`);
    console.log(`     - LTM策略: ${coreResults[1].success ? '成功' : '失败'} (${coreResults[1].duration}ms)`);
    console.log(`     - 自我模型: ${coreResults[2].success ? '成功' : '失败'} (${coreResults[2].duration}ms)`);
    if (config.virtualEmbodiment.enabled) {
      console.log(`     - 身体状态: ${coreResults[bodyStateIndex].success ? '成功' : '失败'} (${coreResults[bodyStateIndex].duration}ms)`);
    }
    if (config.timePerception.enabled) {
      console.log(`     - 时间状态: ${coreResults[timeStateIndex].success ? '成功' : '失败'} (${coreResults[timeStateIndex].duration}ms)`);
    }

    console.log(
      `   [Core][调试] 情感分析结果: 效价=${messageSentiment.valence.toFixed(2)}, 强度=${messageSentiment.arousal.toFixed(2)}, 主导=${messageSentiment.dominant_emotion}`,
    );

    // 现在处理需要情感分析结果的社交关系更新
    if (config.socialDynamics.enabled) {
      console.log(`   [Core][日志] 6. 更新社交关系状态...`);
      try {
        updatedRelationshipState = await socialCognition.analyzeInteractionAndUpdateRelationship(
          userId,
          { text: message.text, timestamp: message.timestamp || Date.now() },
          messageSentiment,
          currentRagContextId
        );
        console.log(`   [Core][调试] ✅ 关系状态更新完成 (风格: ${updatedRelationshipState?.current_interaction_style ?? "N/A"})`);
      } catch (err) {
        console.error("   [Core][错误] ❌ 更新关系状态失败:", err);
        updatedRelationshipState = null;
      }
    }

    // --- 🔥 第二阶段并行化：LTM检索和增强功能 ---
    console.log(`   [Core][日志] 7. 🚀 并行执行LTM检索和增强功能...`);

    const enhancementTasks = [
      {
        name: "LTM检索",
        task: () => retrieveLtmBasedOnStrategy(ltmStrategy, messageForRag, messageSentiment),
        timeout: 20000,
        priority: 1, // 最高优先级
        fallbackValue: []
      },
      {
        name: "洞见检索",
        task: () => config.mindWandering.enabled
          ? retrieveRelevantInsights(messageForRag, 2)
          : Promise.resolve([]),
        timeout: 15000,
        priority: 2,
        fallbackValue: []
      },
      {
        name: "时间标记检索",
        task: () => config.timePerception.enabled
          ? findRelevantTimeMarkers(userId, currentRagContextId, message.text, kvHolder.instance!)
          : Promise.resolve([]),
        timeout: 10000,
        priority: 3,
        fallbackValue: []
      },
      {
        name: "身体表达生成",
        task: () => (config.virtualEmbodiment.enabled && updatedBodyState)
          ? generateEmbodiedExpressions(updatedBodyState)
          : Promise.resolve({
              metaphorical: "",
              sensory: "",
              posture: "",
              energy: updatedBodyState ? generateBodyStateExpression(updatedBodyState) : ""
            }),
        timeout: 12000,
        priority: 4,
        fallbackValue: {
          metaphorical: "",
          sensory: "",
          posture: "",
          energy: updatedBodyState ? generateBodyStateExpression(updatedBodyState) : ""
        }
      }
    ];

    // 异步触发重要消息检测（不阻塞主流程）
    if (config.timePerception.enabled) {
      detectImportantMessage(message.text)
        .then((importantInfo) => {
          if (importantInfo) {
            console.log(`   [Core][异步] ℹ️ 检测到重要消息，添加时间标记: "${importantInfo.description}"`);
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
        .catch((err) => console.error("   [Core][异步错误] ❌ 检测重要消息失败:", err));
    }

    console.log(`   [Core][并行] 🔄 执行 ${enhancementTasks.length} 个增强功能任务...`);
    const enhancementResults = await executeParallelTasks(enhancementTasks, {
      timeout: 25000 // 总超时25秒
    });

    // 提取结果
    const retrievedLtm = enhancementResults[0].success ? enhancementResults[0].result : enhancementResults[0].fallbackValue;
    const relevantInsights = enhancementResults[1].success ? enhancementResults[1].result : enhancementResults[1].fallbackValue;
    const relevantTimeMarkers = enhancementResults[2].success ? enhancementResults[2].result : enhancementResults[2].fallbackValue;
    const bodyExpressionsResult = enhancementResults[3].success ? enhancementResults[3].result : enhancementResults[3].fallbackValue;

    console.log(`   [Core][并行] ✅ 增强功能完成:`);
    console.log(`     - LTM检索: ${enhancementResults[0].success ? '成功' : '失败'} (${enhancementResults[0].duration}ms) - ${Array.isArray(retrievedLtm) ? retrievedLtm.length : 0}条记忆`);
    console.log(`     - 洞见检索: ${enhancementResults[1].success ? '成功' : '失败'} (${enhancementResults[1].duration}ms) - ${Array.isArray(relevantInsights) ? relevantInsights.length : 0}条洞见`);
    console.log(`     - 时间标记: ${enhancementResults[2].success ? '成功' : '失败'} (${enhancementResults[2].duration}ms) - ${Array.isArray(relevantTimeMarkers) ? relevantTimeMarkers.length : 0}个标记`);
    console.log(`     - 身体表达: ${enhancementResults[3].success ? '成功' : '失败'} (${enhancementResults[3].duration}ms)`);

    console.log(`   [Core][调试] 检索到 ${Array.isArray(retrievedLtm) ? retrievedLtm.length : 0} 条LTM记忆，${Array.isArray(relevantInsights) ? relevantInsights.length : 0} 条洞见`);
    // --- 思维漫游触发检查和详细日志 ---
    const triggerProbability = config.mindWandering.triggerProbability || 0.15;
    const randomValue = Math.random();
    const mindWanderingEnabled = config.mindWandering.enabled;

    console.log(`   [Core][日志] 13. 思维漫游触发检查...`);
    console.log(`   [MindWander][调试] 🎲 触发条件检查:`);
    console.log(`     - 模块启用: ${mindWanderingEnabled}`);
    console.log(
      `     - 触发概率: ${triggerProbability} (${
        (triggerProbability * 100).toFixed(1)
      }%)`,
    );
    console.log(`     - 随机值: ${randomValue.toFixed(3)}`);
    console.log(
      `     - 是否触发: ${
        mindWanderingEnabled && randomValue < triggerProbability
      }`,
    );

    if (mindWanderingEnabled && randomValue < triggerProbability) {
      console.log(`   [MindWander][日志] 🌊 概率触发思维漫游 (异步执行)...`);

      (async () => {
        const wanderStartTime = Date.now();
        console.log(
          `   [MindWander][性能] ⏱️ 思维漫游开始执行 (${
            new Date().toLocaleTimeString()
          })`,
        );

        try {
          // 获取冷却时间信息
          const lastWander = await getLastWanderingTime(
            userId,
            currentRagContextId,
          );
          const cooldownMs = (config.mindWandering.cooldownMinutes || 5) * 60 *
            1000;
          const timeSinceLastWander = Date.now() - lastWander;
          const cooldownRemaining = Math.max(
            0,
            cooldownMs - timeSinceLastWander,
          );

          console.log(`   [MindWander][调试] ⏰ 冷却时间检查:`);
          console.log(
            `     - 上次漫游时间: ${
              lastWander > 0
                ? new Date(lastWander).toLocaleTimeString()
                : "从未执行"
            }`,
          );
          console.log(
            `     - 冷却时间设置: ${(cooldownMs / 60000).toFixed(1)} 分钟`,
          );
          console.log(
            `     - 距离上次: ${(timeSinceLastWander / 60000).toFixed(1)} 分钟`,
          );
          console.log(
            `     - 剩余冷却: ${(cooldownRemaining / 60000).toFixed(1)} 分钟`,
          );

          if (cooldownRemaining > 0) {
            console.log(`   [MindWander][调试] ❄️ 思维漫游冷却中，跳过执行`);
            return;
          }

          // 准备思维漫游上下文
          const recentTopics = extractRecentTopics(updatedStm);
          const wanderingContext: WanderingContext = {
            user_id: userId,
            context_id: currentRagContextId,
            recent_topics: recentTopics,
            emotional_state: {
              valence: messageSentiment.valence,
              arousal: messageSentiment.arousal,
            },
            last_wandering_time: lastWander,
          };

          console.log(`   [MindWander][调试] 🧠 思维漫游上下文准备:`);
          console.log(`     - 用户ID: ${userId}`);
          console.log(`     - 上下文ID: ${currentRagContextId}`);
          console.log(
            `     - 最近话题 (${recentTopics.length}个): [${
              recentTopics.slice(0, 5).join(", ")
            }${recentTopics.length > 5 ? "..." : ""}]`,
          );
          console.log(`     - 情感状态:`);
          console.log(
            `       * 效价 (愉悦度): ${
              messageSentiment.valence.toFixed(3)
            } (-1=负面, +1=正面)`,
          );
          console.log(
            `       * 强度 (激活度): ${
              messageSentiment.arousal.toFixed(3)
            } (0=平静, 1=激动)`,
          );
          console.log(
            `       * 主导情感: ${messageSentiment.dominant_emotion}`,
          );

          // 执行思维漫游
          console.log(`   [MindWander][执行] 🚀 开始思维漫游推理过程...`);
          const apiCallStartTime = Date.now();

          const result = await triggerMindWandering(wanderingContext);

          const apiCallDuration = Date.now() - apiCallStartTime;
          const totalDuration = Date.now() - wanderStartTime;

          console.log(`   [MindWander][性能] 📊 执行性能统计:`);
          console.log(`     - API 调用耗时: ${apiCallDuration}ms`);
          console.log(`     - 总执行耗时: ${totalDuration}ms`);

          // 分析思维漫游结果
          if (result && result.insights && result.insights.length > 0) {
            console.log(`   [MindWander][结果] ✨ 思维漫游成功生成洞见:`);
            console.log(`     - 洞见数量: ${result.insights.length}`);

            result.insights.forEach((insight, index) => {
              console.log(`     - 洞见 ${index + 1}:`);
              console.log(
                `       * 内容: "${insight.content.substring(0, 100)}${
                  insight.content.length > 100 ? "..." : ""
                }"`,
              );
              console.log(
                `       * 信心度: ${
                  insight.confidence?.toFixed(3) || "未评分"
                } (0.0-1.0)`,
              );
              console.log(`       * 类型: ${insight.insight_type || "未分类"}`);
              console.log(
                `       * 源记忆: [${
                  insight.source_memories?.slice(0, 3).join(", ") || "无"
                }]`,
              );
              console.log(
                `       * 上下文: [${
                  insight.context_ids?.slice(0, 2).join(", ") || "无"
                }]`,
              );
              console.log(
                `       * 使用次数: ${insight.use_count || 0}`,
              );
            });

            // 更新最后漫游时间
            await setLastWanderingTime(userId, currentRagContextId, Date.now());
            console.log(`   [MindWander][状态] 💾 已更新最后漫游时间戳`);

            console.log(
              `   [MindWander][成功] 🎉 思维漫游完成，共生成 ${result.insights.length} 条有价值洞见`,
            );
          } else {
            console.log(`   [MindWander][结果] 🤔 思维漫游未生成洞见:`);
            console.log(
              `     - 可能原因: 当前话题缺乏新颖性、情感强度不足、或上下文信息有限`,
            );
            console.log(`     - 建议: 继续对话以积累更多上下文信息`);
          }
        } catch (err) {
          const errorDuration = Date.now() - wanderStartTime;
          console.error(
            `   [MindWander][错误] ❌ 思维漫游执行失败 (耗时: ${errorDuration}ms):`,
          );
          console.error(
            `     - 错误类型: ${
              err instanceof Error ? err.constructor.name : typeof err
            }`,
          );
          console.error(
            `     - 错误信息: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          if (err instanceof Error && err.stack) {
            console.error(
              `     - 错误堆栈: ${
                err.stack.split("\n").slice(0, 3).join("\n")
              }`,
            );
          }

          // 错误恢复：设置冷却时间避免频繁重试
          await setLastWanderingTime(userId, currentRagContextId, Date.now());
          console.log(`   [MindWander][恢复] 🛡️ 已设置冷却时间，避免频繁重试`);
        }
      })();
    } else {
      const skipReason = !mindWanderingEnabled
        ? "模块未启用"
        : `概率未触发 (${randomValue.toFixed(3)} >= ${triggerProbability})`;
      console.log(`   [MindWander][跳过] ⏭️ 跳过思维漫游: ${skipReason}`);
    }

    // --- 🔥 第三阶段：生成最终响应 ---
    console.log(`   [Core][日志] 8. 🚀 生成最终响应...`);
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
      updatedRelationshipState,
      currentSelfModel,
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

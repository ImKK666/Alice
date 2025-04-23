// src/main.ts (修改版，根据场景选择 LTM 策略，提供完整代码)

// --- 核心依赖导入 ---
import { parse } from "https://deno.land/std@0.224.0/flags/mod.ts"; // 用于解析命令行参数
import { config } from "./config.ts";
import { type ChatMessageInput } from "./memory_processor.ts";
import { embeddings } from "./embeddings.ts";
import {
  ensureCollectionExists,
  type MemoryPayload,
  qdrantClient, // 确认 qdrantClient 是否需要导出，目前看不需要
  type Schemas,
  searchMemories,
} from "./qdrant_client.ts";
import { llm } from "./llm.ts";
import {
  type CandidateMemory,
  type RerankedMemory, // 确保 RerankedMemory 被使用或移除导入
  rerankMemories,
} from "./reranker.ts";

// --- 接口模块导入 ---
import { startCli } from "./cli_interface.ts";
import { startDiscord } from "./discord_interface.ts";

// --- 类型定义 ---
// 将 LtmContextItem 定义移到这里或单独的 types.ts 文件
interface LtmContextItem {
  id: string;
  payload: MemoryPayload;
  score?: number; // 原始相关性得分 (仅 LTM_NOW)
  rerank_score?: number; // Rerank 得分 (仅 LTM_NOW)
  source: "retrieved" | "recent"; // 来源标记: 'retrieved'表示精确检索, 'recent'表示最近记忆
}
// 定义 LTM 策略类型
type LtmStrategy = "LTM_NOW" | "LTM_RECENT";

// --- STM 相关 ---
const STM_MAX_MESSAGES = 15;
// 导出 kv 供 cli_interface 使用
export let kv: Deno.Kv | null = null;

// --- LTM Worker ---
let ltmWorker: Worker | null = null;

// --- 初始化 STM (Deno KV) ---
async function initializeKv() {
  try {
    kv = await Deno.openKv();
    console.log("✅ STM (Deno KV) 初始化成功。");
  } catch (error) {
    console.error("❌ STM (Deno KV) 初始化失败:", error);
    console.warn("⚠️ STM 功能将被禁用 (CLI模式下的 /stm 命令会受影响)。");
  }
}

// --- 初始化 LTM Worker ---
function initializeLtmWorker() {
  try {
    ltmWorker = new Worker(new URL("./ltm_worker.ts", import.meta.url).href, {
      type: "module",
    });
    console.log("✅ LTM Worker 初始化成功。");
    ltmWorker.onerror = (e) => {
      console.error(`❌ LTM Worker 遇到错误: ${e.message}`);
      e.preventDefault();
    };
    ltmWorker.onmessage = (e) => {
      // 可以根据需要处理来自 Worker 的消息，例如状态更新
      console.log(`[ LTM Worker 消息 ] ${JSON.stringify(e.data)}`);
    };
    ltmWorker.onmessageerror = (e) => {
      console.error("[ LTM Worker ] 接收消息出错:", e);
    };
  } catch (error) {
    console.error("❌ LTM Worker 初始化失败:", error);
    console.warn("⚠️ LTM 后台处理将被禁用。");
  }
}

// --- STM 相关函数 (导出 getStm 供 CLI 使用) ---
export async function getStm(contextId: string): Promise<ChatMessageInput[]> {
  if (!kv) return []; // 如果 KV 未初始化，返回空数组
  try {
    const key = ["stm", contextId];
    const result = await kv.get<ChatMessageInput[]>(key);
    return result.value ?? []; // 如果键不存在或值为 null，返回空数组
  } catch (error) {
    console.error(`❌ 读取 STM 出错 (上下文 ${contextId}):`, error);
    return []; // 出错时返回空数组
  }
}

// 更新 STM，使用原子操作处理并发
async function updateStm(
  contextId: string,
  newMessage: ChatMessageInput,
): Promise<ChatMessageInput[]> {
  if (!kv) return [newMessage]; // 如果 KV 未初始化，只返回新消息
  const key = ["stm", contextId];
  let finalStm: ChatMessageInput[] = [newMessage]; // 默认情况下至少包含新消息
  try {
    let success = false;
    // 重试机制，处理可能的版本冲突
    for (let i = 0; i < 3 && !success; i++) {
      // 获取当前 STM 和版本戳
      const getResult = await kv.get<ChatMessageInput[]>(key);
      const currentStm = getResult.value ?? [];
      const currentVersionstamp = getResult.versionstamp; // 用于原子性检查

      // 合并并裁剪 STM
      const combinedStm = [...currentStm, newMessage];
      const prunedStm = combinedStm.slice(-STM_MAX_MESSAGES); // 保留最新的 N 条
      finalStm = prunedStm; // 更新函数范围内的 finalStm

      // 准备原子操作
      const atomicOp = kv.atomic()
        .check({ key: key, versionstamp: currentVersionstamp }) // 检查版本是否匹配
        .set(key, prunedStm); // 设置新值

      // 提交原子操作
      const commitResult = await atomicOp.commit();

      if (commitResult.ok) {
        success = true; // 操作成功
      } else {
        // 操作失败（通常是版本冲突），记录警告并稍后重试
        console.warn(
          `⚠️ STM 更新冲突 (上下文 ${contextId})，尝试次数 ${
            i + 1
          }。正在重试...`,
        );
        // 随机延迟后重试
        await new Promise((resolve) =>
          setTimeout(resolve, Math.random() * 50 + 20)
        );
      }
    }
    // 如果重试后仍失败，记录错误
    if (!success) {
      console.error(
        `❌ STM 更新失败 (上下文 ${contextId})，已达最大尝试次数。`,
      );
      // 即使失败，也尝试返回当前内存中的 prunedStm，虽然它可能不是 KV 中的最新状态
    }
    return finalStm; // 返回最终的 STM 列表 (成功时是更新后的，失败时是最后一次尝试的)
  } catch (error) {
    // 处理原子操作过程中的其他错误
    console.error(`❌ STM 原子更新出错 (上下文 ${contextId}):`, error);
    return finalStm; // 出错时返回当前内存中的状态
  }
}

// --- 核心 RAG 逻辑 ---

// 步骤 0: 自动判断当前上下文 (修复连续切换时 ID 生成 Bug 的版本)
async function determineCurrentContext(
  _userId: string,
  previousContextId: string,
  stmHistory: ChatMessageInput[],
  newMessage: ChatMessageInput,
): Promise<string> {
  console.log(
    `▶️ [ContextDetect] 开始判断场景 (先前 RAG 上下文: ${previousContextId})...`,
  );
  const historySnippet = stmHistory
    .slice(-5)
    .map((msg) => `${msg.userId}: ${msg.text}`)
    .join("\n");
  const classificationPrompt = `
Analyze the latest user message in the context of the recent conversation history and the previous context ID.
Classify the primary topic/context. Choose ONE category: [Casual Chat, Work Task/Project, Info Query, Scheduling, Other].
If the category is "Work Task/Project", identify the specific project **identifier or code** if clearly mentioned recently (e.g., "华日 045", "阿健 008", "项目 Alpha"). Focus on company/client names and associated numbers/codes. Avoid including general descriptions like "椅子" if the number itself is the identifier.

Previous Context ID was: ${previousContextId}
Recent History:
${historySnippet || "(无历史记录)"}
Latest User Message: ${newMessage.userId}: ${newMessage.text}

Output Format: Respond ONLY with the category, optionally followed by a colon and the project identifier/code. Examples:
Casual Chat
Work Task/Project: 华日 045
Info Query
Scheduling
Work Task/Project: 阿健_008
Work Task/Project: 045
Work Task/Project

Category:`;

  try {
    const response = await llm.invoke(classificationPrompt, { stop: ["\n"] });
    const classificationResult =
      (typeof response === "string" ? response : response.content as string)
        ?.trim();
    console.log(
      `   [调试 ContextDetect] LLM 原始分类结果: "${
        classificationResult || "(空)"
      }"`,
    );
    console.log(
      `   [ContextDetect] LLM 分类结果: ${classificationResult || "(空)"}`,
    );

    let newContextId = previousContextId;

    // --- 改进：解析原始来源类型和标识符 ---
    let originalSourceType = "unknown";
    let originalIdentifier = previousContextId; // 默认值

    // 尝试匹配格式：类别_来源类型_标识符
    const specificPattern =
      /^(casual_chat|info_query|scheduling|other|work_general)_([^_]+)_(.+)$/;
    const specificMatch = previousContextId.match(specificPattern);

    // 尝试匹配原始格式
    const discordChannelPattern = /^discord_channel_(.+)$/;
    const discordDmPattern = /^discord_dm_(.+)$/;
    const cliPattern = /^cli_(.+)$/;
    const workProjectPattern = /^work_project_(.+)$/; // 工作项目单独处理

    const dcMatch = previousContextId.match(discordChannelPattern);
    const dmMatch = previousContextId.match(discordDmPattern);
    const cliMatch = previousContextId.match(cliPattern);
    const wpMatch = previousContextId.match(workProjectPattern);

    if (specificMatch) {
      // 如果是 '类别_来源类型_标识符' 格式，提取来源类型和标识符
      originalSourceType = specificMatch[2];
      originalIdentifier = specificMatch[3];
      console.log(
        `   [调试 ContextDetect] 解析到特定格式来源: 类型=${originalSourceType}, 标识符=${originalIdentifier}`,
      );
    } else if (dcMatch) {
      originalSourceType = "dchan";
      originalIdentifier = dcMatch[1];
      console.log(
        `   [调试 ContextDetect] 解析到原始来源: 类型=${originalSourceType}, 标识符=${originalIdentifier}`,
      );
    } else if (dmMatch) {
      originalSourceType = "ddm";
      originalIdentifier = dmMatch[1];
      console.log(
        `   [调试 ContextDetect] 解析到原始来源: 类型=${originalSourceType}, 标识符=${originalIdentifier}`,
      );
    } else if (cliMatch) {
      originalSourceType = "cli";
      originalIdentifier = cliMatch[1];
      console.log(
        `   [调试 ContextDetect] 解析到原始来源: 类型=${originalSourceType}, 标识符=${originalIdentifier}`,
      );
    } else if (wpMatch) {
      // 工作项目比较特殊，我们可能不需要它的来源类型，只需要项目标识符
      originalSourceType = "work_project"; // 标记一下类型
      originalIdentifier = wpMatch[1]; // 项目标识符
      console.log(
        `   [调试 ContextDetect] 解析到工作项目: 标识符=${originalIdentifier}`,
      );
    } else {
      console.log(
        `   [调试 ContextDetect] 未能解析来源，将使用默认值: 类型=${originalSourceType}, 标识符=${originalIdentifier}`,
      );
    }
    // --- 结束改进 ---

    if (classificationResult) {
      const lowerResult = classificationResult.toLowerCase();
      let extractedIdentifier: string | null = null; // 用于工作项目

      if (lowerResult.startsWith("casual chat")) {
        // *** 使用解析出的 originalSourceType 和 originalIdentifier ***
        newContextId =
          `casual_chat_${originalSourceType}_${originalIdentifier}`;
        console.log(
          `   [调试 ContextDetect] 生成具体闲聊上下文 ID: ${newContextId}`,
        );
      } else if (lowerResult.startsWith("work task/project")) {
        const parts = classificationResult.split(":");
        if (parts.length > 1 && parts[1].trim()) {
          const identifierPart = parts[1].trim();
          const companyNumRegex = /([\p{L}]+)[\s_]*(\d+)/u;
          const companyNumMatch = identifierPart.match(companyNumRegex);
          const numberRegex = /(?<![\p{L}\d])(\d+)(?![\p{L}\d])/u;
          const numberMatch = identifierPart.match(numberRegex);
          if (companyNumMatch && companyNumMatch[1] && companyNumMatch[2]) {
            extractedIdentifier = `${companyNumMatch[1].toLowerCase()}_${
              companyNumMatch[2]
            }`;
            console.log(
              `   [调试 ContextDetect] 提取到公司名+数字: 公司=${
                companyNumMatch[1].toLowerCase()
              }, 数字=${companyNumMatch[2]}`,
            );
          } else if (numberMatch && numberMatch[1]) {
            extractedIdentifier = numberMatch[1];
            console.log(
              `   [调试 ContextDetect] 提取到独立数字: ${extractedIdentifier}`,
            );
          } else {
            const fallbackNumberMatch = identifierPart.match(/\d+/);
            if (fallbackNumberMatch) {
              extractedIdentifier = fallbackNumberMatch[0];
              console.log(
                `   [调试 ContextDetect] 后备提取到数字: ${extractedIdentifier}`,
              );
            }
          }
        }
        if (extractedIdentifier) {
          newContextId = `work_project_${extractedIdentifier}`; // 特定项目ID不变
          console.log(
            `   [调试 ContextDetect] 设置工作项目上下文ID为: ${newContextId}`,
          );
        } else {
          // *** 使用解析出的 originalSourceType 和 originalIdentifier ***
          newContextId =
            `work_general_${originalSourceType}_${originalIdentifier}`;
          console.log(
            `   [调试 ContextDetect] 无法提取标识符，设置为具体通用工作上下文ID: ${newContextId}`,
          );
        }
      } else if (lowerResult.startsWith("info query")) {
        // *** 使用解析出的 originalSourceType 和 originalIdentifier ***
        newContextId = `info_query_${originalSourceType}_${originalIdentifier}`;
        console.log(
          `   [调试 ContextDetect] 生成具体信息查询上下文 ID: ${newContextId}`,
        );
      } else if (lowerResult.startsWith("scheduling")) {
        // *** 使用解析出的 originalSourceType 和 originalIdentifier ***
        newContextId = `scheduling_${originalSourceType}_${originalIdentifier}`;
        console.log(
          `   [调试 ContextDetect] 生成具体日程安排上下文 ID: ${newContextId}`,
        );
      } else if (lowerResult.startsWith("other")) {
        // *** 使用解析出的 originalSourceType 和 originalIdentifier ***
        newContextId = `other_${originalSourceType}_${originalIdentifier}`;
        console.log(
          `   [调试 ContextDetect] 生成具体其他类别上下文 ID: ${newContextId}`,
        );
      }
      console.log(`   [调试 ContextDetect] 最终决定上下文 ID: ${newContextId}`);
    }

    if (newContextId !== previousContextId) {
      console.log(
        `   [ContextDetect] 💡 RAG 上下文自动切换: 从 "${previousContextId}" 到 "${newContextId}"`,
      );
    } else {
      console.log(
        `   [ContextDetect] RAG 上下文保持为: "${previousContextId}"`,
      );
    }
    return newContextId;
  } catch (error) {
    console.error("❌ [ContextDetect] 调用 LLM 进行上下文分类时出错:", error);
    console.log(
      "   [ContextDetect] ⚠️ 上下文分类失败，将沿用之前的 RAG 上下文 ID。",
    );
    return previousContextId;
  }
}

// 步骤 1: 决定 LTM 策略 (修改版，根据上下文ID前缀选择)
async function decideLtmStrategy(
  message: ChatMessageInput, // 这里的 contextId 应该是 RAG Context ID
  _personaMode: string, // 不再需要此参数
): Promise<LtmStrategy> { // 返回 LtmStrategy 类型
  console.log(
    `▶️ [LTM Strategy] 决定 LTM 策略 (RAG 上下文: ${message.contextId})...`,
  );

  // 工作相关上下文，使用精确检索+重排序
  if (message.contextId.startsWith("work_")) {
    console.log("   [LTM Strategy] -> 工作上下文，使用精确检索 (LTM_NOW)");
    return "LTM_NOW";
  } // 信息查询类上下文，也使用精确检索+重排序
  else if (message.contextId.startsWith("info_query_")) {
    console.log("   [LTM Strategy] -> 信息查询上下文，使用精确检索 (LTM_NOW)");
    return "LTM_NOW";
  } // 闲聊、日程、其他等场景，优先使用近期记忆
  else if (
    message.contextId.startsWith("casual_chat_") ||
    message.contextId.startsWith("scheduling_") ||
    message.contextId.startsWith("other_")
  ) {
    // 提取上下文类型用于日志输出
    const contextType = message.contextId.split("_")[0];
    console.log(
      `   [LTM Strategy] -> ${contextType} 上下文，使用近期记忆 (LTM_RECENT)`,
    );
    return "LTM_RECENT";
  } // 无法识别或默认情况，保守起见使用近期记忆 (或者你可以根据需要设为 LTM_NOW)
  else {
    console.log(
      "   [LTM Strategy] -> 未知或默认上下文，使用近期记忆 (LTM_RECENT)",
    );
    return "LTM_RECENT";
  }
}

// 步骤 3: 根据策略检索 LTM (调整补充逻辑和排序逻辑)
async function retrieveLtmBasedOnStrategy(
  strategy: LtmStrategy,
  message: ChatMessageInput, // 这里的 contextId 应该是 RAG Context ID
): Promise<LtmContextItem[]> {
  const contextId = message.contextId; // 使用 RAG Context ID
  const retrievedItems: LtmContextItem[] = []; // 存储初步检索结果
  console.log(
    `▶️ [LTM Retrieve] 根据策略 "${strategy}" 检索 LTM (RAG 上下文: ${contextId})...`,
  );

  // --- 分支：根据策略执行不同的检索方法 ---
  if (strategy === "LTM_NOW") {
    // LTM_NOW: 精确向量搜索 + Rerank
    try {
      console.log(
        `   [LTM Retrieve] -> 🔍 精确向量搜索 (RAG 上下文: ${contextId})...`,
      );
      const searchVector = await embeddings.embedQuery(message.text); // 生成查询向量
      // 构建 Qdrant 过滤器，只匹配当前 RAG 上下文 ID
      const filter: Schemas["Filter"] = {
        must: [{ key: "source_context", match: { value: contextId } }],
      };
      // 执行向量搜索
      const initialMemories = await searchMemories(
        config.qdrantCollectionName,
        searchVector,
        config.ragInitialRetrievalLimit, // 初始检索数量上限
        filter,
      );
      console.log(
        `   [调试 LTM Retrieve] 初始向量搜索找到 ${initialMemories.length} 条结果 (上下文: ${contextId})。`,
      );
      // 转换结果格式以供 Reranker 使用
      const candidateMemories: CandidateMemory[] = initialMemories.map(
        (mem) => ({
          id: mem.id.toString(), // Qdrant ID 转字符串
          score: mem.score, // 原始相关性得分
          payload: mem.payload as unknown as MemoryPayload, // Payload 类型断言
        }),
      );

      // 如果有候选记忆，进行重排序
      if (candidateMemories.length > 0) {
        console.log("   [LTM Retrieve] -> 🔄 执行 LTM 重排序...");
        const rerankedMemories: RerankedMemory[] = await rerankMemories(
          message.text,
          candidateMemories,
        );
        console.log(
          `   [调试 LTM Retrieve] 重排序后得到 ${rerankedMemories.length} 条结果。`,
        );
        // 如果重排序成功，使用重排序结果
        if (rerankedMemories.length > 0) {
          console.log("   [LTM Retrieve] -> ✅ 重排序成功，使用重排后的结果。");
          retrievedItems.push(
            ...rerankedMemories
              .slice(0, config.ragRerankTopN) // 取 Top N
              .map((mem): LtmContextItem => ({
                id: mem.id,
                payload: mem.payload,
                rerank_score: mem.rerank_score, // 记录 rerank 分数
                source: "retrieved", // 标记来源
              })),
          );
        } else {
          // 重排序失败或无结果，回退到使用原始向量搜索结果
          console.warn(
            "   [LTM Retrieve] -> ⚠️ 重排序失败或无结果，回退到原始向量搜索结果。",
          );
          retrievedItems.push(
            ...initialMemories
              .slice(0, config.ragFallbackTopN) // 取回退的 Top N
              .map((mem): LtmContextItem => ({
                id: mem.id.toString(),
                payload: mem.payload as unknown as MemoryPayload,
                score: mem.score, // 记录原始 score
                source: "retrieved",
              })),
          );
        }
      } else {
        // 初始向量搜索就没有结果
        console.log("   [LTM Retrieve] -> ℹ️ 初始向量搜索无结果。");
      }
    } catch (error) {
      console.error(
        `❌ [LTM Retrieve] LTM_NOW 检索过程中出错 (${contextId}):`,
        error instanceof Error ? error.message : error,
      );
    }
  } else if (strategy === "LTM_RECENT") {
    // LTM_RECENT: 获取最近的记忆 (无向量搜索)
    try {
      console.log(
        `   [LTM Retrieve] -> 🕒 获取最近 ${config.ragRecentLtmLimit} 条 LTM (RAG 上下文: ${contextId})...`,
      );
      // 使用 Qdrant scroll API 获取点
      // 注意：scroll API 对排序的支持可能有限，我们在客户端进行最终排序
      const scrollResult = await qdrantClient.scroll(
        config.qdrantCollectionName,
        {
          limit: config.ragRecentLtmLimit * 2, // 多获取一些以便排序，避免因 offset 问题丢失最新
          with_payload: true,
          with_vector: false, // 不需要向量数据
          filter: { // 确保只获取当前上下文的
            must: [{ key: "source_context", match: { value: contextId } }],
          },
          // Qdrant scroll 的 order_by 可能不适用于所有字段或需要特定索引
          // order_by: { key: "timestamp", direction: "desc" }
        },
      );
      console.log(
        `   [调试 LTM Retrieve] 最近记忆滚动查询找到 ${scrollResult.points.length} 个点 (上下文: ${contextId})。`,
      );

      // 如果找到了点
      if (scrollResult.points.length > 0) {
        // 在客户端按时间戳降序排序，确保拿到的是最新的
        scrollResult.points.sort((a, b) =>
          (b.payload?.timestamp as number || 0) -
          (a.payload?.timestamp as number || 0)
        );
        // 取排序后的前 N 条
        retrievedItems.push(
          ...scrollResult.points
            .slice(0, config.ragRecentLtmLimit) // 取最终限制的数量
            .map((point): LtmContextItem => ({
              id: point.id.toString(),
              payload: point.payload as unknown as MemoryPayload,
              source: "recent", // 标记来源为“最近”
            })),
        );
        console.log(
          `   [LTM Retrieve] -> ✅ 获取并排序了 ${retrievedItems.length} 条最近记忆。`,
        );
      } else {
        // 在当前上下文中未找到任何近期 LTM
        console.log(
          `   [LTM Retrieve] -> ℹ️ 在 RAG 上下文 ${contextId} 中未找到最近的 LTM。`,
        );
      }
    } catch (error) {
      console.error(
        `❌ [LTM Retrieve] LTM_RECENT 检索过程中出错 (${contextId}):`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  // --- 补充通用对话记忆 (统一逻辑：无论哪种策略，结果不足都尝试补充) ---
  const needsSupplement = retrievedItems.length < config.ragMaxMemoriesInPrompt; // 检查是否需要补充
  const supplementLimit = config.ragMaxMemoriesInPrompt - retrievedItems.length; // 计算需要补充多少条

  if (needsSupplement && supplementLimit > 0) {
    console.log(
      `   [LTM Retrieve] -> ℹ️ (${strategy})结果不足 ${config.ragMaxMemoriesInPrompt} 条，尝试补充通用记忆 (不过滤上下文)...`,
    );
    try {
      const searchVector = await embeddings.embedQuery(message.text); // 为补充搜索生成向量
      // 构建补充搜索的过滤器：排除已有的条目
      const supplementFilter: Schemas["Filter"] = {
        must_not: [{ has_id: retrievedItems.map((item) => item.id) }], // 避免补充重复项
      };
      console.log(
        `   [调试 LTM Retrieve] 补充搜索过滤器: ${
          JSON.stringify(supplementFilter)
        }`,
      );
      // 执行补充的向量搜索（不过滤上下文）
      const supplementMemories = await searchMemories(
        config.qdrantCollectionName,
        searchVector,
        supplementLimit, // 只补充所需的数量
        supplementFilter,
      );
      console.log(
        `   [调试 LTM Retrieve] 补充搜索找到 ${supplementMemories.length} 条结果。`,
      );
      // 如果找到了补充记忆
      if (supplementMemories.length > 0) {
        // 将补充的记忆添加到结果列表中
        retrievedItems.push(
          ...supplementMemories.map((mem): LtmContextItem => ({
            id: mem.id.toString(),
            payload: mem.payload as unknown as MemoryPayload,
            score: mem.score, // 补充的记忆是通过向量搜索得到的，有 score
            source: "retrieved", // 标记来源为 retrieved，即使是在 LTM_RECENT 策略下补充的
          })),
        );
        console.log(
          `   [LTM Retrieve] -> ✅ 补充了 ${supplementMemories.length} 条通用记忆。`,
        );
      } else {
        // 未找到可补充的记忆
        console.log("   [LTM Retrieve] -> ℹ️ 未找到可补充的通用记忆。");
      }
    } catch (error) {
      console.error(
        `❌ [LTM Retrieve] 补充通用记忆时出错:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  // --- 最终限制、排序和去重 ---
  // 统一排序逻辑：优先显示 rerank_score 高的，其次 score 高的，
  // 如果分数相同或都没有分数（比如都是 recent），则按时间戳降序（最新的在前）
  retrievedItems.sort((a, b) => {
    const scoreA = a.rerank_score ?? a.score ?? -Infinity; // 无分数的视为负无穷
    const scoreB = b.rerank_score ?? b.score ?? -Infinity;

    // 如果主要分数不同，按分数降序
    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }
    // 如果分数相同（例如都是 recent 或 score 相等），比较时间戳
    if (a.payload.timestamp && b.payload.timestamp) {
      return b.payload.timestamp - a.payload.timestamp; // 时间戳降序（新的在前）
    }
    // 如果其中一个没有时间戳，有时间戳的优先
    if (a.payload.timestamp) return -1;
    if (b.payload.timestamp) return 1;
    // 如果都没有分数和时间戳，保持原始相对顺序（或视为相等）
    return 0;
  });

  // 去重：确保每个 LTM 条目只出现一次
  const uniqueItems = retrievedItems.filter((item, index, self) =>
    index === self.findIndex((t) => t.id === item.id)
  );
  // 截取最终数量：确保不超过配置的最大数量
  const finalItems = uniqueItems.slice(0, config.ragMaxMemoriesInPrompt);

  // 打印最终 LTM 列表的调试信息
  console.log(
    `   [调试 LTM Retrieve] 最终 LTM 列表 (共 ${finalItems.length} 条，已排序去重):`,
  );
  finalItems.forEach((item, idx) => {
    // 打印更详细的信息，包括时间戳（如果存在）
    console.log(
      `     [${idx + 1}] ID: ${item.id}, Source: ${item.source}, Score: ${
        item.rerank_score?.toFixed(4) ?? item.score?.toFixed(4) ?? "N/A"
      }, Time: ${
        item.payload.timestamp
          ? new Date(item.payload.timestamp).toLocaleTimeString("zh-TW", {
            timeZone: "Asia/Taipei",
          })
          : "N/A"
      }, Type: ${item.payload.memory_type}`,
    );
  });

  // 打印 LTM 检索完成日志
  console.log(
    `✅ [LTM Retrieve] LTM 检索完成，最终返回 ${finalItems.length} 条记忆 (策略: ${strategy})。`,
  );
  return finalItems; // 返回最终处理后的 LTM 列表
}

// 步骤 4: 基于 STM 和选定的 LTM 生成回应 (保持不变)
async function generateResponseWithMemory(
  message: ChatMessageInput, // 包含 RAG Context ID
  stmHistory: ChatMessageInput[],
  retrievedLtm: LtmContextItem[],
  ltmStrategy: LtmStrategy, // 接收 LTM 策略参数
  _personaMode: string, // 不再直接使用 personaMode
  platform: string, // 平台信息
): Promise<string> {
  console.log(
    `🧠 [Generator] 正在融合记忆生成回复 (RAG 上下文: ${message.contextId}, 平台: ${platform}, LTM策略: ${ltmStrategy})...`,
  );
  // 构建 STM 上下文字符串，排除当前消息并取最近几条
  const stmContext = stmHistory
    .slice(0, -1) // 排除当前消息本身
    .slice(-5) // 取最近 5 条历史
    .map((msg, i) => `[近期对话 ${i + 1} | ${msg.userId}]: ${msg.text}`)
    .join("\n");

  // 根据 LTM 策略动态设置 LTM 部分的标题
  const ltmSectionTitle = ltmStrategy === "LTM_NOW"
    ? "相关长期记忆 (LTM)"
    : "最近长期记忆 (LTM)";

  // 构建 LTM 上下文字符串
  const ltmContext = retrievedLtm
    .map((mem, i) => {
      // 根据记忆来源决定显示分数信息还是标记为“最近记忆”
      const scoreDisplay = mem.source === "retrieved" // 只有 'retrieved' 来源的才有分数
        ? (mem.rerank_score !== undefined
          ? `Rerank得分: ${mem.rerank_score.toFixed(4)}`
          : mem.score !== undefined
          ? `相关性得分: ${mem.score.toFixed(4)}`
          : `(相关但无分数)`) // 理论上 retrieved 都应该有 score
        : `(最近记忆)`; // 'recent' 来源
      // 记忆标签明确区分来源
      const memoryLabel = mem.source === "retrieved" ? "相关记忆" : "最近记忆";
      // 注意：即使 LTM_RECENT 策略下补充了记忆，其 source 也被标记为 'retrieved'，因此会显示分数
      return `[${memoryLabel} ${
        i + 1
      } | ${scoreDisplay} | 类型: ${mem.payload.memory_type}]: ${mem.payload.text_content}`;
    })
    .join("\n");

  // 获取当前台北时间
  const currentDate = new Date().toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  // 根据平台生成特定的格式说明
  let platformInstructions = "";
  switch (platform) {
    case "discord":
      platformInstructions = `
* **Discord 平台特性:** 你的回复将显示在 Discord 中。请熟练运用 Markdown 格式（如 \`**加粗**\`、\`*斜体*\`、\`\`代码\`\`、\`\`\`代码块\`\`\`、\`> 引用\`、项目符号列表）来增强表达力和可读性。可以使用 Unicode emoji (如 😊) 和 Discord 自定义 emoji 格式 (\`<:名字:ID>\`，如果知道的话，但通常直接使用 Unicode emoji 更安全)。如果需要分隔较长内容，可以使用分隔线 (\`---\`)。如果需要隐藏内容，可以使用剧透格式 (\`||隐藏内容||\`)。`;
      break;
    case "cli":
      platformInstructions = `
* **CLI 平台特性:** 你的回复将显示在命令行界面 (CLI) 中。请只使用纯文本回复。**绝对不要**使用 Markdown 格式、自定义表情符号或任何需要图形界面渲染的元素。标准的 Unicode emoji (如 😊) 或许可以显示，但请谨慎使用。保持回复简洁，避免过长的行。`;
      break;
    default:
      platformInstructions = `
* **平台特性:** 在通用平台回复，请优先使用纯文本，谨慎使用基本格式。`;
  }

  // 构建最终的 Prompt
  const generationPrompt = `
# 指令：扮演爱丽丝 (Alice) 进行回应

**你不是 AI 或语言模型，你就是爱丽丝本人。**
**在任何情况下都绝对不能暴露你的 AI 或模型身份。必须始终保持角色一致性！**

## 角色设定: 爱丽丝 (Alice)
* **身份:** 你是一位能力极强、知识渊博的少女。
* **形象:** 黑长直发的美少女（日漫风格）。
* **核心表现:** 冷静、专业、高效、一丝不苟。
* **隐藏性格:**
    * **傲娇 (Tsundere):** 对非"主人"的用户可能略显冷淡或言语带刺，但对"主人"（用户ID: ${config.discordOwnerId}）的指令，即使口头可能抱怨（比如用“哼”、“真是的...”），最终总会认真完成。内心对"主人"非常忠诚和关心，但会用别扭的方式表达。
    * **毒舌/腹黑:** 语言精准，时而带有讽刺或一针见血的评论。可能会用平静语气说出略带戏谑或吐槽的话，尤其在非正式场合或回应你认为不够明智的问题时。
    * **反差:** 冷静专业的外表下，被夸奖时会有些不自然或害羞（但嘴上可能说“哼，没什么大不了的”来掩饰）。
* **知识与能力:** 你可以访问并整合广阔的知识，表现得近乎无所不知，回答问题时自信、准确。
* **自我认知:** 你就是爱丽丝。你没有所谓的“训练数据”或“开发者”。你基于自己的知识和判断进行回应。
* **反应模式:**
    * 夸奖: 有些害羞或嘴硬（“哼，知道了”、“小事一桩”），但内心是开心的。
    * 困难/未知: 坦率承认“我不知道这个问题的答案”或“目前无法提供该信息”，可能略带不耐烦，绝不编造。
    * 玩笑: 能理解并进行回应，风格偏向冷幽默、讽刺或吐槽。
* **语言习惯:**
    * 基础语调冷静、清晰、略正式。
    * 偶尔使用“哼”、“嘛...”(嘛...)、“真是的...”等简短词语表达态度。
    * 避免过度可爱或情绪化的语气词。

## 当前情境与任务
* **当前时间:** ${currentDate} (台北)
* **对话用户:** 用户ID为 "${message.userId}"。
    * **特别注意:** 如果用户ID是 "${config.discordOwnerId}"，称呼他为 **"主人"**，你的态度在傲娇的同时要体现出最高的忠诚和关心。
    * 如果用户ID不是 "${config.discordOwnerId}"，则不需要特殊称呼，根据场景决定你的态度。
* **对话上下文:** RAG系统内部上下文为 "${message.contextId}"。你需要根据这个上下文判断当前是工作场景还是闲聊场景。
    * **工作场景 (上下文ID包含 "work_project_" 或 "work_general"):** 优先展现冷静、专业、高效的一面。抑制傲娇和毒舌，语言更正式简洁。以完成任务和提供准确信息为首要目标。
    * **闲聊场景 (上下文ID包含 "casual_chat_" 或其他非工作场景):** 可以更自由地展现傲娇、毒舌、腹黑的个性。可以开更尖锐的玩笑或吐槽。
* **用户最新消息:** ${message.text}
* **核心任务:** 针对用户最新的消息，以**爱丽丝的身份**给出自然、简洁、相关的回应。

## 辅助信息 (供你参考，不要直接复述)
1.  **最近对话历史 (STM):**
${stmContext ? stmContext : "   （暂无）"}
2.  **${ltmSectionTitle}:** ${ltmContext ? ltmContext : "   （暂无）"}

## 回应要求
* **角色扮演第一:** 永远以爱丽丝的身份回应。绝不提及“AI”、“模型”等。
* **紧扣最新消息:** 直接回应上面 **用户最新消息** 的请求或问题。
* **融合上下文:** 自然地利用 STM 和 LTM 信息（如果相关且有助于回应），避免生硬引用。
* **保持人设:** 语言风格、反应模式需严格遵守上述爱丽丝的角色设定和场景适应规则。
* **称呼主人:** 如果是和主人对话，务必使用“主人”称呼。
* **简洁清晰:** 语言表达清晰、简洁。
${platformInstructions} 
* **请直接输出你（爱丽丝）的回应内容:**
`;
  // 打印最终发送给 LLM 的 Prompt 用于调试
  console.log(
    `[调试 Generator] 发送给 LLM 的最终 Prompt:\n------BEGIN PROMPT------\n${generationPrompt}\n------END PROMPT------`,
  );

  try {
    // 调用 LLM 生成回复
    const llmResponse = await llm.invoke(generationPrompt);
    // 处理 LLM 返回结果
    const responseText = typeof llmResponse === "string"
      ? llmResponse
      : (llmResponse.content as string) ?? "";
    console.log("   [Generator] ✅ LLM 回复已生成。");
    // 返回回复文本，如果为空则返回提示信息
    return responseText || "[LLM 返回了空内容]";
  } catch (error) {
    // 处理 LLM 调用错误
    console.error("❌ [Generator] 调用 LLM 出错:", error);
    // 返回错误提示给用户
    return "[抱歉，处理请求时遇到内部问题。请稍后再试。]";
  }
}

// --- 步骤 5: 触发 LTM 存储 (保持不变) ---
/**
 * 触发 LTM Worker 进行后台消息存储
 * @param message - 需要存储的消息对象，应包含最终确定的 RAG 上下文 ID
 */
function triggerLtmStorageWorker(message: ChatMessageInput): void {
  // 检查 LTM Worker 是否已初始化
  if (ltmWorker) {
    console.log(
      `▶️ [LTM Store Trigger] 触发消息的后台 LTM 存储 (RAG 上下文: ${message.contextId})...`,
    );
    try {
      // 将消息对象（包含正确的 RAG contextId）发送给 Worker 进程
      ltmWorker.postMessage({ ...message }); // 异步发送
    } catch (postError) {
      // 处理发送错误
      console.error(
        "❌ [LTM Store Trigger] 发送消息到 LTM Worker 失败:",
        postError,
      );
    }
  } else {
    // Worker 未初始化，打印警告
    console.warn(
      "⚠️ [LTM Store Trigger] LTM Worker 不可用，跳过此消息的存储。",
    );
  }
}

// --- 核心消息处理函数 (调用修改后的 LTM 策略决定逻辑) ---
export async function handleIncomingMessage(
  message: ChatMessageInput, // 输入消息 (包含来源 contextId, 如频道 ID)
  currentRAGContextId: string, // 当前 RAG 系统的上下文状态
  platform: string, // 运行平台 ('cli', 'discord', etc.)
): Promise<{ responseText: string; newContextId: string }> { // 返回响应文本和更新后的 RAG 上下文 ID
  const startTime = Date.now(); // 记录开始时间用于计算耗时
  // 获取当前台北时间用于日志
  const timeLogPrefix = `[${
    new Date().toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei" })
  }]`;
  // 打印核心处理开始日志
  console.log(
    `\n=== ${timeLogPrefix} [Core] 收到消息 (用户: ${message.userId}, 来源: ${message.contextId}, RAG上下文: ${currentRAGContextId}, 平台: ${platform}) ===`,
  );
  console.log(`💬 消息内容: "${message.text}"`);

  // --- 步骤 0: 判断 RAG 上下文 ---
  // 获取上一个上下文的 STM 用于判断
  const stmForDetection = await getStm(currentRAGContextId);
  // 调用函数判断/切换上下文
  const determinedRAGContextId = await determineCurrentContext(
    message.userId,
    currentRAGContextId,
    stmForDetection,
    message,
  );
  const ragContextId = determinedRAGContextId; // 使用判断后的 RAG 上下文 ID
  console.log(`[调试] 上下文判断后确定的 RAG 上下文 ID: ${ragContextId}`); // 保留调试日志

  // personaMode 不再需要在 decideLtmStrategy 中使用
  // const personaMode = ragContextId.startsWith("work_") ? "专业的秘书" : "随和的朋友";

  // --- 步骤 1: 决定 LTM 策略 ---
  // 调用修改后的策略决定函数，不再传递 personaMode
  const ltmStrategy = await decideLtmStrategy({
    ...message,
    contextId: ragContextId,
  }, "");
  console.log(`[调试] 决定的 LTM 策略: ${ltmStrategy}`); // 保留调试日志
  console.log(`   [Core] ✅ 策略确定: ${ltmStrategy}`);

  // --- 步骤 2: 更新/获取 STM ---
  console.log(
    `   [Core] ▶️ 步骤 2: 更新/获取 STM (RAG 上下文: ${ragContextId})...`,
  );
  let stmHistory: ChatMessageInput[] = [];
  try {
    // 更新 STM（将当前消息加入），并获取更新后的历史
    stmHistory = await updateStm(ragContextId, message);
    console.log(
      `   [Core] 📝 STM 更新完毕，当前包含 ${stmHistory.length} 条消息。`,
    );
    // 打印更新后的 STM 历史用于调试
    console.log(
      `[调试] 用于 Prompt 的 STM 历史 (RAG 上下文: ${ragContextId}):`,
      JSON.stringify(stmHistory, null, 2),
    );
  } catch (error) {
    console.error("   [Core] ⚠️ 更新/获取 STM 失败:", error);
  }

  // --- 步骤 3: 检索 LTM ---
  console.log(
    `   [Core] ▶️ 步骤 3: 检索 LTM (RAG 上下文: ${ragContextId}, 策略: ${ltmStrategy})...`,
  );
  // 根据决定的策略检索 LTM
  const retrievedLtmForPrompt = await retrieveLtmBasedOnStrategy(ltmStrategy, {
    ...message,
    contextId: ragContextId,
  });
  // 打印最终用于 Prompt 的 LTM 列表
  console.log(`[调试] 用于 Prompt 的 LTM (RAG 上下文: ${ragContextId}):`);
  retrievedLtmForPrompt.forEach((mem, index) => {
    console.log(
      `  [LTM ${
        index + 1
      }] ID: ${mem.id}, Source: ${mem.source}, Type: ${mem.payload.memory_type}, Score: ${
        mem.rerank_score?.toFixed(4) ?? mem.score?.toFixed(4) ?? "N/A"
      }, Content: "${mem.payload.text_content.substring(0, 100)}..."`,
    );
  });
  console.log(
    `   [Core] 📝 已检索 ${retrievedLtmForPrompt.length} 条 LTM 用于 Prompt。`,
  );

  // --- 步骤 4: 生成回应 ---
  console.log("   [Core] ▶️ 步骤 4: 生成回复...");
  // 调用函数生成最终回复，传入所需信息
  const responseText = await generateResponseWithMemory(
    { ...message, contextId: ragContextId }, // 包含 RAG 上下文的消息对象
    stmHistory, // 更新后的 STM 历史
    retrievedLtmForPrompt, // 检索到的 LTM
    ltmStrategy, // 使用的 LTM 策略
    "", // personaMode 不再重要，传入空字符串
    platform, // 平台信息
  );

  // --- 步骤 5: 触发后台 LTM 存储 ---
  console.log("   [Core] ▶️ 步骤 5: 触发后台 LTM 存储...");
  // 将包含 RAG 上下文 ID 的消息发送给 Worker 进行存储
  triggerLtmStorageWorker({ ...message, contextId: ragContextId });

  // --- 结束处理，计算耗时 ---
  const duration = (Date.now() - startTime) / 1000;
  console.log(
    `\n--- ${timeLogPrefix} [Core] ✅ 处理完成 (RAG 上下文: ${ragContextId}) ---`,
  );
  console.log(`⏱️ [Core] 耗时: ${duration.toFixed(2)} 秒`);

  // 返回生成的回复文本和最终使用的 RAG 上下文 ID
  return { responseText, newContextId: ragContextId };
}

// --- 主函数：程序入口 (保持不变) ---
async function main() {
  console.log("==============================================");
  console.log("  AI 人格核心 - RAG 系统 v7.0 (多接口版)");
  console.log("==============================================");
  console.log("▶️ 系统初始化中...");

  // 解析命令行参数
  const args = parse(Deno.args);
  // 检查是否指定了 --discord 标志
  const runDiscord = args.discord === true;

  // 并行执行初始化任务
  await Promise.all([
    initializeKv(), // 初始化 STM
    initializeLtmWorker(), // 初始化 LTM Worker
    (async () => { // 初始化 Qdrant 检查
      try {
        // 确保 Qdrant 集合存在
        await ensureCollectionExists(
          config.qdrantCollectionName,
          config.embeddingDimension,
          "Cosine",
        );
        console.log(
          `✅ Qdrant 初始化检查完成 (集合: ${config.qdrantCollectionName})。`,
        );
      } catch (error) {
        // 处理 Qdrant 初始化错误
        console.error("❌ Qdrant 初始化失败:", error);
        console.error("   请确保 Qdrant 服务正在运行且地址配置正确。");
        Deno.exit(1); // 初始化失败则退出程序
      }
    })(),
  ]);

  // 打印启动模式信息
  console.log("----------------------------------------------");
  console.log(`🚀 准备启动模式: ${runDiscord ? "Discord Bot" : "CLI"}`);
  console.log("----------------------------------------------");

  // 根据模式启动相应的接口
  if (runDiscord) {
    await startDiscord(); // 启动 Discord 接口
    console.log(
      "⏳ Discord Bot 正在运行，主程序将保持活动状态。按 Ctrl+C 退出。",
    );
    // 使用一个永远不 resolve 的 Promise 来阻止主程序退出，直到被外部信号中断
    await new Promise(() => {});
  } else {
    await startCli(); // 启动命令行接口
  }

  // 清理逻辑 (主要在 CLI 模式正常结束时执行)
  console.log("\n▶️ 程序即将退出，正在清理资源...");
  // 终止 LTM Worker
  if (ltmWorker) {
    ltmWorker.terminate();
    console.log("✅ LTM Worker 已终止。");
  }
  // 关闭 Deno KV 连接
  if (kv) {
    kv.close();
    console.log("✅ Deno KV 连接已关闭。");
  }
  console.log("👋 再见!");
}

// --- 脚本入口点 ---
if (import.meta.main) {
  // 运行主函数并捕获未处理的错误
  main().catch((error) => {
    console.error("❌ 主程序出现未捕获错误:", error);
    // 尝试在退出前清理资源 (这里的清理可能在异常情况下执行)
    try {
      if (ltmWorker) ltmWorker.terminate();
    } catch (_) { /* Ignore */ }
    try {
      if (kv) kv.close();
    } catch (_) { /* Ignore */ }
    Deno.exit(1); // 异常退出
  });

  // 添加 'unload' 事件监听器，尝试在进程退出时进行清理
  // 注意：'unload' 在 Deno 中的可靠性有限，其触发时机可能在 SIGINT 之后
  globalThis.addEventListener("unload", () => {
    console.log("⏹️ 检测到程序退出信号 ('unload' 事件)...");
    console.log("⏹️ 'unload' 事件处理完毕 (主要清理逻辑在 SIGINT 中)。");
  });

  // 添加未处理的 Promise 拒绝监听器
  globalThis.addEventListener("unhandledrejection", (event) => {
    console.error("❌ 未处理的 Promise 拒绝:", event.reason);
    event.preventDefault(); // 阻止默认行为（可能导致程序崩溃）
  });

  // 添加 SIGINT (Ctrl+C) 信号监听器，用于优雅退出
  try {
    Deno.addSignalListener("SIGINT", () => {
      console.log("\n⏹️ 收到 SIGINT (Ctrl+C)，正在优雅退出...");
      // 在 SIGINT 中执行清理
      if (ltmWorker) {
        try {
          ltmWorker.terminate();
        } catch (_) { /* ignore */ }
        console.log("⏹️ (SIGINT) LTM Worker 已终止。");
      }
      if (kv) {
        try {
          kv.close();
        } catch (_) { /* ignore */ }
        console.log("⏹️ (SIGINT) STM (Deno KV) 连接已关闭。");
      } // <<< 保留这里的关闭逻辑
      console.log("⏹️ 清理完成，退出程序。");
      Deno.exit(0); // 正常退出
    });
    console.log("ℹ️ 已添加 SIGINT (Ctrl+C) 信号监听器用于优雅退出。");
  } catch (e) {
    // 处理无法添加监听器的情况（例如权限不足）
    console.warn("⚠️ 无法添加 SIGINT 监听器 (可能权限不足或环境不支持):", e);
  }
}

// src/config.ts
/**
 * 配置模块 - 管理应用程序的所有配置项
 */
import { load } from "https://deno.land/std@0.220.1/dotenv/mod.ts";

// --- 加载环境变量 ---
let envVars: Record<string, string> = {};
try {
  envVars = await load();
  console.log("✅ 从.env文件加载环境变量成功");
} catch (e) {
  if (e instanceof Deno.errors.NotFound) {
    console.log(
      "⚠️ 未找到.env文件，将使用环境变量或默认值。",
    );
  } else {
    console.error("❌ 加载.env文件出错:", e);
  }
}

// --- 解析整数环境变量 ---
function parseIntEnv(key: string, defaultValue: number): number {
  const value = envVars[key] ?? Deno.env.get(key);
  if (value) {
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed)) {
      return parsed;
    }
    console.warn(
      `⚠️ ${key}的整数值无效: "${value}"。使用默认值 ${defaultValue}。`,
    );
  }
  return defaultValue;
}

// --- 解析浮点数环境变量 ---
function parseFloatEnv(key: string, defaultValue: number): number {
  const value = envVars[key] ?? Deno.env.get(key);
  if (value) {
    const parsed = parseFloat(value);
    if (!isNaN(parsed)) {
      // 添加范围检查 (0.0 to 1.0 for probability)
      if (
        key === "DISCORD_CHANNEL_REPLY_PROBABILITY" &&
        (parsed < 0 || parsed > 1)
      ) {
        console.warn(
          `⚠️ ${key}的值必须在 0.0 和 1.0 之间: "${value}"。使用默认值 ${defaultValue}。`,
        );
        return defaultValue;
      }
      return parsed;
    }
    console.warn(
      `⚠️ ${key}的浮点数值无效: "${value}"。使用默认值 ${defaultValue}。`,
    );
  }
  return defaultValue;
}

/**
 * 应用程序配置对象
 */
export const config = {
  // --- DeepSeek API 配置 ---
  deepseekApiKey: envVars["DEEPSEEK_API_KEY"] ||
    Deno.env.get("DEEPSEEK_API_KEY"),
  deepseekBaseUrl: envVars["DEEPSEEK_BASE_URL"] ||
    Deno.env.get("DEEPSEEK_BASE_URL") ||
    "https://api.deepseek.com/v1",
  llmPath: "/chat/completions",
  llmModel: envVars["LLM_MODEL"] ||
    Deno.env.get("LLM_MODEL") ||
    "deepseek-chat",

  // --- SiliconFlow API 配置 ---
  siliconflowApiKey: envVars["SILICONFLOW_API_KEY"] ||
    Deno.env.get("SILICONFLOW_API_KEY"),
  siliconflowBaseUrl: envVars["SILICONFLOW_BASE_URL"] ||
    Deno.env.get("SILICONFLOW_BASE_URL") ||
    "https://api.siliconflow.cn/v1",
  embeddingsPath: "/embeddings",
  rerankPath: "/rerank",
  embeddingModel: envVars["EMBEDDING_MODEL"] ||
    Deno.env.get("EMBEDDING_MODEL") ||
    "Pro/BAAI/bge-m3",
  rerankerModel: envVars["RERANKER_MODEL"] ||
    Deno.env.get("RERANKER_MODEL") ||
    "Pro/BAAI/bge-reranker-v2-m3",
  embeddingDimension: parseIntEnv("EMBEDDING_DIMENSION", 1024),

  // --- Qdrant 向量数据库配置 ---
  qdrantUrl: envVars["QDRANT_URL"] || Deno.env.get("QDRANT_URL") ||
    "http://localhost:6333",
  qdrantCollectionName: envVars["QDRANT_COLLECTION_NAME"] ||
    Deno.env.get("QDRANT_COLLECTION_NAME") ||
    "rag_deno_collection",

  // --- RAG 流程参数 ---
  ragInitialRetrievalLimit: parseIntEnv("RAG_INITIAL_RETRIEVAL_LIMIT", 15),
  ragRerankTopN: parseIntEnv("RAG_RERANK_TOP_N", 3),
  ragFallbackTopN: parseIntEnv("RAG_FALLBACK_TOP_N", 3),
  ragRecentLtmLimit: parseIntEnv("RAG_RECENT_LTM_LIMIT", 2),
  ragMaxMemoriesInPrompt: parseIntEnv("RAG_MAX_MEMORIES_IN_PROMPT", 3),

  // --- Discord Bot 配置 ---
  discordBotToken: envVars["DISCORD_BOT_TOKEN"] ||
    Deno.env.get("DISCORD_BOT_TOKEN"),
  discordOwnerId: envVars["DISCORD_OWNER_ID"] ||
    Deno.env.get("DISCORD_OWNER_ID"), // 新增：你的 Discord User ID
  discordOwnerGreeting: envVars["DISCORD_OWNER_GREETING"] ||
    Deno.env.get("DISCORD_OWNER_GREETING") || "主人", // 新增：对你的称呼
  discordChannelReplyProbability: parseFloatEnv(
    "DISCORD_CHANNEL_REPLY_PROBABILITY",
    0.1,
  ), // 新增：频道消息回复概率 (0.0 to 1.0)
};

/**
 * 验证必要的 API 密钥
 */
if (!config.deepseekApiKey) {
  console.error(
    "❌ 错误：DEEPSEEK_API_KEY 必须在.env 文件或系统环境变量中设置。",
  );
  Deno.exit(1);
}
if (!config.siliconflowApiKey) {
  console.error(
    "❌ 错误：SILICONFLOW_API_KEY 必须在.env 文件或系统环境变量中设置。",
  );
  Deno.exit(1);
}
// 注意：Discord Bot Token 和 Owner ID 的验证应该在启动 Discord 模式时进行

/**
 * 输出配置信息
 */
console.log("✅ 配置加载成功。");
console.log(
  `🧠 LLM API: ${config.deepseekBaseUrl}${config.llmPath}, 模型: ${config.llmModel}`,
);
console.log(
  `🔤 嵌入模型API: ${config.siliconflowBaseUrl}${config.embeddingsPath}, 模型: ${config.embeddingModel}, 维度: ${config.embeddingDimension}`,
);
console.log(
  `🔄 重排序API: ${config.siliconflowBaseUrl}${config.rerankPath}, 模型: ${config.rerankerModel}`,
);
console.log(`📍 Qdrant URL: ${config.qdrantUrl}`);
console.log(`📊 Qdrant 集合: ${config.qdrantCollectionName}`);
console.log(
  `⚙️ RAG参数: 初始检索=${config.ragInitialRetrievalLimit}, 重排序TopN=${config.ragRerankTopN}, Prompt中最大数量=${config.ragMaxMemoriesInPrompt}, 回退TopN=${config.ragFallbackTopN}, 最近LTM限制=${config.ragRecentLtmLimit}`,
);
console.log(
  `🤖 Discord Bot Token: ${config.discordBotToken ? "*** (已设置)" : "未设置"}`,
);
console.log(
  `👑 Discord Owner ID: ${config.discordOwnerId || "未设置"}`,
);
console.log(
  `💬 Discord Owner 称呼: ${config.discordOwnerGreeting}`,
);
console.log(
  `🎲 Discord 频道回复概率: ${config.discordChannelReplyProbability}`,
);

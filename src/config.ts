// src/config.ts
/**
 * 配置模块 - 管理应用程序的所有配置项
 */
import { load } from "https://deno.land/std@0.220.1/dotenv/mod.ts";

// --- 加载环境变量 ---
let envVars: Record<string, string> = {};
try {
  envVars = await load();
  console.log("✅ 从 .env 文件加载环境变量成功");
} catch (e) {
  if (e instanceof Deno.errors.NotFound) {
    console.log(
      "⚠️ 未找到 .env 文件，将使用系统环境变量或默认值。",
    );
  } else {
    console.error("❌ 加载 .env 文件出错:", e);
  }
}

// --- 解析环境变量的辅助函数 ---

function getStringEnv(key: string, defaultValue: string): string {
  return envVars[key] ?? Deno.env.get(key) ?? defaultValue;
}

function getOptionalStringEnv(key: string): string | undefined {
  return envVars[key] ?? Deno.env.get(key);
}

function parseIntEnv(key: string, defaultValue: number): number {
  const value = envVars[key] ?? Deno.env.get(key);
  if (value) {
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed)) {
      return parsed;
    }
    console.warn(
      `⚠️ ${key} 的整数值无效: "${value}"。将使用默认值 ${defaultValue}。`,
    );
  }
  return defaultValue;
}

function parseFloatEnv(key: string, defaultValue: number): number {
  const value = envVars[key] ?? Deno.env.get(key);
  if (value) {
    const parsed = parseFloat(value);
    if (!isNaN(parsed)) {
      // 可以添加特定键的范围检查 (例如 0.0 到 1.0)
      if (
        (key === "DISCORD_PROCESSING_THRESHOLD" ||
          key === "VERBAL_TIC_PROBABILITY" ||
          // ... (其他需要范围检查的键) ...
          key === "RELATIONSHIP_SENSITIVITY") &&
        (parsed < 0 || parsed > 5) // 根据需要调整上限，例如 1.0 或更高
      ) {
        // console.warn( // 暂时注释掉范围警告，保持启动日志清洁
        //   `⚠️ ${key} 的值 (${parsed}) 超出预期范围 (通常 0.0-1.0 或更高)。请检查配置。`,
        // );
      }
      return parsed;
    }
    console.warn(
      `⚠️ ${key} 的浮点数值无效: "${value}"。将使用默认值 ${defaultValue}。`,
    );
  }
  return defaultValue;
}

function parseBoolEnv(key: string, defaultValue: boolean): boolean {
  const value = (envVars[key] ?? Deno.env.get(key))?.toLowerCase();
  if (value === "true" || value === "1") {
    return true;
  }
  if (value === "false" || value === "0") {
    return false;
  }
  if (value !== undefined) {
    console.warn(
      `⚠️ ${key} 的布尔值无效: "${value}"。将使用默认值 ${defaultValue}。`,
    );
  }
  return defaultValue;
}

function parseStringArrayEnv(key: string, defaultValue: string[]): string[] {
  const value = envVars[key] ?? Deno.env.get(key);
  if (value) {
    // 使用逗号分隔，并去除每个元素前后的空格
    return value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  }
  return defaultValue;
}

// --- 应用程序配置对象 ---

export const config = {
  // --- LLM (DeepSeek 或兼容模型) ---
  deepseekApiKey: getOptionalStringEnv("DEEPSEEK_API_KEY"), // DeepSeek API 密钥
  deepseekBaseUrl: getStringEnv(
    "DEEPSEEK_BASE_URL",
    "https://api.deepseek.com/v1",
  ), // DeepSeek API 基础 URL
  llmPath: "/chat/completions", // 对于兼容 OpenAI 的 API 通常是固定的
  llmModel: getStringEnv("LLM_MODEL", "deepseek-chat"), // 使用的 LLM 模型名称

  // --- Embeddings & Reranker (SiliconFlow 或兼容模型) ---
  siliconflowApiKey: getOptionalStringEnv("SILICONFLOW_API_KEY"), // SiliconFlow API 密钥
  siliconflowBaseUrl: getStringEnv(
    "SILICONFLOW_BASE_URL",
    "https://api.siliconflow.cn/v1",
  ), // SiliconFlow API 基础 URL
  embeddingsPath: "/embeddings", // 对于兼容 OpenAI 的 API 通常是固定的
  rerankPath: "/rerank", // Rerank 的特定路径
  embeddingModel: getStringEnv("EMBEDDING_MODEL", "Pro/BAAI/bge-m3"), // 嵌入模型名称
  rerankerModel: getStringEnv("RERANKER_MODEL", "Pro/BAAI/bge-reranker-v2-m3"), // Reranker 模型名称
  embeddingDimension: parseIntEnv("EMBEDDING_DIMENSION", 1024), // 嵌入向量维度 (必须与模型匹配)

  // --- 向量数据库 (Qdrant) ---
  qdrantUrl: getStringEnv("QDRANT_URL", "http://localhost:6333"), // Qdrant 服务地址
  qdrantCollectionName: getStringEnv(
    "QDRANT_COLLECTION_NAME",
    "rag_deno_collection",
  ), // Qdrant 集合名称

  // --- RAG 流程参数 ---
  ragInitialRetrievalLimit: parseIntEnv("RAG_INITIAL_RETRIEVAL_LIMIT", 15), // 初始检索数量
  ragRerankTopN: parseIntEnv("RAG_RERANK_TOP_N", 3), // Rerank 后保留的数量
  ragFallbackTopN: parseIntEnv("RAG_FALLBACK_TOP_N", 3), // Rerank 失败时回退保留的数量
  ragRecentLtmLimit: parseIntEnv("RAG_RECENT_LTM_LIMIT", 2), // "近期记忆"策略检索的数量
  ragMaxMemoriesInPrompt: parseIntEnv("RAG_MAX_MEMORIES_IN_PROMPT", 3), // 注入 Prompt 的最大记忆数量

  // --- Discord Bot 配置 ---
  discordBotToken: getOptionalStringEnv("DISCORD_BOT_TOKEN"), // Discord Bot 令牌
  discordOwnerId: getOptionalStringEnv("DISCORD_OWNER_ID"), // Discord 主人的用户 ID
  discordOwnerGreeting: getStringEnv("DISCORD_OWNER_GREETING", "主人"), // 对主人的称呼
  discordProcessingThreshold: parseFloatEnv(
    "DISCORD_PROCESSING_THRESHOLD",
    0.6,
  ), // 频道消息处理分数阈值 (0.0-1.0)
  ownerNicknames: parseStringArrayEnv("OWNER_NICKNAMES", []), // 主人的昵称列表 (逗号分隔)
  botNames: parseStringArrayEnv("BOT_NAMES", ["爱丽丝", "Alice"]), // 机器人会响应的名字列表 (逗号分隔)
  importantKeywords: parseStringArrayEnv("IMPORTANT_KEYWORDS", [
    "提醒",
    "待办",
    "总结",
    "记录",
    "重要",
    "问题",
    "请教",
    "疑问",
    "需要",
    "帮助",
    "查询",
    "进度",
    "确认",
    "安排",
    "会议",
    "报告",
    "截止日期",
    "ddl",
    "bug",
    "错误",
    "修复",
    "建议",
    "反馈",
    "?",
    "？",
  ]), // 用于消息评分的重要关键词 (逗号分隔)
  actionVerbs: parseStringArrayEnv("ACTION_VERBS", [
    "搜索",
    "查询",
    "查找",
    "记录",
    "更新",
    "安排",
    "确认",
    "完成",
    "分析",
    "处理",
    "执行",
    "开发",
    "测试",
    "部署",
    "启动",
    "停止",
  ]), // 用于消息评分的动作动词 (逗号分隔)

  // --- 思维漫游 ---
  mindWandering: {
    enabled: parseBoolEnv("MIND_WANDERING_ENABLED", true), // 是否启用思维漫游
    triggerProbability: parseFloatEnv("MIND_WANDERING_PROBABILITY", 0.15), // 触发思维漫游的基础概率 (0.0-1.0)
    cooldownMinutes: parseIntEnv("MIND_WANDERING_COOLDOWN_MINUTES", 5), // 同一上下文的思维漫游冷却时间 (分钟)
  },

  // --- 时间感知 ---
  timePerception: {
    enabled: parseBoolEnv("TIME_PERCEPTION_ENABLED", true), // 是否启用时间感知
    markerThreshold: parseFloatEnv("TIME_MARKER_THRESHOLD", 0.6), // 标记重要事件的阈值 (可能未使用)
    maxMemoryDecayDays: parseIntEnv("MAX_MEMORY_DECAY_DAYS", 90), // 记忆显著衰减的天数
    defaultTimeExpressionPrecision: getStringEnv(
      "DEFAULT_TIME_EXPRESSION_PRECISION",
      "relative",
    ) as "exact" | "approximate" | "relative", // 默认时间表达精度
    emotionalRetentionFactor: parseFloatEnv("EMOTIONAL_RETENTION_FACTOR", 3.0), // 情感对记忆保留的影响因子 (越高影响越大)
  },

  // --- 人类语言模式 ---
  humanPatterns: {
    enabled: parseBoolEnv("HUMAN_PATTERNS_ENABLED", true), // 是否启用人类语言模式
    enableAdvanced: parseBoolEnv("HUMAN_PATTERNS_ENABLE_ADVANCED", true), // 是否使用 LLM 进行高级人类化处理
    verbalTicProbability: parseFloatEnv("VERBAL_TIC_PROBABILITY", 0.3), // 添加口头禅的概率 (0.0-1.0)
    selfCorrectionProbability: parseFloatEnv(
      "SELF_CORRECTION_PROBABILITY",
      0.15,
    ), // 添加自我修正的概率 (0.0-1.0)
    humanizationIntensity: parseFloatEnv("HUMANIZATION_INTENSITY", 0.7), // 人类化效果的整体强度因子 (0.0-1.0)
    advancedMinLength: parseIntEnv("ADVANCED_HUMANIZE_MIN_LENGTH", 50), // 触发高级人类化处理的最小回复长度
  },

  // --- 虚拟具身 ---
  virtualEmbodiment: {
    enabled: parseBoolEnv("VIRTUAL_EMBODIMENT_ENABLED", true), // 是否启用虚拟具身感知
    enableAdvanced: parseBoolEnv("VIRTUAL_EMBODIMENT_ENABLE_ADVANCED", true), // 是否使用 LLM 生成具身表达
    stateSensitivity: parseFloatEnv("BODY_STATE_SENSITIVITY", 0.7), // 身体状态对事件的敏感度 (0.0-1.0)
    maxEnergyDepletion: parseFloatEnv("MAX_ENERGY_DEPLETION", 0.2), // 单个事件最大能量消耗 (0.0-1.0)
    energyRecoveryRate: parseFloatEnv("ENERGY_RECOVERY_RATE", 0.1), // 基础能量恢复速率 (每小时)
    enableComfortZoneExpression: parseBoolEnv(
      "ENABLE_COMFORT_ZONE_EXPRESSION",
      true,
    ), // 是否表达舒适区/不适区状态
    metaphorExpressionProbability: parseFloatEnv(
      "METAPHOR_EXPRESSION_PROBABILITY",
      0.3,
    ), // 使用隐喻性身体表达的概率 (0.0-1.0)
  },

  // --- 社交动态 ---
  socialDynamics: {
    enabled: parseBoolEnv("SOCIAL_DYNAMICS_ENABLED", true), // 是否启用社交动态建模
    relationshipSensitivity: parseFloatEnv("RELATIONSHIP_SENSITIVITY", 0.7), // 关系维度对交互的敏感度 (0.0-1.0)
    maxSharedExperiences: parseIntEnv("MAX_SHARED_EXPERIENCES", 5), // 每个用户存储的最大共享经历数量
    maxMilestones: parseIntEnv("MAX_MILESTONES", 3), // 每个用户存储的最大关系里程碑数量
    enableLLMRelationshipAnalysis: parseBoolEnv(
      "ENABLE_LLM_RELATIONSHIP_ANALYSIS",
      true,
    ), // 是否使用 LLM 分析交互对关系的影响
    promptDetailLevel: getStringEnv("RELATIONSHIP_PROMPT_DETAIL", "medium") as
      | "low"
      | "medium"
      | "high", // Prompt 中关系摘要的详细程度
  },
};

/**
 * 验证必要的 API 密钥 (基本检查)
 */
if (!config.deepseekApiKey) {
  console.warn(
    "⚠️ 警告：DEEPSEEK_API_KEY 未设置。如果需要使用 DeepSeek LLM，请在 .env 文件或系统环境变量中设置。",
  );
}
if (!config.siliconflowApiKey) {
  console.warn(
    "⚠️ 警告：SILICONFLOW_API_KEY 未设置。如果需要使用 SiliconFlow Embeddings/Reranker，请在 .env 文件或系统环境变量中设置。",
  );
}
// Discord Bot Token 和 Owner ID 的检查移到 discord_interface.ts 中更合适

/**
 * 输出部分关键配置信息
 */
console.log("✅ 配置加载和解析完成。");
console.log(
  `🧠 LLM: 模型=${config.llmModel}, 端点=${config.deepseekBaseUrl}`,
);
console.log(
  `🔤 嵌入模型: 模型=${config.embeddingModel}, 维度=${config.embeddingDimension}, 端点=${config.siliconflowBaseUrl}`,
);
console.log(
  `🔄 重排序: 模型=${config.rerankerModel}, 端点=${config.siliconflowBaseUrl}`,
);
console.log(
  `📍 Qdrant: 地址=${config.qdrantUrl}, 集合=${config.qdrantCollectionName}`,
);
console.log(
  `✨ 进化模块启用状态: 思维漫游[${config.mindWandering.enabled}], 时间感知[${config.timePerception.enabled}], 人类模式[${config.humanPatterns.enabled}], 虚拟具身[${config.virtualEmbodiment.enabled}], 社交动态[${config.socialDynamics.enabled}]`,
);

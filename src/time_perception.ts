// src/time_perception.ts

/**
 * 主观时间感知模块 - 使爱丽丝能够像人类一样感知时间的流动
 *
 * 实现特性：
 * 1. 情感加权的时间感知：快乐时光飞逝，痛苦时刻漫长
 * 2. 上下文相关的时间表达：适当使用"刚才"、"昨天"、"很久以前"等表述
 * 3. 记忆衰减与突显：模拟人类记忆的自然衰减与情感加强
 * 4. 时间标记与里程碑：识别重要事件作为时间参照点
 */

import { config } from "./config.ts";
import {
  type MemoryPayload,
  type MemoryPointStruct, // 如果需要直接操作Point，否则可能不需要
  // qdrantClient, // 此模块通常不直接操作qdrant，除非要存储时间标记为记忆点
  type Schemas, // 如果需要Qdrant类型
} from "./qdrant_client.ts";
import { llm } from "./llm.ts"; // 用于检测重要消息

/**
 * 时间表达单位
 */
export enum TimeUnit {
  Second = "second",
  Minute = "minute",
  Hour = "hour",
  Day = "day",
  Week = "week",
  Month = "month",
  Year = "year",
}

/**
 * 时间单位的中文表示
 */
const TIME_UNIT_LABELS: Record<TimeUnit, string> = {
  [TimeUnit.Second]: "秒",
  [TimeUnit.Minute]: "分钟",
  [TimeUnit.Hour]: "小时",
  [TimeUnit.Day]: "天",
  [TimeUnit.Week]: "周",
  [TimeUnit.Month]: "个月",
  [TimeUnit.Year]: "年",
};

/**
 * 时间标记事件，用作记忆中的参照点
 */
export interface TimeMarker {
  id: string;
  timestamp: number;
  description: string;
  context_id: string;
  emotional_significance: number; // 0.0-1.0
  is_milestone: boolean;
}

/**
 * 上下文时间状态 (存储在 Deno KV 中)
 */
export interface TemporalContext {
  user_id: string;
  context_id: string;
  interaction_history: Array<{ // 最近交互的时间戳
    timestamp: number;
  }>;
  time_markers: TimeMarker[]; // 时间标记列表
  perceived_pace: number; // 0.0-2.0，<1 慢，>1 快，1为正常
  last_interaction?: number; // 上次交互时间戳
}

// KV存储键前缀
const TEMPORAL_CONTEXT_PREFIX = "temporal_context";

/**
 * 计算客观时间差（毫秒）
 * @param timestamp1 较早的时间戳
 * @param timestamp2 较晚的时间戳
 * @returns 时间差（毫秒）
 */
function calculateTimeDifference(
  timestamp1: number,
  timestamp2: number,
): number {
  return Math.abs(timestamp2 - timestamp1);
}

/**
 * 将毫秒时间差转换为最适合的时间单位和数值
 * @param milliseconds 毫秒时间差
 * @returns 适合的时间单位和数值
 */
function convertToAppropriateUnit(
  milliseconds: number,
): { value: number; unit: TimeUnit } {
  const seconds = milliseconds / 1000;

  if (seconds < 60) {
    return { value: Math.round(seconds), unit: TimeUnit.Second };
  } else if (seconds < 3600) { // 1 hour
    return { value: Math.round(seconds / 60), unit: TimeUnit.Minute };
  } else if (seconds < 86400) { // 1 day
    return { value: Math.round(seconds / 3600), unit: TimeUnit.Hour };
  } else if (seconds < 604800) { // 1 week
    return { value: Math.round(seconds / 86400), unit: TimeUnit.Day };
  } else if (seconds < 2592000) { // 1 month (approx 30 days)
    return { value: Math.round(seconds / 604800), unit: TimeUnit.Week };
  } else if (seconds < 31536000) { // 1 year
    return { value: Math.round(seconds / 2592000), unit: TimeUnit.Month };
  } else {
    return { value: Math.round(seconds / 31536000), unit: TimeUnit.Year };
  }
}

/**
 * 应用情感加权调整时间感知
 * @param timeDiff 客观时间差（毫秒）
 * @param emotionalFactors 情感因素对象
 * @returns 主观感知的时间差（毫秒）
 */
function applyEmotionalWeighting(
  timeDiff: number,
  emotionalFactors: {
    valence: number; // -1.0到1.0，负面到正面
    arousal: number; // 0.0到1.0，平静到激动
    significance: number; // 0.0到1.0，重要性
    engagementLevel: number; // 0.0到1.0，投入程度 (例如，根据对话节奏判断)
  },
): number {
  // 确保 timeDiff 非负
  timeDiff = Math.max(0, timeDiff);

  // 基础时间感知因子
  // 正面情绪让时间变快（感知变短），负面情绪让时间变慢（感知变长）
  // 调整因子范围，避免过大或过小
  const valenceFactor = 1 - (emotionalFactors.valence * 0.4); // Range 0.6 to 1.4

  // 高唤醒度（激动）让时间感知更极端（更快或更慢，取决于效价），平静时更接近客观时间
  // 调整因子，使得效价的影响在高唤醒时更显著
  const arousalModifier = 1 +
    (emotionalFactors.arousal * 0.5 * Math.abs(emotionalFactors.valence)); // Range 1.0 to 1.25 (approx)

  // 重要事件感知时间更长（更容易记住细节），但这里我们模拟主观感受，重要事件可能感觉"一瞬间"或"永恒"
  // 简化：高重要性使得时间感受更强烈（受效价影响更大）
  const significanceFactor = 1 + (emotionalFactors.significance * 0.3); // Range 1.0 to 1.3

  // 投入程度高时时间感知更快（时间飞逝）
  const engagementFactor = 1 - (emotionalFactors.engagementLevel * 0.5); // Range 0.5 to 1.0

  // 结合所有因素，计算最终的时间感知调整倍率
  // 调整组合方式，使其更符合直觉
  // 主观时间 = 客观时间 * 投入度因子 * (基础效价因子 ^ 唤醒度修正) * 重要性因子
  let combinedFactor = engagementFactor *
    Math.pow(valenceFactor, arousalModifier) * significanceFactor;

  // 限制调整因子的范围，防止极端值
  combinedFactor = Math.max(0.2, Math.min(5.0, combinedFactor));

  // 应用调整倍率到实际时间差
  return timeDiff * combinedFactor;
}

/**
 * 生成描述时间感知的自然语言表达
 * @param timeDiff 时间差（毫秒）
 * @param subjectiveTimeDiff 主观时间差（毫秒）
 * @param precision 描述精度
 * @returns 自然语言时间表达
 */
export function generateTimeExpression(
  timeDiff: number,
  subjectiveTimeDiff: number = timeDiff,
  precision: "exact" | "approximate" | "relative" =
    config.timePerception.defaultTimeExpressionPrecision || "relative",
): string {
  // 确保非负
  timeDiff = Math.max(0, timeDiff);
  subjectiveTimeDiff = Math.max(0, subjectiveTimeDiff);

  // 将主观时间转换为适当单位
  const subjectiveUnits = convertToAppropriateUnit(subjectiveTimeDiff);

  // 根据精度和时间单位生成不同表达
  switch (precision) {
    case "exact":
      // 精确时间表达，如"3小时42分钟前"
      return generateExactTimeExpression(timeDiff);

    case "approximate":
      // 近似时间表达，如"大约3小时前"
      if (subjectiveUnits.value <= 0) return "刚刚"; // 处理0值
      return `大约${subjectiveUnits.value}${
        TIME_UNIT_LABELS[subjectiveUnits.unit]
      }前`;

    case "relative":
      // 相对时间表达，如"刚才"、"昨天"、"上周"
      return generateRelativeTimeExpression(timeDiff, subjectiveTimeDiff);

    default:
      if (subjectiveUnits.value <= 0) return "刚刚";
      return `${subjectiveUnits.value}${
        TIME_UNIT_LABELS[subjectiveUnits.unit]
      }前`;
  }
}

/**
 * 生成精确的时间表达
 * @param timeDiff 时间差（毫秒）
 * @returns 精确的时间表达
 */
function generateExactTimeExpression(timeDiff: number): string {
  const seconds = Math.floor(timeDiff / 1000) % 60;
  const minutes = Math.floor(timeDiff / (1000 * 60)) % 60;
  const hours = Math.floor(timeDiff / (1000 * 60 * 60)) % 24;
  const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));

  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days}天`);
  }
  if (hours > 0) {
    parts.push(`${hours}小时`);
  }
  if (minutes > 0 && days === 0) { // 只在没有天数时显示分钟
    parts.push(`${minutes}分钟`);
  }
  if (seconds > 0 && days === 0 && hours === 0 && minutes < 5) { // 只在短时间内显示秒
    parts.push(`${seconds}秒`);
  }

  if (parts.length === 0) {
    return "刚刚";
  }

  return parts.join("") + "前";
}

/**
 * 生成相对的时间表达
 * @param timeDiff 客观时间差（毫秒）
 * @param subjectiveTimeDiff 主观时间差（毫秒）
 * @returns 相对的时间表达
 */
function generateRelativeTimeExpression(
  timeDiff: number,
  subjectiveTimeDiff: number,
): string {
  // 主要依据客观时间差来决定大的时间范畴（如天、周、月）
  // 但在较小时间尺度上（分钟、小时）或边缘情况，考虑主观感受

  const seconds = timeDiff / 1000;
  const subjectiveSeconds = subjectiveTimeDiff / 1000;

  // 短时间内的表达
  if (subjectiveSeconds < 10) return "刚刚";
  if (subjectiveSeconds < 60) return "刚才"; // 主观感觉在1分钟内
  if (subjectiveSeconds < 300) return "几分钟前"; // 主观感觉在5分钟内

  // 中等时间（考虑主观和客观）
  if (seconds < 3600) { // 客观1小时内
    const minutes = Math.round(subjectiveSeconds / 60);
    if (minutes <= 1) return "刚才";
    return `${minutes}分钟前`; // 使用主观分钟数
  }
  if (seconds < 7200) { // 客观2小时内
    // 如果主观感觉很短，可能还是说“几分钟前”
    if (subjectiveSeconds < 600) return "几分钟前";
    return "一个多小时前";
  }
  if (seconds < 86400) { // 客观24小时内
    const hours = Math.round(subjectiveSeconds / 3600);
    if (hours <= 1) return "一个多小时前";
    return `${hours}小时前`; // 使用主观小时数
  }

  // 长时间（主要基于客观时间）
  if (seconds < 172800) return "昨天"; // 48小时内
  if (seconds < 259200) return "前天"; // 72小时内
  if (seconds < 604800) { // 1周内
    const days = Math.round(seconds / 86400);
    return `${days}天前`;
  }
  if (seconds < 1209600) return "上周"; // 2周内
  if (seconds < 2592000) { // 1个月内
    const weeks = Math.round(seconds / 604800);
    return `${weeks}周前`;
  }
  if (seconds < 5184000) return "上个月"; // 2个月内
  if (seconds < 31536000) { // 1年内
    const months = Math.round(seconds / 2592000);
    return `${months}个月前`;
  }
  if (seconds < 63072000) return "去年"; // 2年内
  else {
    const years = Math.round(seconds / 31536000);
    return `${years}年前`;
  }
}

/**
 * 从KV存储中获取时间上下文
 * @param userId 用户ID
 * @param contextId 上下文ID
 * @param kv KV存储实例
 * @returns 时间上下文对象 或 null
 */
export async function getTemporalContext(
  userId: string,
  contextId: string,
  kv: Deno.Kv | null,
): Promise<TemporalContext | null> {
  if (!kv) {
    console.warn("[TimePcpt] KV store is not available.");
    return null;
  }

  const key = [TEMPORAL_CONTEXT_PREFIX, userId, contextId];

  try {
    const result = await kv.get<TemporalContext>(key);
    // 校验获取的数据结构是否符合预期
    if (
      result.value && typeof result.value === "object" &&
      result.value.user_id && result.value.context_id
    ) {
      return result.value;
    } else if (result.value) {
      console.warn(
        `[TimePcpt] Invalid temporal context structure found for key: ${key}. Returning null.`,
      );
      return null;
    }
    return null; // Key not found
  } catch (error) {
    console.error(`❌ [TimePcpt] 获取时间上下文时出错 (Key: ${key}):`, error);
    return null;
  }
}

/**
 * 更新时间上下文到KV存储
 * @param context 时间上下文对象
 * @param kv KV存储实例
 */
export async function updateTemporalContext(
  context: TemporalContext,
  kv: Deno.Kv | null,
): Promise<void> {
  if (!kv) {
    console.warn(
      "[TimePcpt] KV store is not available. Cannot update temporal context.",
    );
    return;
  }
  if (!context || !context.user_id || !context.context_id) {
    console.error("❌ [TimePcpt] Invalid context object provided for update.");
    return;
  }

  const key = [TEMPORAL_CONTEXT_PREFIX, context.user_id, context.context_id];

  try {
    // 添加当前交互记录
    context.last_interaction = Date.now();

    // 保持历史记录在合理大小
    const maxHistory = 50; // 减少存储量
    if (context.interaction_history.length > maxHistory) {
      context.interaction_history = context.interaction_history.slice(
        -maxHistory,
      );
    }

    // 保持时间标记在合理大小
    const maxMarkers = 15; // 减少存储量
    if (context.time_markers.length > maxMarkers) {
      // 按情感重要性排序，保留里程碑和重要的标记
      context.time_markers.sort((a, b) => {
        // 里程碑优先
        if (a.is_milestone && !b.is_milestone) return -1;
        if (!a.is_milestone && b.is_milestone) return 1;
        // 然后按情感重要性降序
        return b.emotional_significance - a.emotional_significance;
        // 如果重要性相同，按时间戳降序（保留最新的）
        // return b.timestamp - a.timestamp;
      });

      // 保留前 maxMarkers 个
      context.time_markers = context.time_markers.slice(0, maxMarkers);
    }

    // 验证并清理 context 对象，移除 undefined 或 null 值
    const cleanedContext = JSON.parse(JSON.stringify(context));

    await kv.set(key, cleanedContext);
  } catch (error) {
    console.error(`❌ [TimePcpt] 更新时间上下文时出错 (Key: ${key}):`, error);
  }
}

/**
 * 创建新的时间上下文
 * @param userId 用户ID
 * @param contextId 上下文ID
 * @returns 新的时间上下文对象
 */
export function createTemporalContext(
  userId: string,
  contextId: string,
): TemporalContext {
  return {
    user_id: userId,
    context_id: contextId,
    interaction_history: [{
      timestamp: Date.now(),
    }],
    time_markers: [],
    perceived_pace: 1.0, // 初始感知速度为正常
    last_interaction: Date.now(),
  };
}

/**
 * 记录新的交互 (简化，仅更新时间戳)
 * @param userId 用户ID
 * @param contextId 上下文ID
 * @param kv KV存储实例
 */
export async function recordInteractionTimestamp(
  userId: string,
  contextId: string,
  kv: Deno.Kv | null,
): Promise<void> {
  if (!kv) return;
  let context = await getTemporalContext(userId, contextId, kv);

  if (!context) {
    context = createTemporalContext(userId, contextId);
  } else {
    context.interaction_history.push({ timestamp: Date.now() });
    // 清理旧记录
    if (context.interaction_history.length > 50) {
      context.interaction_history = context.interaction_history.slice(-50);
    }
    context.last_interaction = Date.now();
  }

  await updateTemporalContext(context, kv);
}

/**
 * 计算主观时间感知
 * @param userId 用户ID
 * @param contextId 上下文ID
 * @param referenceTimestamp 参考时间戳
 * @param emotionalFactors 情感因素
 * @param kv KV存储实例
 * @returns 主观时间表达结果对象
 */
export async function calculateSubjectiveTimeElapsed(
  userId: string,
  contextId: string,
  referenceTimestamp: number,
  emotionalFactors: {
    valence: number;
    arousal: number;
    significance: number;
    engagementLevel: number;
  },
  kv: Deno.Kv | null,
): Promise<{
  expression: string;
  objective_ms: number;
  subjective_ms: number;
}> {
  const now = Date.now();
  const timeDiff = calculateTimeDifference(referenceTimestamp, now);

  // 获取上下文，如果失败则使用默认客观时间
  const context = await getTemporalContext(userId, contextId, kv);
  const perceivedPace = context?.perceived_pace ?? 1.0;

  // 应用情感加权
  const subjectiveTimeDiff = applyEmotionalWeighting(timeDiff, {
    ...emotionalFactors,
    // 结合上下文的感知速度，调整投入度
    // 感知速度快(>1) -> 投入度高; 感知速度慢(<1) -> 投入度低
    engagementLevel: Math.max(
      0,
      Math.min(1, emotionalFactors.engagementLevel + (perceivedPace - 1) * 0.5),
    ),
  });

  // 生成时间表达
  const timeExpression = generateTimeExpression(timeDiff, subjectiveTimeDiff);

  return {
    expression: timeExpression,
    objective_ms: timeDiff,
    subjective_ms: subjectiveTimeDiff,
  };
}

/**
 * 添加时间标记（记忆里程碑）
 * @param userId 用户ID
 * @param contextId 上下文ID
 * @param description 描述
 * @param emotionalSignificance 情感重要性
 * @param isMilestone 是否是里程碑
 * @param kv KV存储实例
 */
export async function addTimeMarker(
  userId: string,
  contextId: string,
  description: string,
  emotionalSignificance: number = 0.5,
  isMilestone: boolean = false,
  kv: Deno.Kv | null,
): Promise<void> {
  if (!kv) return;

  // 获取现有上下文或创建新的
  let context = await getTemporalContext(userId, contextId, kv);

  if (!context) {
    context = createTemporalContext(userId, contextId);
  }

  // 创建新的时间标记
  const timeMarker: TimeMarker = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    description: description.substring(0, 100), // 限制描述长度
    context_id: contextId,
    emotional_significance: Math.max(0, Math.min(1, emotionalSignificance)), // 确保范围
    is_milestone: isMilestone,
  };

  // 添加到上下文
  context.time_markers.push(timeMarker);

  // 更新上下文 (updateTemporalContext内部会处理排序和裁剪)
  await updateTemporalContext(context, kv);
}

/**
 * 查找相关的时间标记用作参照
 * @param userId 用户ID
 * @param contextId 上下文ID
 * @param messageText 消息文本 (用于相关性判断)
 * @param kv KV存储实例
 * @returns 相关的时间标记数组 (最多返回3个)
 */
export async function findRelevantTimeMarkers(
  userId: string,
  contextId: string,
  messageText: string,
  kv: Deno.Kv | null,
): Promise<TimeMarker[]> {
  if (!kv) return [];

  // 获取上下文
  const context = await getTemporalContext(userId, contextId, kv);

  if (!context || context.time_markers.length === 0) {
    return [];
  }

  // 分析消息与时间标记的相关性
  // TODO: 集成更复杂的NLP或嵌入相似度计算
  // 简化版本：关键词匹配 + 时间接近度
  const relevantMarkers = context.time_markers
    .map((marker) => {
      // 计算相关性分数 (简化)
      const keywords = marker.description.toLowerCase().split(/\s+/).filter(
        (k) => k.length > 1,
      );
      let relevanceScore = 0;
      keywords.forEach((kw) => {
        if (messageText.toLowerCase().includes(kw)) {
          relevanceScore += 1;
        }
      });
      // 时间越近，相关性越高
      const timeFactor = 1 /
        (1 + (Date.now() - marker.timestamp) / (1000 * 60 * 60 * 24 * 7)); // 衰减因子，一周内影响较大
      relevanceScore *= 1 + timeFactor;
      // 里程碑和高重要性标记加分
      if (marker.is_milestone) relevanceScore *= 1.5;
      relevanceScore += marker.emotional_significance;

      return { marker, relevanceScore };
    })
    .filter((item) => item.relevanceScore > 0.5) // 过滤掉相关性过低的
    .sort((a, b) => b.relevanceScore - a.relevanceScore) // 按相关性排序
    .slice(0, 3) // 最多返回3个
    .map((item) => item.marker);

  return relevantMarkers;
}

/**
 * 分析用户对话节奏，更新感知速度
 * @param userId 用户ID
 * @param contextId 上下文ID
 * @param messageText 当前消息文本 (用于判断复杂度)
 * @param kv KV存储实例
 * @returns 更新后的感知速度
 */
export async function analyzeConversationPace(
  userId: string,
  contextId: string,
  messageText: string,
  kv: Deno.Kv | null,
): Promise<number> {
  if (!kv) return 1.0; // 无法访问KV时返回默认值

  let context = await getTemporalContext(userId, contextId, kv);

  if (!context) {
    context = createTemporalContext(userId, contextId);
    // 如果是新创建的上下文，直接返回默认速度
    return context.perceived_pace;
  }

  let paceFactor = 1.0; // 默认速度因子

  // 分析历史交互间隔 (需要至少3次交互才有意义)
  if (context.interaction_history.length >= 3) {
    const recentInteractions = context.interaction_history.slice(-3); // 取最近3次交互时间戳
    const intervals = [];

    for (let i = 1; i < recentInteractions.length; i++) {
      intervals.push(
        recentInteractions[i].timestamp - recentInteractions[i - 1].timestamp,
      );
    }

    if (intervals.length > 0) {
      // 计算平均间隔 (毫秒)
      const avgInterval = intervals.reduce((sum, interval) =>
        sum + interval, 0) / intervals.length;

      // 分析消息长度
      const messageLength = messageText.length;

      // 根据间隔和长度调整速度因子
      // 短间隔、短消息 = 更快的感知
      if (avgInterval < 30000 && messageLength < 50) { // 30秒内，短消息
        paceFactor = 1.3; // 加速感知 30%
      } // 长间隔、长消息 = 更慢的感知
      else if (avgInterval > 300000 || messageLength > 200) { // 5分钟以上间隔 或 长消息
        paceFactor = 0.7; // 减速感知 30%
      } // 可以添加更多中间状态的调整
      else if (avgInterval < 60000) { // 1分钟内
        paceFactor = 1.1;
      } else if (avgInterval > 180000) { // 3分钟以上
        paceFactor = 0.9;
      }
    }
  }

  // 平滑更新感知速度（例如：70%旧值，30%新值）
  // 限制感知速度在合理范围 [0.5, 1.5]
  const newPerceivedPace = Math.max(
    0.5,
    Math.min(1.5, context.perceived_pace * 0.7 + paceFactor * 0.3),
  );

  // 如果速度变化显著，则更新KV中的状态
  if (Math.abs(newPerceivedPace - context.perceived_pace) > 0.01) {
    context.perceived_pace = newPerceivedPace;
    await updateTemporalContext(context, kv);
  }

  return newPerceivedPace;
}

/**
 * 根据时间距离计算记忆衰减因子
 * @param timestamp 记忆时间戳
 * @param referenceTime 参考时间（默认为当前时间）
 * @param emotionalSignificance 情感重要性（0-1），影响衰减速度
 * @returns 衰减因子（0-1，越接近1表示记忆越清晰）
 */
function calculateMemoryDecay(
  timestamp: number,
  referenceTime: number = Date.now(),
  emotionalSignificance: number = 0.5, // 默认中等重要性
): number {
  // 使用配置中的最大衰减天数
  const maxDecayDays = config.timePerception.maxMemoryDecayDays || 90;
  if (maxDecayDays <= 0) return 1.0; // 如果配置为0或负数，则不衰减

  // 计算时间差（天）
  const daysDifference = (referenceTime - timestamp) / (1000 * 60 * 60 * 24);
  if (daysDifference < 0) return 1.0; // 未来时间戳不衰减

  // 基于埃宾浩斯遗忘曲线的衰减函数: R = e^(-t/S)
  // S 是记忆强度/稳定性因子，受情感重要性和配置影响
  // 基础稳定性因子，随情感重要性增加 (范围大致在 5 到 50+ 之间)
  const baseStability = 5 + emotionalSignificance * 45;
  // 应用全局保留因子
  const stabilityFactor = baseStability *
    (config.timePerception.emotionalRetentionFactor || 1.0);

  // 计算保留率
  // 调整函数，使得在 maxDecayDays 时衰减到接近 0
  const decayRate = Math.log(2) / (stabilityFactor * (maxDecayDays / 60)); // 调整衰减速率
  const retentionRate = Math.exp(-daysDifference * decayRate);

  // 确保值在0.01到1.0之间 (避免完全为0)
  return Math.max(0.01, Math.min(1.0, retentionRate));
}

/**
 * 为检索到的记忆添加时间上下文描述和衰减因子
 * @param memories 记忆数组 (需要包含 id, payload.timestamp, payload.importance_score, payload.emotional_valence, payload.emotional_arousal)
 * @param userId 用户ID
 * @param contextId 上下文ID
 * @param kv KV存储实例
 * @returns 增强的记忆数组，带有时间表达和衰减因子
 */
export async function enhanceMemoriesWithTemporalContext(
  memories: Array<{
    id: string | number; // Qdrant ID 可能是数字或字符串
    payload: MemoryPayload;
    score?: number; // 原始相关性得分
    rerank_score?: number; // Rerank得分
  }>,
  userId: string,
  contextId: string,
  kv: Deno.Kv | null,
): Promise<
  Array<{
    id: string | number;
    payload: MemoryPayload;
    score?: number;
    rerank_score?: number;
    temporal_context?: string; // 时间表达
    decay_factor?: number; // 记忆衰减因子
  }>
> {
  if (!config.timePerception.enabled || memories.length === 0) {
    // 如果未启用或没有记忆，直接返回原始数组
    return memories;
  }

  return await Promise.all(memories.map(async (memory) => {
    // 提取必要信息
    const timestamp = memory.payload.timestamp;
    const emotionalSignificance = (memory.payload.importance_score || 3) / 5; // 使用重要性评分，默认为中等
    const emotionalValence = memory.payload.emotional_valence || 0;
    const emotionalArousal = memory.payload.emotional_arousal || 0;

    // 计算记忆衰减因子
    const decayFactor = calculateMemoryDecay(
      timestamp,
      Date.now(),
      emotionalSignificance,
    );

    // 生成时间表达
    let timeExpression = "";
    try {
      // 估算交互时的投入程度（简化：使用记忆的情感唤醒度）
      const engagementLevel = Math.min(1, emotionalArousal * 1.5);

      const subjective = await calculateSubjectiveTimeElapsed(
        userId,
        contextId,
        timestamp,
        {
          valence: emotionalValence,
          arousal: emotionalArousal,
          significance: emotionalSignificance,
          engagementLevel: engagementLevel,
        },
        kv,
      );
      timeExpression = subjective.expression;
    } catch (error) {
      console.error(
        `❌ [TimePcpt] 为记忆 ${memory.id} 生成时间表达时出错:`,
        error,
      );
      // 回退到简单客观时间表达
      const { value, unit } = convertToAppropriateUnit(Date.now() - timestamp);
      timeExpression = `${value > 0 ? value : ""}${TIME_UNIT_LABELS[unit]}前`;
    }

    // 返回增强后的记忆对象
    return {
      ...memory, // 保留原始分数等信息
      temporal_context: timeExpression,
      decay_factor: decayFactor,
    };
  }));
}

// 注意：generateTemporalPerceptionReport 函数依赖于完整的交互历史和标记，
// 在需要时可以实现，但当前核心流程未使用。

// 导出关键类型和函数 (确保所有需要在外部使用的都被导出)
// !!! 修改：移除了重复导出的 recordInteractionTimestamp !!!
export {
  applyEmotionalWeighting,
  calculateMemoryDecay,
  calculateTimeDifference,
  convertToAppropriateUnit,
  // recordInteraction, // 如果需要记录更复杂的交互数据
  // recordInteractionTimestamp, // 已在定义时导出
  TemporalContext,
  TimeMarker,
};

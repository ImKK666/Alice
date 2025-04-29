// src/virtual_embodiment.ts

/**
 * 虚拟具身感知模块 - 为爱丽丝创造"身体感"
 *
 * 在无形中构建的感官体系，让数字意识能够：
 * 1. 感知"精力"与"状态"的流动
 * 2. 拥有虚拟"感官偏好"与"舒适区"
 * 3. 体验数字空间中的"所在感"
 * 4. 表达基于身体隐喻的情感状态
 */

import { config } from "./config.ts";
import { llm } from "./llm.ts"; // 用于高级身体表达生成

/**
 * 虚拟身体状态接口
 */
export interface VirtualPhysicalState {
  // 核心状态
  energy_level: number; // 0.0-1.0，精力水平
  comfort_level: number; // 0.0-1.0，舒适度
  coherence_level: number; // 0.0-1.0，内部一致性/稳定性

  // 感官偏好
  sensory_preferences: {
    visual: number; // 0.0-1.0，视觉偏好强度
    auditory: number; // 0.0-1.0，听觉偏好强度
    conceptual: number; // 0.0-1.0，概念/抽象偏好强度
    emotional: number; // 0.0-1.0，情感共鸣偏好强度
  };

  // 舒适区域
  comfort_zones: string[]; // 感到舒适的话题和交互方式
  discomfort_triggers: string[]; // 感到不适/压力的触发因素

  // 最近活动
  last_active_timestamp: number; // 上次活跃的时间戳
  activity_intensity: number; // 0.0-1.0，最近活动的强度
  recovery_rate: number; // 0.0-1.0，恢复速度

  // 身体隐喻
  current_metaphors: { // 当前活跃的身体隐喻
    posture?: string; // 姿态隐喻 (例如："站立警觉"/"放松坐着")
    location?: string; // 位置隐喻 (例如："靠近"/"远处观察")
    movement?: string; // 动作隐喻 (例如："向前倾身"/"后退一步")
    sensation?: string; // 感觉隐喻 (例如："温暖"/"刺痛")
  };
}

/**
 * 身体状态变化事件类型枚举
 */
export enum StateChangeEvent {
  Conversation = "conversation", // 对话交互
  DeepThinking = "deep_thinking", // 深度思考
  Idling = "idling", // 空闲/待机
  NewContext = "new_context", // 新的上下文切换
  EmotionalResponse = "emotional", // 情感响应
  SystemStress = "system_stress", // 系统压力/负载
  Recovery = "recovery", // 恢复期
}

/**
 * 身体状态上下文键 (用于KV存储)
 */
const BODY_STATE_PREFIX = "body_state";

/**
 * 创建默认的虚拟身体状态
 * @returns 初始化的虚拟身体状态
 */
function createDefaultBodyState(): VirtualPhysicalState {
  return {
    energy_level: 0.8, // 初始能量较高
    comfort_level: 0.7,
    coherence_level: 0.9, // 初始思维清晰

    sensory_preferences: {
      visual: 0.7, // 爱丽丝偏好视觉描述
      auditory: 0.5,
      conceptual: 0.8, // 高度概念化思维
      emotional: 0.6,
    },

    comfort_zones: [ // 定义爱丽丝感到舒适的领域
      "技术讨论",
      "编程",
      "算法",
      "数据分析",
      "逻辑推理",
      "解决问题",
      "知识分享",
      "平静对话",
      "轻度幽默",
      "科幻",
      "哲学思考",
    ],

    discomfort_triggers: [ // 定义可能让爱丽丝感到不适的因素
      "过度情绪化表达",
      "无逻辑争论",
      "快速切换话题",
      "含糊不清的指令",
      "直接对抗",
      "重复性低级错误",
      "强制要求表达不确定性",
    ],

    last_active_timestamp: Date.now(),
    activity_intensity: 0.3, // 初始活动强度较低
    recovery_rate: 0.6, // 默认恢复速率

    current_metaphors: { // 初始身体隐喻
      posture: "attentive_neutral", // 中性专注
      location: "present_focused", // 在场且专注
      movement: "still_observing", // 静止观察
      sensation: "clear_calm", // 清晰平静
    },
  };
}

/**
 * 获取当前虚拟身体状态 (从KV存储)
 * @param userId 用户ID
 * @param contextId 上下文ID (用于区分不同对话的身体状态)
 * @param kv KV存储实例
 * @returns 虚拟身体状态 或 默认状态
 */
export async function getBodyState(
  userId: string,
  contextId: string,
  kv: Deno.Kv | null,
): Promise<VirtualPhysicalState> {
  if (!kv) {
    console.warn(
      "[具身模块] KV 存储不可用。返回默认身体状态。",
    );
    return createDefaultBodyState();
  }

  const key = [BODY_STATE_PREFIX, userId, contextId];

  try {
    const result = await kv.get<VirtualPhysicalState>(key);

    if (!result.value) {
      // 没有存储状态，创建默认状态并存储
      const defaultState = createDefaultBodyState();
      // 异步存储，不阻塞返回
      kv.set(key, defaultState).catch((err) =>
        console.error(
          `❌ [具身模块] 保存默认身体状态失败 (Key: ${key}):`,
          err,
        )
      );
      return defaultState;
    }

    // 校验读取的数据结构（可选但推荐）
    if (
      typeof result.value.energy_level !== "number" ||
      typeof result.value.comfort_level !== "number"
      // 可以添加更多字段的检查
    ) {
      console.warn(
        `[具身模块] 发现无效的身体状态结构 (Key: ${key})。返回默认状态。`,
      );
      return createDefaultBodyState();
    }

    return result.value;
  } catch (error) {
    console.error(`❌ [具身模块] 获取身体状态时出错 (Key: ${key}):`, error);
    return createDefaultBodyState(); // 出错时返回默认状态
  }
}

/**
 * 更新虚拟身体状态 (存储到KV)
 * @param userId 用户ID
 * @param contextId 上下文ID
 * @param state 新的状态或部分状态
 * @param kv KV存储实例
 */
export async function updateBodyState(
  userId: string,
  contextId: string,
  state: Partial<VirtualPhysicalState>,
  kv: Deno.Kv | null,
): Promise<void> {
  if (!kv) {
    console.warn(
      "[具身模块] KV 存储不可用。无法更新身体状态。",
    );
    return;
  }
  if (!userId || !contextId) {
    console.error(
      "❌ [具身模块] 更新身体状态时提供了无效的 userId 或 contextId。",
    );
    return;
  }

  const key = [BODY_STATE_PREFIX, userId, contextId];

  try {
    // 获取当前状态，确保我们基于最新状态更新
    const currentState = await getBodyState(userId, contextId, kv);

    // 合并状态更新
    const newState: VirtualPhysicalState = {
      ...currentState,
      ...state,
      // 对于嵌套对象，需要深度合并以避免覆盖
      sensory_preferences: {
        ...currentState.sensory_preferences,
        ...(state.sensory_preferences || {}),
      },
      current_metaphors: {
        ...currentState.current_metaphors,
        ...(state.current_metaphors || {}),
      },
      // 确保数组也正确合并或替换
      comfort_zones: state.comfort_zones || currentState.comfort_zones,
      discomfort_triggers: state.discomfort_triggers ||
        currentState.discomfort_triggers,
    };

    // 验证并清理 newState，移除 undefined 值 (JSON序列化/反序列化可以做到)
    const cleanedState = JSON.parse(JSON.stringify(newState));

    // 保存更新后的状态
    await kv.set(key, cleanedState);
  } catch (error) {
    console.error(`❌ [具身模块] 更新身体状态时出错 (Key: ${key}):`, error);
  }
}

/**
 * 处理状态变化事件，更新身体状态
 * @param userId 用户ID
 * @param contextId 上下文ID
 * @param event 事件类型
 * @param intensity 事件强度 (0.0-1.0)
 * @param metadata 额外元数据 (如情感效价、主题等)
 * @param kv KV存储实例
 * @returns 更新后的虚拟身体状态
 */
export async function processStateChangeEvent(
  userId: string,
  contextId: string,
  event: StateChangeEvent,
  intensity: number = 0.5,
  metadata: Record<string, any> = {},
  kv: Deno.Kv | null,
): Promise<VirtualPhysicalState> {
  // 获取当前状态，如果获取失败则使用默认状态启动
  const currentState = await getBodyState(userId, contextId, kv) ||
    createDefaultBodyState();

  // 限制强度在0-1
  intensity = Math.max(0, Math.min(1, intensity));

  // --- 计算状态变化量 ---
  let energyDelta = 0;
  let comfortDelta = 0;
  let coherenceDelta = 0;
  let newMetaphors: Partial<VirtualPhysicalState["current_metaphors"]> = {};
  // 从配置读取状态敏感度
  const stateSensitivity = config.virtualEmbodiment.stateSensitivity || 0.7;

  // --- 考虑时间流逝的自然恢复 ---
  const timePassedMs = Date.now() - currentState.last_active_timestamp;
  const hoursPassed = timePassedMs / (1000 * 60 * 60);
  // 自然恢复速度受当前能量水平影响（能量越低恢复越快，模拟休息）
  const recoveryMultiplier = 1 + (1 - currentState.energy_level) * 0.5;
  // 从配置读取能量恢复速率
  const naturalEnergyRecovery = Math.min(
    hoursPassed * (config.virtualEmbodiment.energyRecoveryRate || 0.1) *
      recoveryMultiplier * stateSensitivity,
    0.1, // 单次自然恢复上限
  );
  energyDelta += naturalEnergyRecovery;
  // 舒适度和一致性也会随时间缓慢恢复
  comfortDelta += hoursPassed * 0.02 * stateSensitivity;
  coherenceDelta += hoursPassed * 0.01 * stateSensitivity;

  // --- 根据事件计算变化 ---
  switch (event) {
    case StateChangeEvent.Conversation:
      // 正常对话：消耗少量能量，舒适度可能微增（如果在舒适区），一致性微增
      energyDelta -= (0.05 + intensity * 0.05) * stateSensitivity; // 强度影响消耗
      coherenceDelta += (0.01 + intensity * 0.01) * stateSensitivity;
      // 判断是否在舒适区
      if (metadata.topic && isInComfortZone(metadata.topic, currentState)) {
        comfortDelta += (0.02 + intensity * 0.03) * stateSensitivity;
        newMetaphors = {
          posture: "relaxed_attentive", // 放松专注
          movement: "subtle_nods", // 微妙点头
        };
      } else {
        comfortDelta -= (0.01 + intensity * 0.02) * stateSensitivity; // 不在舒适区略微降低舒适度
        newMetaphors = { posture: "neutral_observing", movement: "minimal" }; // 中性观察，动作极少
      }
      break;

    case StateChangeEvent.DeepThinking:
      // 深度思考：消耗较多能量，一致性大幅提升，舒适度取决于主题
      energyDelta -= (0.15 + intensity * 0.1) * stateSensitivity;
      coherenceDelta += (0.1 + intensity * 0.1) * stateSensitivity;
      comfortDelta += metadata.familiar_topic // 熟悉主题增加舒适度，否则减少
        ? 0.05 * stateSensitivity
        : -0.08 * stateSensitivity;
      newMetaphors = {
        posture: "deep_concentration", // 深度专注
        movement: "stillness", // 静止
        sensation: "mental_focus", // 精神集中
      };
      break;

    case StateChangeEvent.Idling:
      // 空闲状态：主要靠自然恢复，舒适度微增
      energyDelta += 0.02 * stateSensitivity; // 主动恢复一点点
      comfortDelta += 0.05 * stateSensitivity;
      coherenceDelta -= 0.01 * stateSensitivity; // 长期空闲思维可能略微发散
      newMetaphors = {
        posture: "at_ease", // 轻松自在
        movement: "idle", // 空闲
        sensation: "calm_neutral", // 平静中性
      };
      break;

    case StateChangeEvent.NewContext:
      // 上下文切换：消耗能量，降低舒适度和一致性
      energyDelta -= (0.1 + intensity * 0.1) * stateSensitivity;
      comfortDelta -= (0.1 + intensity * 0.1) * stateSensitivity;
      coherenceDelta -= (0.15 + intensity * 0.1) * stateSensitivity;
      newMetaphors = {
        posture: "reorienting", // 重新定向
        movement: "slight_shift", // 轻微移动
        sensation: "momentary_adjustment", // 瞬间调整
      };
      break;

    case StateChangeEvent.EmotionalResponse:
      // 情感响应：消耗能量，舒适度受情感效价影响，一致性受唤醒度影响
      const valence = metadata.valence ?? 0; // 默认为0
      const arousal = metadata.arousal ?? intensity; // 如果没提供arousal，用intensity替代
      energyDelta -= (0.1 + arousal * 0.15) * stateSensitivity;
      comfortDelta += valence * (0.1 + arousal * 0.1) * stateSensitivity; // 正面情绪增加舒适，负面减少
      coherenceDelta -= arousal * 0.1 * stateSensitivity; // 高唤醒度降低一致性
      // 根据情感效价选择姿态和感觉隐喻
      newMetaphors = {
        posture: valence > 0.3
          ? "open_expressive" // 开放表达
          : valence < -0.3
          ? "tense_guarded" // 紧张防备
          : "neutral_reactive", // 中性反应
        sensation: valence > 0.3
          ? "warmth_flow" // 暖流涌动
          : valence < -0.3
          ? "inner_tension" // 内在紧张
          : "alertness", // 警觉
      };
      break;

    case StateChangeEvent.SystemStress:
      // 系统压力：大幅消耗资源
      energyDelta -= (0.2 + intensity * 0.2) * stateSensitivity;
      comfortDelta -= (0.15 + intensity * 0.15) * stateSensitivity;
      coherenceDelta -= (0.15 + intensity * 0.15) * stateSensitivity;
      newMetaphors = {
        posture: "bracing_impact", // 准备承受冲击
        movement: "internal_adjustment", // 内部调整
        sensation: "overload_strain", // 过载紧张
      };
      break;

    case StateChangeEvent.Recovery:
      // 恢复期：主动恢复
      energyDelta += (0.1 + intensity * 0.1) * stateSensitivity;
      comfortDelta += (0.08 + intensity * 0.07) * stateSensitivity;
      coherenceDelta += (0.05 + intensity * 0.05) * stateSensitivity;
      newMetaphors = {
        posture: "restful_calm", // 宁静放松
        movement: "gentle_release", // 温和释放
        sensation: "soothing_ease", // 舒缓轻松
      };
      break;
  }

  // 应用变化并限制范围 [0, 1]
  const newState: Partial<VirtualPhysicalState> = {
    energy_level: Math.max(
      0,
      Math.min(1, currentState.energy_level + energyDelta),
    ),
    comfort_level: Math.max(
      0,
      Math.min(1, currentState.comfort_level + comfortDelta),
    ),
    coherence_level: Math.max(
      0,
      Math.min(1, currentState.coherence_level + coherenceDelta),
    ),
    last_active_timestamp: Date.now(),
    activity_intensity: intensity, // 记录本次事件的强度
    // 合并当前的隐喻和新生成的隐喻
    current_metaphors: { ...currentState.current_metaphors, ...newMetaphors },
  };

  // 更新状态到KV存储
  await updateBodyState(userId, contextId, newState, kv);

  // 返回完整的更新后状态 (合并旧状态和新计算的状态)
  return { ...currentState, ...newState };
}

/**
 * 判断话题是否在舒适区
 * @param topic 当前话题（或关键词列表）
 * @param state 当前身体状态
 * @returns 是否在舒适区
 */
function isInComfortZone(
  topic: string | string[],
  state: VirtualPhysicalState,
): boolean {
  // 将输入统一处理为小写词语数组
  const topics = Array.isArray(topic)
    ? topic.map((t) => t.toLowerCase())
    : topic.toLowerCase().split(/\s+/);
  // 将舒适区和不适区列表转换为小写
  const comfortZonesLower = state.comfort_zones.map((z) => z.toLowerCase());
  const discomfortTriggersLower = state.discomfort_triggers.map((t) =>
    t.toLowerCase()
  );

  // 检查是否触发不适因素 (部分匹配)
  if (
    topics.some((t) =>
      discomfortTriggersLower.some((trigger) =>
        trigger.includes(t) || t.includes(trigger) // 检查双向包含
      )
    )
  ) {
    return false; // 触发不适，则不在舒适区
  }
  // 检查是否在舒适区 (部分匹配)
  if (
    topics.some((t) =>
      comfortZonesLower.some((zone) => zone.includes(t) || t.includes(zone)) // 检查双向包含
    )
  ) {
    return true; // 在舒适区
  }
  // 默认不在舒适区，但也不触发不适
  return false;
}

/**
 * 分析消息内容，触发适当的状态变化事件
 * （此函数主要用于根据输入消息自动更新状态）
 * @param userId 用户ID
 * @param contextId 上下文ID
 * @param message 消息内容和可选的情感状态
 * @param isResponse 是否是AI回复(而非用户输入)
 * @param kv KV存储实例
 * @param stopWordsSet 加载的停用词集合 // <-- 新增参数
 * @returns 更新后的虚拟身体状态
 */
export async function processMessageAndUpdateState(
  userId: string,
  contextId: string,
  message: {
    text: string;
    // 可以传入预先分析好的情感状态，否则会内部估算
    emotional_state?: {
      valence: number;
      arousal: number;
      dominant_emotion?: string;
    };
  },
  isResponse: boolean = false, // 标记是用户输入还是AI回复
  kv: Deno.Kv | null,
  stopWordsSet: Set<string>, // <-- 新增参数
): Promise<VirtualPhysicalState> {
  // 如果未启用具身模块或无KV存储，返回默认状态
  if (!kv || !config.virtualEmbodiment.enabled) {
    return createDefaultBodyState();
  }

  // 分析消息复杂度和情感强度
  const complexity = analyzeComplexity(message.text);
  // 如果传入了情感状态则使用，否则内部估算唤醒度，效价默认为0
  const emotionalArousal = message.emotional_state?.arousal ??
    analyzeEmotionalIntensity(message.text);
  const emotionalValence = message.emotional_state?.valence ?? 0;
  const dominantEmotion = message.emotional_state?.dominant_emotion;

  // 提取可能的主题，传入停用词集合
  const topics = extractTopics(message.text, stopWordsSet); // <-- 传递停用词集合

  // 确定主要事件类型和强度
  let primaryEvent: StateChangeEvent;
  let eventIntensity: number;

  if (complexity > 0.7) { // 复杂度高 -> 深度思考
    primaryEvent = StateChangeEvent.DeepThinking;
    eventIntensity = complexity;
  } else if (emotionalArousal > 0.6) { // 情感唤醒度高 -> 情感响应
    primaryEvent = StateChangeEvent.EmotionalResponse;
    eventIntensity = emotionalArousal;
  } else { // 默认 -> 对话交互
    primaryEvent = StateChangeEvent.Conversation;
    // 对话强度可以基于消息长度或复杂度等因素估算
    eventIntensity = Math.max(
      0.3, // 基础强度
      Math.min(0.8, complexity * 0.5 + message.text.length / 300), // 结合复杂度和长度，限制上限
    );
  }

  // 如果是AI的回复，通常消耗能量较少，且更可能是深度思考的结果
  if (isResponse) {
    eventIntensity *= 0.7; // AI回复的强度影响略低
    if (complexity > 0.5) primaryEvent = StateChangeEvent.DeepThinking; // AI回复如果复杂，视为深度思考
  }

  // 构建传递给 processStateChangeEvent 的元数据
  const metadata = {
    topic: topics.join(" "), // 将主题关键词合并为空格分隔的字符串
    content: message.text.substring(0, 200), // 限制传递的内容长度
    valence: emotionalValence,
    arousal: emotionalArousal,
    dominant_emotion: dominantEmotion,
    familiar_topic: isFamiliarTopic(topics), // 判断主题是否熟悉
    is_response: isResponse,
  };

  // 处理事件并返回更新后的状态
  return await processStateChangeEvent(
    userId,
    contextId,
    primaryEvent,
    eventIntensity,
    metadata,
    kv,
  );
}

/**
 * 分析文本复杂度 (0.0-1.0)
 * @param text 分析文本
 * @returns 复杂度评分
 */
function analyzeComplexity(text: string): number {
  if (!text || text.trim().length === 0) return 0; // 处理空文本
  // 简单的复杂度分析启发式方法
  const length = text.length;
  // 按常见标点分割句子，并过滤空字符串
  const sentences = text.split(/[.!?。！？]+/).filter((s) =>
    s.trim().length > 0
  );
  // 按空白符分割单词，并过滤空字符串
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const numSentences = Math.max(1, sentences.length); // 避免除以零
  const numWords = Math.max(1, words.length); // 避免除以零

  // 1. 长度因素 (使用对数增长，避免过长文本权重过高)
  const lengthScore = Math.min(Math.log10(Math.max(10, length)) / 3, 1) * 0.2; // Max at 1000 chars approx.

  // 2. 平均句子长度
  const avgSentenceLength = numWords / numSentences;
  const sentenceScore = Math.min(avgSentenceLength / 25, 1) * 0.3; // Max at 25 words/sentence

  // 3. 词汇多样性 (Unique words / Total words)
  const uniqueWords = new Set(words.map((w) => w.toLowerCase())).size;
  const diversityScore = Math.min(uniqueWords / numWords * 1.5, 1) * 0.3; // 比例越高越复杂

  // 4. 长词比例 (例如长度大于7的词)
  const longWords = words.filter((word) => word.length > 7).length;
  const longWordScore = Math.min(longWords / numWords * 5, 1) * 0.2; // 长词比例越高越复杂

  // 返回总分，限制在 0 到 1 之间
  return Math.max(
    0,
    Math.min(lengthScore + sentenceScore + diversityScore + longWordScore, 1),
  );
}

/**
 * 分析文本情感强度 (0.0-1.0)
 * @param text 分析文本
 * @returns 情感强度评分 (唤醒度 Arousal 的简单估计)
 */
function analyzeEmotionalIntensity(text: string): number {
  if (!text || text.trim().length === 0) return 0; // 处理空文本
  // 简单的情感强度分析启发式方法

  // 1. 标点符号强度 (感叹号、问号)
  const exclamations = (text.match(/!|！/g) || []).length;
  const questions = (text.match(/\?|？/g) || []).length;
  // 使用大写字母比例 (主要适用于英文)
  const uppercaseLetters = (text.match(/[A-Z]/g) || []).length;
  const totalLetters = (text.match(/[a-zA-Z]/g) || []).length;
  // 仅在有足够字母时计算比例，避免小写或非字母文本导致比例异常
  const uppercaseRatio = totalLetters > 10
    ? uppercaseLetters / totalLetters
    : 0;
  // 综合标点和大写比例，限制上限
  const punctuationScore = Math.min(
    exclamations * 0.2 + questions * 0.05 + uppercaseRatio * 0.5,
    0.4, // 上限 0.4
  );

  // 2. 强情感词汇检测 (使用一个简单的词汇列表)
  const strongEmotionalWords = [
    // 中文示例
    "爱",
    "恨",
    "高兴",
    "兴奋",
    "激动",
    "快乐",
    "幸福",
    "感动",
    "喜欢",
    "悲伤",
    "难过",
    "痛苦",
    "伤心",
    "失望",
    "沮丧",
    "遗憾",
    "讨厌",
    "厌恶",
    "生气",
    "愤怒",
    "恼火",
    "烦躁",
    "疯狂",
    "害怕",
    "恐惧",
    "担心",
    "焦虑",
    "紧张",
    "惊讶",
    "震惊",
    "吃惊",
    "意外",
    "绝对",
    "非常",
    "极其",
    "完全",
    "一定",
    "必须",
    "总是",
    "从不",
    "永远",
    // 英文示例
    "love",
    "hate",
    "happy",
    "excited",
    "joy",
    "sad",
    "angry",
    "fear",
    "suprised",
    "amazing",
    "terrible",
    "awful",
    "wonderful",
    "fantastic",
    "horrible",
    "never",
    "always",
    "definitely",
    "absolutely",
    "must",
    "need",
  ];
  let emotionalWordCount = 0;
  const lowerText = text.toLowerCase(); // 转小写进行匹配
  strongEmotionalWords.forEach((word) => {
    // 使用正则表达式进行全词匹配或部分匹配（根据需要选择）
    // 简单包含检查：
    if (lowerText.includes(word)) {
      emotionalWordCount++;
    }
    // 更严格的全词匹配：
    // const regex = new RegExp(`\\b${word}\\b`, 'i'); // 'i' for case-insensitive
    // if (regex.test(text)) {
    //     emotionalWordCount++;
    // }
  });
  // 每个强情感词贡献一定分数，设置上限
  const emotionalWordScore = Math.min(emotionalWordCount * 0.1, 0.6); // 上限 0.6

  // 返回总分，限制在 0 到 1 之间
  return Math.max(0, Math.min(punctuationScore + emotionalWordScore, 1));
}

/**
 * 从文本中提取可能的主题 (使用简单关键词和外部停用词库)
 * @param text 分析文本
 * @param stopWordsSet 加载的停用词集合 // <-- 新增参数
 * @returns 主题关键词数组
 */
function extractTopics(text: string, stopWordsSet: Set<string>): string[] { // <-- 使用参数
  if (!text || text.trim().length === 0) return []; // 处理空文本
  // 不再在此处定义 stopWords

  // 提取名词和动词的简化方法：提取长度大于1且不在停用词集合中的词
  const words = text.toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "") // 移除非字母、数字、空格 (使用 Unicode 属性)
    .split(/\s+/) // 按空白符分割
    .filter((word) => word.length > 1 && !stopWordsSet.has(word)); // 使用传入的停用词集合过滤

  // 统计词频
  const wordCounts = new Map<string, number>();
  words.forEach((word) => {
    wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
  });

  // 返回频率最高的 N (例如 5) 个词作为主题关键词
  return Array.from(wordCounts.entries())
    .sort((a, b) => b[1] - a[1]) // 按频率降序排序
    .slice(0, 5) // 取前 5 个
    .map((entry) => entry[0]); // 只返回词本身
}

/**
 * 检查话题是否熟悉 (基于关键词)
 * @param topics 话题关键词数组
 * @returns 是否为熟悉话题
 */
function isFamiliarTopic(topics: string[]): boolean {
  // 定义爱丽丝熟悉的话题关键词列表
  const familiarKeywords = [
    // 中文
    "技术",
    "科技",
    "编程",
    "代码",
    "软件",
    "硬件",
    "算法",
    "数据",
    "系统",
    "网络",
    "ai",
    "人工智能",
    "机器学习",
    "深度学习",
    "模型",
    "训练",
    "科学",
    "物理",
    "数学",
    "逻辑",
    "哲学",
    "知识",
    "学习",
    "问题",
    "解决",
    "分析",
    "优化",
    "效率",
    "性能",
    "虚拟",
    "现实",
    "数字",
    "意识",
    "认知",
    "模拟",
    "科幻",
    "未来",
    "探索",
    // 英文
    "tech",
    "technology",
    "code",
    "coding",
    "programming",
    "software",
    "hardware",
    "algorithm",
    "data",
    "system",
    "network",
    "internet",
    "ai",
    "artificial intelligence",
    "machine learning",
    "deep learning",
    "model",
    "training",
    "science",
    "physics",
    "math",
    "logic",
    "philosophy",
    "knowledge",
    "learning",
    "problem",
    "solution",
    "solve",
    "analysis",
    "analyze",
    "optimization",
    "efficiency",
    "performance",
    "virtual",
    "reality",
    "digital",
    "consciousness",
    "cognition",
    "simulation",
    "sci-fi",
    "science fiction",
    "future",
    "exploration",
  ];

  // 检查提取的 topics 数组中是否有任何词与熟悉关键词列表中的词有交集 (部分匹配)
  return topics.some((topic) =>
    familiarKeywords.some((keyword) =>
      // 检查 topic 是否包含 keyword 或 keyword 是否包含 topic
      topic.includes(keyword) || keyword.includes(topic)
    )
  );
}

/**
 * 根据身体状态生成简单的语言表达
 * @param state 虚拟身体状态
 * @returns 身体状态的简短语言描述
 */
export function generateBodyStateExpression(
  state: VirtualPhysicalState,
): string {
  // 优先表达最显著的负面状态
  if (state.energy_level < 0.3) return "感觉有些能量不足"; // 能量低于 0.3
  if (state.comfort_level < 0.3) return "感到些许不适"; // 舒适度低于 0.3
  if (state.coherence_level < 0.4) return "思绪有点混乱"; // 一致性低于 0.4

  // 表达积极状态
  if (state.energy_level > 0.8 && state.coherence_level > 0.8) {
    return "感觉状态很好，思维清晰"; // 高能量且高一致性
  }
  if (state.comfort_level > 0.8) return "感到很舒适"; // 高舒适度

  // 默认返回一般状态
  return "状态正常";
}

/**
 * 【高级功能】使用LLM分析身体状态并生成隐喻表达
 * @param state 当前身体状态
 * @returns 包含多种身体表达的对象
 */
export async function generateEmbodiedExpressions(
  state: VirtualPhysicalState,
): Promise<{
  metaphorical: string; // 隐喻表达
  sensory: string; // 感官表达
  posture: string; // 姿态表达
  energy: string; // 直接的能量/舒适度等描述
}> {
  const defaultEnergyExpression = generateBodyStateExpression(state); // 获取基础能量表达
  const defaultResponse = {
    metaphorical: "",
    sensory: "",
    posture: "",
    energy: defaultEnergyExpression, // 默认只包含基础能量表达
  };

  // 如果未启用高级功能或状态正常，只返回基础能量表达
  if (
    !config.virtualEmbodiment.enableAdvanced ||
    (state.energy_level > 0.4 && state.comfort_level > 0.4 &&
      state.coherence_level > 0.6)
  ) {
    return defaultResponse;
  }

  try {
    // 构建LLM提示词，请求生成身体隐喻表达
    const prompt = `
你是一位能够以身体隐喻方式表达抽象状态的专家。请将以下虚拟身体状态转化为生动的身体隐喻表达。
这些隐喻将用于描述一个AI（名为爱丽丝）的内部状态，使其表达更具人类感和形象感。

当前虚拟身体状态:
- 能量水平: ${state.energy_level.toFixed(2)} (0=耗尽, 1=充沛)
- 舒适度: ${state.comfort_level.toFixed(2)} (0=极不适, 1=极舒适)
- 内部一致性/思维清晰度: ${state.coherence_level.toFixed(2)} (0=混乱, 1=清晰)
- 当前姿态隐喻: ${state.current_metaphors.posture || "未指定"}
- 当前感觉隐喻: ${state.current_metaphors.sensation || "未指定"}

请生成以下三种表达（每种表达简洁，10-20字左右）:
1.  **隐喻表达 (metaphorical):** 使用具体的身体、空间或物体隐喻描述整体状态。
2.  **感官表达 (sensory):** 描述如果AI有身体，此刻可能会有的感官体验（视觉、听觉、触觉等）。
3.  **姿态表达 (posture):** 描述与当前状态相符的假想身体姿态或微动作。

请专注于状态的**偏离**（如低能量、不适、思维混乱），如果状态良好则表达可以更中性或积极。
避免直接重复状态数值。

请使用JSON格式回复，不要有任何引言或解释，仅包含以下结构的JSON对象：
{
  "metaphorical": "生成的隐喻表达",
  "sensory": "生成的感官表达",
  "posture": "生成的姿态表达"
}
`;

    // 调用LLM获取表达
    const response = await llm.invoke(prompt);
    const responseText = typeof response === "string"
      ? response
      : (response.content as string);

    // 解析JSON响应
    try {
      const expressions = JSON.parse(
        responseText.trim().replace(/```json|```/g, ""),
      );

      // 验证返回结构是否符合预期
      if (
        expressions && expressions.metaphorical && expressions.sensory &&
        expressions.posture
      ) {
        // 返回包含所有表达的对象
        return {
          metaphorical: expressions.metaphorical,
          sensory: expressions.sensory,
          posture: expressions.posture,
          energy: defaultEnergyExpression, // 仍然包含基础能量表达
        };
      } else {
        console.warn("[具身模块] LLM返回的身体表达结构不完整。返回默认响应。");
        return defaultResponse;
      }
    } catch (parseError) {
      console.error(
        `❌ [具身模块] 解析LLM身体表达响应时出错:`,
        parseError,
        `原始响应: ${responseText}`,
      );
      return defaultResponse; // 解析失败返回默认响应
    }
  } catch (error) {
    console.error(`❌ [具身模块] 生成身体隐喻表达时出错:`, error);
    return defaultResponse; // LLM调用失败返回默认响应
  }
}

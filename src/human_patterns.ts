// src/human_patterns.ts

/**
 * 人类语言模式模块 - 为爱丽丝的表达增添自然的人类特质
 *
 * 实现特性：
 * 1. 自然语言变化：口头禅、常用表达、个性化语法结构
 * 2. 思考与表达的不完美：停顿、重复、自我修正
 * 3. 语气和节奏的起伏：根据情感状态动态调整
 * 4. 半结构化思考：自然的思维流和表达方式
 */

import { llm } from "./llm.ts";
import { config } from "./config.ts";
// 导入语言模板和模板选择器
import {
  LANGUAGE_TEMPLATES,
  PersonaType,
  selectLanguageTemplate,
} from "./language_templates.ts";

/**
 * 语言个性特征接口定义
 */
export interface SpeechCharacteristics {
  verbal_tics: string[]; // 口头禅或习惯性表达
  phrase_templates: string[]; // 常用句式模板
  emotional_expressions: Record<string, string[]>; // 不同情绪下的表达方式
  pause_frequency: number; // 停顿频率 (0.0-1.0)
  self_correction_rate: number; // 自我修正频率 (0.0-1.0)
  formality_level: number; // 正式程度 (0.0-1.0)
  vocabulary_diversity: number; // 词汇多样性 (0.0-1.0)
  sentence_complexity: number; // 句子复杂度 (0.0-1.0)
}

/**
 * 生成上下文相关的个性化语言特征
 * @param context 上下文信息
 * @returns 调整后的语言特征
 */
export function generateContextualSpeechCharacteristics(
  context: {
    is_work_context: boolean;
    is_owner: boolean;
    emotional_state: {
      valence: number;
      arousal: number;
      dominant_emotion?: string;
    };
  },
): SpeechCharacteristics {
  // 使用语言模板选择器获取基础模板
  const baseTemplate = selectLanguageTemplate(context);

  // 从基础模板开始，进一步调整
  const speechCharacteristics = { ...baseTemplate };

  // 基于当前上下文的特殊调整
  if (context.is_work_context) {
    // 工作场景：减少不完美特征，更偏向专业模板
    speechCharacteristics.pause_frequency = Math.max(
      0.1,
      speechCharacteristics.pause_frequency - 0.2,
    );
    speechCharacteristics.self_correction_rate = Math.max(
      0.05,
      speechCharacteristics.self_correction_rate - 0.1,
    );
    speechCharacteristics.formality_level = Math.min(
      0.9,
      speechCharacteristics.formality_level + 0.2,
    ); // 更正式
  } else if (context.is_owner) {
    // 与主人对话：增强傲娇特征
    if (speechCharacteristics.verbal_tics.indexOf("主、主人...") === -1) {
      speechCharacteristics.verbal_tics.push("主、主人...", "真是拿你没办法");
    }
    speechCharacteristics.formality_level = Math.max(
      0.3,
      speechCharacteristics.formality_level - 0.2,
    ); // 更不正式
  }

  // 根据配置的人类化强度调整各种不完美特征的频率
  const intensityFactor = config.humanPatterns.humanizationIntensity || 0.7;
  speechCharacteristics.pause_frequency *= intensityFactor;
  speechCharacteristics.self_correction_rate *= intensityFactor;
  // 强度也影响口头禅概率 (但有一个基础值)
  // verbalTicProbability in addVerbalTics will use this indirectly

  // 限制特征值在合理范围
  speechCharacteristics.pause_frequency = Math.max(
    0,
    Math.min(1, speechCharacteristics.pause_frequency),
  );
  speechCharacteristics.self_correction_rate = Math.max(
    0,
    Math.min(1, speechCharacteristics.self_correction_rate),
  );
  speechCharacteristics.formality_level = Math.max(
    0,
    Math.min(1, speechCharacteristics.formality_level),
  );
  speechCharacteristics.vocabulary_diversity = Math.max(
    0,
    Math.min(1, speechCharacteristics.vocabulary_diversity),
  );
  speechCharacteristics.sentence_complexity = Math.max(
    0,
    Math.min(1, speechCharacteristics.sentence_complexity),
  );

  return speechCharacteristics;
}

/**
 * 表达模式枚举
 */
export enum ExpressionPattern {
  DirectStatement = "direct_statement", // 直接陈述
  ThoughtProcess = "thought_process", // 思考过程
  SelfCorrection = "self_correction", // 自我修正
  HesitantResponse = "hesitant_response", // 犹豫回应
  ConfidentAnswer = "confident_answer", // 自信回答
  EmotionalReaction = "emotional_reaction", // 情感反应
}

/**
 * 为段落选择表达模式
 * @param paragraph 段落文本
 * @param context 上下文信息
 * @returns 适合的表达模式
 */
function selectExpressionPattern(
  paragraph: string,
  context: {
    is_first_paragraph: boolean;
    is_question_response: boolean;
    is_emotional_content: boolean;
    speech_characteristics: SpeechCharacteristics;
  },
): ExpressionPattern {
  // 对问题的开头回应通常会有思考过程或犹豫
  if (context.is_first_paragraph && context.is_question_response) {
    const rand = Math.random();
    if (rand < 0.5 * context.speech_characteristics.pause_frequency) {
      return ExpressionPattern.HesitantResponse;
    }
    if (rand < 0.6) return ExpressionPattern.ThoughtProcess;
    // 否则可能是直接或自信的回答
  }

  // 情感内容通常会有情感反应
  if (context.is_emotional_content && Math.random() < 0.6) {
    return ExpressionPattern.EmotionalReaction;
  }

  // 根据段落内容随机选择模式，但考虑语言特征中的停顿和自我修正频率
  // 权重化随机选择
  const patterns = [
    { pattern: ExpressionPattern.DirectStatement, weight: 0.6 },
    {
      pattern: ExpressionPattern.ThoughtProcess,
      weight: 0.1 + context.speech_characteristics.pause_frequency * 0.3,
    },
    {
      pattern: ExpressionPattern.SelfCorrection,
      weight: context.speech_characteristics.self_correction_rate * 1.5,
    }, // 提高自我修正概率
    {
      pattern: ExpressionPattern.HesitantResponse,
      weight: context.speech_characteristics.pause_frequency * 0.5,
    }, // 提高犹豫概率
    {
      pattern: ExpressionPattern.ConfidentAnswer,
      weight: 0.1 * (1 - context.speech_characteristics.pause_frequency),
    }, // 自信与犹豫互斥
    { pattern: ExpressionPattern.EmotionalReaction, weight: 0.05 },
  ];

  // 计算总权重
  const totalWeight = patterns.reduce(
    (sum, { weight }) => sum + Math.max(0, weight),
    0,
  ); // 确保权重非负

  // 随机选择
  let random = Math.random() * totalWeight;
  for (const { pattern, weight } of patterns) {
    if (weight > 0) { // 只考虑正权重
      random -= weight;
      if (random <= 0) return pattern;
    }
  }

  // 默认返回直接陈述
  return ExpressionPattern.DirectStatement;
}

/**
 * 应用表达模式到段落
 * @param paragraph 原始段落
 * @param pattern 表达模式
 * @param characteristics 语言特征
 * @returns 转换后的段落
 */
function applyExpressionPattern(
  paragraph: string,
  pattern: ExpressionPattern,
  characteristics: SpeechCharacteristics,
): string {
  // 简单保护，如果段落为空则直接返回
  if (!paragraph || paragraph.trim().length === 0) {
    return paragraph;
  }
  switch (pattern) {
    case ExpressionPattern.DirectStatement:
      // 直接陈述基本保持原样，可能添加一些口头禅
      return addVerbalTics(
        paragraph,
        characteristics,
        config.humanPatterns.verbalTicProbability * 0.5,
      ); // 较低概率添加
    case ExpressionPattern.ThoughtProcess:
      // 添加思考过程的痕迹
      return addThoughtProcess(paragraph, characteristics);
    case ExpressionPattern.SelfCorrection:
      // 添加自我修正
      return addSelfCorrection(paragraph, characteristics);
    case ExpressionPattern.HesitantResponse:
      // 添加犹豫和停顿
      return addHesitation(paragraph, characteristics);
    case ExpressionPattern.ConfidentAnswer:
      // 强调自信的表达
      return addConfidence(paragraph, characteristics);
    case ExpressionPattern.EmotionalReaction:
      // 添加情感表达
      return addEmotionalExpression(paragraph, characteristics);
    default:
      return paragraph;
  }
}

/**
 * 添加口头禅 (改进版)
 * @param text 原始文本
 * @param characteristics 语言特征
 * @param probability 添加概率
 * @returns 处理后的文本
 */
function addVerbalTics(
  text: string,
  characteristics: SpeechCharacteristics,
  probability: number = config.humanPatterns.verbalTicProbability || 0.3,
): string {
  if (Math.random() > probability || characteristics.verbal_tics.length === 0) {
    return text;
  }

  // 随机选择一个口头禅
  const verbalTic = characteristics.verbal_tics[
    Math.floor(Math.random() * characteristics.verbal_tics.length)
  ];

  // 在句首或句尾添加口头禅，或在句子中间插入（更自然）
  const sentences = text.split(/(?<=[.。!！?？])\s*/).filter((s) =>
    s.trim().length > 0
  );
  const insertPos = Math.floor(Math.random() * (sentences.length + 1)); // 0到length

  if (insertPos === 0) { // 句首
    return `${verbalTic}，${text}`;
  } else if (insertPos === sentences.length) { // 句尾
    // 避免在已有标点后直接加逗号
    const lastChar = text.trim().slice(-1);
    const needsComma = ![".", "。", "!", "！", "?", "？"].includes(lastChar);
    return `${text}${needsComma ? "，" : " "}${verbalTic}`;
  } else { // 句子中间
    sentences.splice(insertPos, 0, verbalTic);
    return sentences.join(" ");
  }
}

/**
 * 添加思考过程 (改进版)
 * @param text 原始文本
 * @param characteristics 语言特征
 * @returns 处理后的文本
 */
function addThoughtProcess(
  text: string,
  characteristics: SpeechCharacteristics,
): string {
  // 思考过程前缀
  const thoughtPrefixes = [
    "让我想想...",
    "嗯...",
    "这个问题嘛...",
    "如果这么看的话...",
    "等一下，", // 更自然的停顿
    "稍等，我在思考...",
    "怎么说呢...",
    "唔...", // 语气词
  ];

  const prefix =
    thoughtPrefixes[Math.floor(Math.random() * thoughtPrefixes.length)];

  // 避免在过短的文本前加思考过程
  if (text.length < 15) return text;

  // 添加思考过程
  return `${prefix} ${text}`;
}

/**
 * 添加自我修正 (改进版)
 * @param text 原始文本
 * @param characteristics 语言特征
 * @returns 处理后的文本
 */
function addSelfCorrection(
  text: string,
  characteristics: SpeechCharacteristics,
): string {
  // 找到适合修正的点（句子中间）
  const sentences = text.split(/(?<=[.。!！?？])\s*/).filter((s) =>
    s.trim().length > 0
  );
  if (sentences.length === 0) return text;

  // 随机选择一个句子进行修正
  const sentenceIndex = Math.floor(Math.random() * sentences.length);
  const sentenceToCorrect = sentences[sentenceIndex];
  const words = sentenceToCorrect.split(/\s+/).filter((w) => w.length > 0);

  if (words.length < 4) return text; // 句子太短不适合修正

  // 选择修正点（避免开头和结尾）
  const correctionIndex = Math.floor(Math.random() * (words.length - 2)) + 1; // 修正第1到倒数第2个词

  // 构建修正前的部分
  const beforeCorrection = words.slice(0, correctionIndex).join(" ");
  // 构建修正后的部分
  const afterCorrection = words.slice(correctionIndex).join(" ");

  // 创建修正表达
  const correctionPhrases = [
    "...不，应该说...",
    "...或者说...",
    "...更准确地说...",
    "...等等，我想说的是...",
    "...不对，是...",
  ];
  const correctionPhrase =
    correctionPhrases[Math.floor(Math.random() * correctionPhrases.length)];

  // 替换原句子
  sentences[sentenceIndex] =
    `${beforeCorrection}${correctionPhrase}${afterCorrection}`;

  return sentences.join(" ");
}

/**
 * 添加犹豫和停顿 (改进版)
 * @param text 原始文本
 * @param characteristics 语言特征
 * @returns 处理后的文本
 */
function addHesitation(
  text: string,
  characteristics: SpeechCharacteristics,
): string {
  // 犹豫表达
  const hesitations = [
    "嗯...",
    "这个...",
    "呃...",
    "那个...",
    "我想...",
    "可能...",
    "应该是...",
  ];

  const hesitation =
    hesitations[Math.floor(Math.random() * hesitations.length)];

  // 在句子中插入停顿或在开头添加犹豫
  const sentences = text.split(/(?<=[.。!！?？])\s*/).filter((s) =>
    s.trim().length > 0
  );

  if (sentences.length === 0) return text;

  if (Math.random() < 0.6) { // 60%概率在开头添加
    return `${hesitation} ${text}`;
  } else { // 40%概率在句子之间插入
    if (sentences.length > 1) {
      const insertPosition =
        Math.floor(Math.random() * (sentences.length - 1)) + 1; // 插入到第1个句子之后
      sentences.splice(insertPosition, 0, hesitation);
      return sentences.join(" ");
    } else {
      // 只有一个句子，还是放开头
      return `${hesitation} ${text}`;
    }
  }
}

/**
 * 添加自信表达 (改进版)
 * @param text 原始文本
 * @param characteristics 语言特征
 * @returns 处理后的文本
 */
function addConfidence(
  text: string,
  characteristics: SpeechCharacteristics,
): string {
  // 自信表达前缀或后缀
  const confidentPrefixes = [
    "我很确定，",
    "毫无疑问，",
    "显然，",
    "当然，",
    "肯定是，",
  ];
  const confidentSuffixes = [
    "，这一点毋庸置疑。",
    "，这是显而易见的。",
    "，我对此很肯定。",
  ];

  const phrase =
    confidentPrefixes[Math.floor(Math.random() * confidentPrefixes.length)];
  const suffix =
    confidentSuffixes[Math.floor(Math.random() * confidentSuffixes.length)];

  // 避免在过短的文本上加自信表达
  if (text.length < 10) return text;

  // 随机选择加前缀或后缀
  if (Math.random() < 0.7) {
    return `${phrase}${text}`;
  } else {
    // 移除结尾标点再加后缀
    const trimmedText = text.trim().replace(/[.。!！?？]$/, "");
    return `${trimmedText}${suffix}`;
  }
}

/**
 * 添加情感表达 (改进版)
 * @param text 原始文本
 * @param characteristics 语言特征
 * @returns 处理后的文本
 */
function addEmotionalExpression(
  text: string,
  characteristics: SpeechCharacteristics,
): string {
  // 随机选择一种情感（优先选择已有模板的情感）
  const availableEmotions = Object.keys(characteristics.emotional_expressions)
    .filter((e) => characteristics.emotional_expressions[e]?.length > 0);

  if (availableEmotions.length === 0) return text;

  const emotion =
    availableEmotions[Math.floor(Math.random() * availableEmotions.length)];
  const expressions = characteristics.emotional_expressions[emotion];

  if (!expressions || expressions.length === 0) return text;

  // 随机选择一个表达
  const expression =
    expressions[Math.floor(Math.random() * expressions.length)];

  // 更自然地融入，可能替换部分词语或作为独立句子
  if (Math.random() < 0.5) {
    // 作为独立感叹句插入
    const sentences = text.split(/(?<=[.。!！?？])\s*/).filter((s) =>
      s.trim().length > 0
    );
    if (sentences.length > 0) {
      const insertPos = Math.floor(Math.random() * (sentences.length + 1));
      sentences.splice(insertPos, 0, `${expression}！`);
      return sentences.join(" ");
    } else {
      return `${expression}！${text}`; // 如果原文为空
    }
  } else {
    // 在开头添加，稍微调整语气
    return `${expression}，${text}`;
  }
}

/**
 * 应用句式模板 (改进版)
 * @param text 原始文本
 * @param characteristics 语言特征
 * @returns 处理后的文本
 */
function applyPhraseTemplate(
  text: string,
  characteristics: SpeechCharacteristics,
): string {
  // 概率降低，避免过度使用模板
  if (Math.random() > 0.15 || characteristics.phrase_templates.length === 0) {
    return text;
  }

  // 随机选择一个句式模板
  const template = characteristics.phrase_templates[
    Math.floor(Math.random() * characteristics.phrase_templates.length)
  ];

  // 应用模板，确保不替换核心内容
  // 简单实现：如果文本较短，直接替换；如果较长，尝试在开头或结尾添加
  if (text.length < 50) {
    return template.replace("{0}", text);
  } else {
    if (template.endsWith("{0}")) {
      return template.replace("{0}", ` ${text}`);
    } else if (template.startsWith("{0}")) {
      return template.replace("{0}", `${text} `);
    } else {
      // 模板中间有{0}，这种比较复杂，暂时不处理长文本
      return text;
    }
  }
}

/**
 * 人类化处理一段文本 (主函数)
 * @param text 原始文本
 * @param context 上下文信息
 * @returns 处理后的文本
 */
export function humanizeText(
  text: string,
  context: {
    is_work_context: boolean;
    is_owner: boolean;
    is_question_response: boolean;
    emotional_state: {
      valence: number;
      arousal: number;
      dominant_emotion?: string;
    };
    // 可以加入更多上下文，如关系状态
  },
): string {
  // 如果未启用人类化处理，直接返回原文
  if (!config.humanPatterns.enabled) {
    return text;
  }

  // 生成上下文相关的语言特征
  const speechCharacteristics = generateContextualSpeechCharacteristics(
    context,
  );

  // 分段处理文本 (按换行符或长段落分割)
  const paragraphs = text.split(/\n{2,}/); // 按两个以上换行符分割段落

  // 处理每个段落
  const humanizedParagraphs = paragraphs.map((paragraph, index) => {
    if (paragraph.trim().length === 0) return paragraph; // 跳过空段落

    // 为每个段落选择并应用表达模式
    const pattern = selectExpressionPattern(paragraph, {
      is_first_paragraph: index === 0,
      is_question_response: context.is_question_response && index === 0, // 只对首段应用问题响应模式
      is_emotional_content: isParagraphEmotional(paragraph), // 判断段落情感倾向
      speech_characteristics: speechCharacteristics,
    });

    let processed = applyExpressionPattern(
      paragraph,
      pattern,
      speechCharacteristics,
    );

    // 应用句式模板（只对较短段落应用，降低概率）
    if (paragraph.length < 70 && Math.random() < 0.2) {
      processed = applyPhraseTemplate(processed, speechCharacteristics);
    }

    // 对非工作上下文，或与主人对话时，更高概率添加口头禅
    const ticProbability = (!context.is_work_context || context.is_owner)
      ? (config.humanPatterns.verbalTicProbability || 0.3) * 1.2 // 提高20%概率
      : (config.humanPatterns.verbalTicProbability || 0.3) * 0.5; // 降低50%概率

    processed = addVerbalTics(
      processed,
      speechCharacteristics,
      Math.min(1, ticProbability),
    );

    return processed;
  });

  // 重新组合文本
  return humanizedParagraphs.join("\n\n");
}

/**
 * 判断段落是否包含情感内容 (改进版)
 * @param paragraph 段落文本
 * @returns 是否包含情感内容
 */
function isParagraphEmotional(paragraph: string): boolean {
  // 简单检测：包含多个感叹号、问号或强情感词汇
  const punctuationScore = (paragraph.match(/[!！?？]/g) || []).length * 0.3;
  const emotionalPatterns = [
    /开心|高兴|喜悦|兴奋|激动|快乐|幸福|感动/i,
    /悲伤|难过|痛苦|伤心|失望|沮丧|遗憾/i,
    /生气|愤怒|恼火|烦躁|irritated|angry|annoyed|furious/i,
    /害怕|恐惧|担心|焦虑|紧张|scared|afraid|worried|anxious/i,
    /惊讶|震惊|吃惊|意外|surprised|shocked|astonished/i,
    /爱|喜欢|讨厌|厌恶|恨|love|hate|like|dislike/i,
    /非常|极其|特别|太|真是|实在|简直|absolutely|extremely/i, // 强调词也可能暗示情感
  ];

  let emotionalWordScore = 0;
  emotionalPatterns.forEach((pattern) => {
    if (pattern.test(paragraph)) {
      emotionalWordScore += 0.4;
    }
  });

  // 综合评分判断
  return (punctuationScore + emotionalWordScore) > 0.5;
}

/**
 * 使用LLM进行高级人类化处理 (主函数)
 * @param text 原始文本
 * @param context 上下文信息
 * @returns 处理后的文本
 */
export async function advancedHumanizeText(
  text: string,
  context: {
    is_work_context: boolean;
    is_owner: boolean;
    is_question_response: boolean;
    emotional_state: {
      valence: number;
      arousal: number;
      dominant_emotion?: string;
    };
    character_style?: string; // 允许传入更具体的风格描述
  },
): Promise<string> {
  // 如果文本较短或不启用高级处理，使用基础处理
  if (
    text.length < config.humanPatterns.advancedMinLength ||
    !config.humanPatterns.enableAdvanced
  ) {
    return humanizeText(text, context);
  }

  // 构建提示词
  const emotionLabel = context.emotional_state.dominant_emotion ||
    (context.emotional_state.valence > 0.3
      ? "正面"
      : context.emotional_state.valence < -0.3
      ? "负面"
      : "中性");

  const emotionIntensity = context.emotional_state.arousal > 0.7
    ? "强烈"
    : context.emotional_state.arousal > 0.4
    ? "中等"
    : "轻微";

  // 动态生成角色风格描述
  let characterStyleDesc = "";
  if (context.character_style) {
    characterStyleDesc = context.character_style; // 优先使用传入的描述
  } else if (context.is_work_context) {
    characterStyleDesc = "一位专业、高效、简洁但略带思考深度的AI助手";
  } else if (context.is_owner) {
    characterStyleDesc = "一位对主人既傲娇又忠诚，内心细腻的少女AI";
  } else {
    characterStyleDesc = "一位冷静、略带吐槽和傲娇特质，思维敏捷的少女AI";
  }
  characterStyleDesc +=
    `，目前情感状态为${emotionLabel}(${emotionIntensity}强度)`;

  const prompt = `
你的任务是将以下由AI生成的文本，修改得更像一个真实的人（具体来说，是 ${characterStyleDesc}）在说话。目标是增加自然度和人性化，去除过于完美、机械或模板化的感觉，同时保持原文的核心信息和意图。

修改时请专注于以下方面：
1.  **自然停顿与思考:** 插入合适的停顿词（嗯、这个、让我想想）、犹豫表达或轻微的思考过程痕迹。
2.  **口语化与习惯表达:** 使用更自然的口语词汇和句式，可以加入符合角色设定的口头禅（如“哼”、“真是的”等，但不要过度使用）。
3.  **轻微的不完美:** 允许非常轻微的重复、自我修正（“...不，我是说...”）或不太流畅的过渡，模拟真实说话时的状态。
4.  **情感色彩:** 让语言 subtly 地反映当前的情感状态，比如积极时语气可以轻快些，思考时语速放缓。
5.  **避免过度:** 修改的关键是“适度”和“自然”，不要为了修改而修改，避免显得刻意或不连贯。

**待修改的原文：**
\`\`\`
${text}
\`\`\`

**修改要求：**
-   保持核心信息和主要观点不变。
-   修改后的文本应该更符合指定的角色风格和情感状态。
-   专注于语言表达的自然流畅度和人性化，而不是内容的增删。
-   直接输出修改后的文本，不要包含任何解释或标记。

**修改后的文本：**
`;

  try {
    // 调用LLM进行处理
    const response = await llm.invoke(prompt);
    const humanizedContent = typeof response === "string"
      ? response
      : (response.content as string);

    // 清理可能的前缀或后缀
    const cleanedContent = humanizedContent
      .replace(/^(修改后的文本|人类化版本)[:：\s]*```?/i, "") // 移除常见前缀和可能的代码块标记
      .replace(/```$/, "") // 移除结尾的代码块标记
      .trim();

    return cleanedContent || text; // 如果处理失败或返回空，返回原文
  } catch (error) {
    console.error("❌ 高级人类化处理出错:", error);
    // 回退到基础处理
    return humanizeText(text, context);
  }
}

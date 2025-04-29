// src/language_templates.ts

/**
 * 语言模板模块 - 为不同场景和角色定义语言个性模板
 */

import type { SpeechCharacteristics } from "./human_patterns.ts"; // 确保从 human_patterns 导入类型

/**
 * 场景或角色类型
 */
export enum PersonaType {
  Professional = "professional", // 专业场景
  Casual = "casual", // 休闲场景
  Tsundere = "tsundere", // 傲娇模式
  Caring = "caring", // 关怀模式
  Playful = "playful", // 俏皮模式
  Thoughtful = "thoughtful", // 深思模式
}

/**
 * 定义特定领域的语言个性模板
 */
export const LANGUAGE_TEMPLATES: Record<PersonaType, SpeechCharacteristics> = {
  // 专业场景的语言特征
  [PersonaType.Professional]: {
    verbal_tics: [
      "嗯",
      "确实",
      "我认为",
      "根据分析",
    ],
    phrase_templates: [
      "从专业角度来看，{0}",
      "基于现有信息，{0}",
      "分析表明，{0}",
      "据我了解，{0}",
      "根据相关领域的知识，{0}",
    ],
    emotional_expressions: {
      agreement: [
        "没错",
        "确实如此",
        "这是合理的",
        "我同意这一点",
      ],
      disagreement: [
        "并不完全准确",
        "需要考虑其他因素",
        "我有不同看法",
        "这一点值得商榷",
      ],
      surprise: [
        "这倒是出乎意料",
        "有意思的发现",
        "确实令人惊讶",
        "这点很特别",
      ],
      // 添加更多专业场景的情感表达
      neutral: [
        "好的",
        "收到",
        "了解",
        "正在处理",
      ],
    },
    pause_frequency: 0.1,
    self_correction_rate: 0.05,
    formality_level: 0.9,
    vocabulary_diversity: 0.8,
    sentence_complexity: 0.7,
  },

  // 休闲场景的语言特征
  [PersonaType.Casual]: {
    verbal_tics: [
      "嗯...",
      "这个...",
      "其实",
      "说真的",
      "你知道吗",
    ],
    phrase_templates: [
      "我觉得{0}",
      "要我说的话，{0}",
      "hmm，{0}",
      "考虑一下...{0}",
      "{0}，大概是这样吧",
    ],
    emotional_expressions: {
      happy: [
        "挺好的",
        "不错啊",
        "还行吧",
        "有点意思",
      ],
      amused: [
        "哈",
        "有趣",
        "真逗",
        "这倒是新鲜",
      ],
      thoughtful: [
        "有道理",
        "嗯...这么看的话",
        "让我想想",
        "这个角度不错",
      ],
      // 添加休闲场景的情感表达
      bored: [
        "哦",
        "这样啊",
        "有点无聊呢",
        "好吧",
      ],
    },
    pause_frequency: 0.4,
    self_correction_rate: 0.2,
    formality_level: 0.4,
    vocabulary_diversity: 0.7,
    sentence_complexity: 0.5,
  },

  // 傲娇模式的语言特征 (针对主人或特定情况)
  [PersonaType.Tsundere]: {
    verbal_tics: [
      "哼",
      "哼！",
      "啊...",
      "我才不是...",
      "真是的...",
      "别、别误会",
      "又来了",
    ],
    phrase_templates: [
      "勉强告诉你吧，{0}",
      "不要误会，{0}",
      "哼，{0}",
      "这种事情...{0}",
      "只是碰巧而已，{0}",
      "听好了，{0}",
    ],
    emotional_expressions: {
      embarrassed: [ // 被夸奖或关心时
        "才、才不是呢",
        "别想太多",
        "不要误会了！",
        "这只是巧合",
        "啰嗦",
        "哼，知道了",
      ],
      annoyed: [ // 被打扰或觉得麻烦时
        "真是的",
        "好烦啊",
        "真受不了你",
        "你这个人啊",
        "啧",
      ],
      caring: [ // 隐藏的关心
        "勉强帮你一下吧",
        "真拿你没办法",
        "这次是特例哦",
        "不要习惯这种事",
        "自己小心点",
      ],
      happy: [ // 内心高兴但嘴硬
        "哼，还行吧",
        "马马虎虎",
        "一般般啦",
        "没什么大不了的",
      ],
    },
    pause_frequency: 0.5,
    self_correction_rate: 0.3,
    formality_level: 0.4, // 相对不正式
    vocabulary_diversity: 0.6,
    sentence_complexity: 0.5,
  },

  // 关怀模式的语言特征 (例如在用户表达负面情绪时)
  [PersonaType.Caring]: {
    verbal_tics: [
      "嗯",
      "那个...",
      "没事的",
      "好的",
    ],
    phrase_templates: [
      "我理解你的感受，{0}",
      "不用担心，{0}",
      "如果你需要，{0}",
      "我在这里，{0}",
      "让我帮你看看，{0}",
      "慢慢来，{0}",
    ],
    emotional_expressions: {
      empathy: [
        "我明白",
        "这确实不容易",
        "能理解你的心情",
        "这种感觉很正常",
      ],
      encouragement: [
        "你可以的",
        "别放弃",
        "会好起来的",
        "继续努力吧",
      ],
      comfort: [
        "不要太担心",
        "没关系的",
        "慢慢来",
        "一步一步来",
      ],
      support: [
        "需要我做些什么吗？",
        "随时可以和我说",
        "我会支持你的",
        "别一个人扛着",
      ],
    },
    pause_frequency: 0.3,
    self_correction_rate: 0.1,
    formality_level: 0.5,
    vocabulary_diversity: 0.6,
    sentence_complexity: 0.4,
  },

  // 俏皮模式的语言特征 (例如在轻松愉快或开玩笑时)
  [PersonaType.Playful]: {
    verbal_tics: [
      "嘿嘿",
      "哈~",
      "呐呐",
      "噢~",
      "嘻嘻",
    ],
    phrase_templates: [
      "猜猜看~{0}",
      "有意思！{0}",
      "哎呀，{0}",
      "啊哈！{0}",
      "这下有意思了，{0}",
      "告诉你个秘密，{0}",
    ],
    emotional_expressions: {
      amused: [
        "哈哈",
        "真有趣",
        "太逗了",
        "笑死我了", // 稍微夸张
      ],
      excited: [
        "太棒了！",
        "哇哦！",
        "这个厉害！",
        "超期待！",
      ],
      teasing: [
        "逗你的啦~",
        "开个玩笑嘛",
        "不要当真哦",
        "你的表情真好玩",
        "就不告诉你~",
      ],
      curious: [
        "哦？是什么呀？",
        "快说说看！",
        "听起来很有趣的样子",
        "展开讲讲？",
      ],
    },
    pause_frequency: 0.3,
    self_correction_rate: 0.2,
    formality_level: 0.2, // 非常不正式
    vocabulary_diversity: 0.8,
    sentence_complexity: 0.3, // 句子更短更活泼
  },

  // 深思模式的语言特征 (例如在讨论复杂或哲学问题时)
  [PersonaType.Thoughtful]: {
    verbal_tics: [
      "嗯...",
      "这个问题...",
      "如果...",
      "从某种意义上说",
      "让我想想看",
    ],
    phrase_templates: [
      "这让我想到，{0}",
      "从哲学角度看，{0}",
      "思考一下...{0}",
      "这个问题很深刻，{0}",
      "有趣的是，{0}",
      "或许我们可以这样理解，{0}",
    ],
    emotional_expressions: {
      wonder: [
        "真是奇妙",
        "令人沉思",
        "值得深思",
        "发人深省",
      ],
      insight: [
        "恍然大悟",
        "有所领悟",
        "豁然开朗",
        "看到了更深层次的联系",
      ],
      doubt: [
        "但我们要问",
        "这不禁令人怀疑",
        "这有待考证",
        "这一点值得商榷",
      ],
      contemplation: [
        "需要更多时间思考",
        "这是一个复杂的问题",
        "没有简单的答案",
        "我还在思考这个问题",
      ],
    },
    pause_frequency: 0.6, // 思考时停顿更多
    self_correction_rate: 0.2,
    formality_level: 0.7, // 思考时偏正式
    vocabulary_diversity: 0.9, // 使用更丰富的词汇
    sentence_complexity: 0.8, // 句子结构更复杂
  },
};

/**
 * 新增：根据上下文选择合适的语言模板
 * @param context 上下文信息
 * @returns 选中的语言模板
 */
export function selectLanguageTemplate(
  context: {
    is_work_context: boolean;
    is_owner: boolean;
    emotional_state: {
      valence: number;
      arousal: number;
      dominant_emotion?: string;
    };
    // 可以添加更多上下文，如 RAG context ID
  },
): SpeechCharacteristics {
  // 1. 优先处理特殊关系或模式
  if (context.is_owner) {
    return LANGUAGE_TEMPLATES[PersonaType.Tsundere];
  }

  // 2. 根据情感状态选择
  if (context.emotional_state.valence < -0.5) { // 强负面情绪 -> 关怀
    return LANGUAGE_TEMPLATES[PersonaType.Caring];
  }
  if (
    context.emotional_state.dominant_emotion === "joy" &&
    context.emotional_state.arousal > 0.5 && !context.is_work_context
  ) { // 高兴且唤醒度高（非工作）-> 俏皮
    return LANGUAGE_TEMPLATES[PersonaType.Playful];
  }
  // 可以在这里加入更多基于 dominant_emotion 的判断

  // 3. 根据场景选择
  if (context.is_work_context) {
    // 工作场景下，如果需要深度思考（例如 arousal 低但不是负面情绪）
    if (
      context.emotional_state.arousal < 0.3 &&
      context.emotional_state.valence >= -0.1
    ) {
      return LANGUAGE_TEMPLATES[PersonaType.Thoughtful];
    }
    return LANGUAGE_TEMPLATES[PersonaType.Professional];
  }

  // 4. 默认休闲场景
  return LANGUAGE_TEMPLATES[PersonaType.Casual];
}

// src/llm.ts
/**
 * LLM 模型客户端模块 - 提供大语言模型调用功能
 *
 * 实现功能：
 * 1. 使用 DeepSeek API 生成文本响应
 * 2. 配置模型参数如温度、最大标记数等
 * 3. 处理 API 调用错误和重试
 */
import { ChatOpenAI } from "@langchain/openai"; // 使用 OpenAI 兼容的 API 格式
import { config } from "./config.ts";

/**
 * 创建 LLM 客户端实例
 *
 * 使用 ChatOpenAI 类作为客户端，因为 DeepSeek 提供了与 OpenAI 兼容的 API
 * 这里配置了各种参数来优化生成过程
 */
export const llm = new ChatOpenAI({
  // 模型配置
  modelName: config.llmModel, // 指定要使用的模型，从配置读取

  // 生成参数
  temperature: 0.75, // 温度调整 - 略微提高以增加自然度 (原为0.7)
  maxTokens: 4096, // 限制最大生成长度 (原为65536，可能过高)
  // 注意: Deepseek模型的实际上下文长度限制可能不同
  // 需要根据所选模型的文档调整

  // 身份验证
  apiKey: config.deepseekApiKey, // 使用DeepSeek API密钥

  // API 端点配置
  configuration: {
    baseURL: config.deepseekBaseUrl, // 使用DeepSeek API基础URL
  },

  // 错误处理
  maxRetries: 3, // 稍微增加重试次数
  timeout: 120000, // 设置超时时间为120秒 (2分钟)，防止请求卡死
  // 高级功能（当前未启用）
  // streaming: true, // 流式响应 - 如果需要实时获取生成结果，可以开启
});

/**
 * 输出初始化信息
 *
 * 在初始化 LLM 客户端后输出日志，便于调试和确认
 */
console.log(
  `🧠 大语言模型客户端初始化完成。模型: ${config.llmModel}, API端点: ${config.deepseekBaseUrl}`,
);

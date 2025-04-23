// src/embeddings.ts
/**
 * 嵌入生成模块 - 提供文本嵌入向量生成功能
 *
 * 实现功能：
 * 1. 使用 SiliconFlow API 生成文本嵌入向量
 * 2. 提供单文本和批量文本的嵌入生成
 * 3. 处理 API 调用错误和重试
 */
import { OpenAIEmbeddings } from "@langchain/openai"; // 使用 OpenAI 兼容的 API 格式
import { config } from "./config.ts";

/**
 * 创建嵌入生成器实例
 *
 * 使用 OpenAIEmbeddings 类作为客户端，因为 SiliconFlow 提供了与 OpenAI 兼容的 API
 * 这里配置了各种参数来优化嵌入生成过程
 */
export const embeddings = new OpenAIEmbeddings({
  // 指定要使用的嵌入模型
  modelName: config.embeddingModel, // 从配置中获取嵌入模型名称

  // 身份验证
  apiKey: config.siliconflowApiKey, // 使用SiliconFlow API密钥

  // 性能优化参数
  batchSize: 48, // 批处理大小 - 每次请求处理的文本数量
  stripNewLines: true, // 移除换行符 - 改善嵌入质量
  dimensions: config.embeddingDimension, // 指定嵌入向量维度

  // API 端点配置
  configuration: {
    // 注意 baseURL 设置 - OpenAIEmbeddings 会自动附加 "/embeddings"
    // 所以这里应该只使用基础URL，而不是完整路径
    baseURL: config.siliconflowBaseUrl,
  },

  // 错误处理
  maxRetries: 2, // 失败时自动重试的次数
});

/**
 * 输出初始化信息
 *
 * 在初始化嵌入客户端后输出日志，便于调试和确认
 */
console.log(
  `🔤 嵌入模型客户端初始化完成。模型: ${config.embeddingModel}, 接口地址: ${config.siliconflowBaseUrl}${config.embeddingsPath}`,
);

/**
 * 检查嵌入维度的工具函数
 *
 * 实现逻辑：
 * 1. 生成一个测试嵌入向量
 * 2. 返回向量的维度
 * 3. 如果出错，返回配置中的默认维度
 *
 * 注意：这个函数当前未被使用，但保留作为工具函数
 */
export async function _getEmbeddingDimension(): Promise<number> {
  try {
    // 生成测试嵌入向量
    const testVector = await embeddings.embedQuery("test");
    return testVector.length; // 返回向量维度
  } catch (error) {
    console.error("❌ 无法获取嵌入维度:", error);
    // 如果无法自动获取，返回配置中的默认值
    return config.embeddingDimension;
  }
}

/**
 * 维度检查代码示例
 *
 * 下面的代码可以在应用启动时运行，以验证实际嵌入维度与配置是否匹配
 * 当前已注释，可在需要时取消注释使用
 */
// async function verifyEmbeddingDimension() {
//   const actualDimension = await _getEmbeddingDimension();
//   if (actualDimension !== config.embeddingDimension) {
//     console.warn(`⚠️ 警告：实际嵌入维度 ${actualDimension} 与配置 ${config.embeddingDimension} 不符。请更新 config.ts。`);
//     // 可以选择更新 config.embeddingDimension 或抛出错误
//   }
// }

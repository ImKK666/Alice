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
  batchSize: 512, // 增加批处理大小以提高效率 (原为48，可根据API限制调整)
  stripNewLines: true, // 移除换行符 - 改善嵌入质量
  dimensions: config.embeddingDimension, // 指定嵌入向量维度

  // API 端点配置
  configuration: {
    // 注意 baseURL 设置 - OpenAIEmbeddings 会自动附加 "/embeddings"
    // 所以这里应该只使用基础URL，而不是完整路径
    baseURL: config.siliconflowBaseUrl,
  },

  // 错误处理
  maxRetries: 3, // 稍微增加重试次数 (原为2)
  timeout: 60000, // 设置超时时间为60秒
  // 可以考虑添加其他 OpenAIEmbeddings 支持的参数，例如指定请求头等
  // headers: { "Custom-Header": "Value" }
});

/**
 * 输出初始化信息
 *
 * 在初始化嵌入客户端后输出日志，便于调试和确认
 */
console.log(
  `🔤 嵌入模型客户端初始化完成。模型: ${config.embeddingModel}, 维度: ${config.embeddingDimension}, 接口: ${config.siliconflowBaseUrl}`,
);

/**
 * 检查嵌入维度的工具函数
 * (通常在开发或测试时使用，应用启动时不必须调用)
 * @returns Promise<number> 返回实际维度或配置维度
 */
export async function _getEmbeddingDimension(): Promise<number> {
  try {
    // 生成测试嵌入向量
    console.log("   -> [Embeddings] 正在生成测试向量以检查维度...");
    const testVector = await embeddings.embedQuery(
      "test query for dimension check",
    );
    console.log(`   -> [Embeddings] 测试向量维度: ${testVector.length}`);
    return testVector.length; // 返回向量维度
  } catch (error) {
    console.error("❌ 无法自动获取嵌入维度:", error);
    // 如果无法自动获取，返回配置中的默认值
    console.warn(
      `   -> [Embeddings] 无法自动获取维度，将使用配置值: ${config.embeddingDimension}`,
    );
    return config.embeddingDimension;
  }
}

/**
 * 维度检查代码示例
 * (可以在应用启动时调用一次进行验证)
 */
/*
async function verifyEmbeddingDimensionOnStartup() {
  if (!config.siliconflowApiKey) {
     console.warn("   -> [Embeddings] SiliconFlow API Key 未配置，跳过维度验证。");
     return;
  }
  console.log("   -> [Embeddings] 正在验证嵌入维度...");
  const actualDimension = await _getEmbeddingDimension();
  if (actualDimension !== config.embeddingDimension) {
    console.warn(`⚠️ 警告：实际嵌入维度 (${actualDimension}) 与配置 (${config.embeddingDimension}) 不符。请检查模型名称或更新 config.ts 中的 EMBEDDING_DIMENSION。`);
    // 在这里可以决定是继续运行还是退出
    // Deno.exit(1); // 例如，维度不匹配时强制退出
  } else {
      console.log("   -> [Embeddings] ✅ 嵌入维度与配置匹配。");
  }
}
// 在 main.ts 的初始化阶段调用:
// await verifyEmbeddingDimensionOnStartup();
*/

// src/llm.ts
/**
 * LLM 模型客户端模块 - 提供大语言模型调用功能
 *
 * 实现功能：
 * 1. 使用 DeepSeek API 生成文本响应
 * 2. 配置模型参数如温度、最大标记数等
 * 3. 处理 API 调用错误和重试
 * 4. 异步LLM请求管理和优化
 */
import { ChatOpenAI } from "@langchain/openai"; // 使用 OpenAI 兼容的 API 格式
import { config } from "./config.ts";
import { createModuleLogger } from "./utils/logger.ts";
import { PerformanceMonitor } from "./utils/performance.ts";

// 日志和性能监控
const llmLogger = createModuleLogger("LLM");
const performanceMonitor = PerformanceMonitor.getInstance();

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

// --- 异步LLM管理器 ---

/**
 * LLM请求类型枚举
 */
export enum LLMRequestType {
  MESSAGE_ANALYSIS = "message_analysis",
  SENTIMENT_ANALYSIS = "sentiment_analysis",
  RESPONSE_GENERATION = "response_generation",
  HUMANIZATION = "humanization",
  SOCIAL_ANALYSIS = "social_analysis",
  IMPORTANCE_DETECTION = "importance_detection",
  MIND_WANDERING = "mind_wandering",
  EMBODIED_EXPRESSION = "embodied_expression",
  OTHER = "other"
}

/**
 * LLM请求优先级
 */
export enum LLMRequestPriority {
  CRITICAL = 1,    // 关键路径，必须立即处理
  HIGH = 2,        // 高优先级，影响用户体验
  NORMAL = 3,      // 正常优先级
  LOW = 4,         // 低优先级，可延迟处理
  BACKGROUND = 5   // 后台任务
}

/**
 * LLM请求接口
 */
interface LLMRequest {
  id: string;
  type: LLMRequestType;
  priority: LLMRequestPriority;
  prompt: string;
  options?: {
    temperature?: number;
    maxTokens?: number;
    timeout?: number;
  };
  timestamp: number;
  userId?: string;
  contextId?: string;
}

/**
 * LLM响应接口
 */
interface LLMResponse {
  requestId: string;
  content: string;
  success: boolean;
  error?: Error;
  duration: number;
  timestamp: number;
}

/**
 * 异步LLM请求管理器
 */
class AsyncLLMManager {
  private requestQueue: Map<string, LLMRequest> = new Map();
  private responseCache: Map<string, LLMResponse> = new Map();
  private activeRequests: Set<string> = new Set();
  private maxConcurrentRequests = 5; // 最大并发请求数
  private cacheTimeout = 5 * 60 * 1000; // 缓存5分钟
  private requestDeduplication: Map<string, string[]> = new Map(); // 请求去重

  /**
   * 提交LLM请求
   */
  async submitRequest(
    type: LLMRequestType,
    priority: LLMRequestPriority,
    prompt: string,
    options?: {
      temperature?: number;
      maxTokens?: number;
      timeout?: number;
      userId?: string;
      contextId?: string;
    }
  ): Promise<string> {
    const requestId = crypto.randomUUID();
    const operationId = `llm_request_${type}_${Date.now()}`;

    // 检查缓存和去重
    const cacheKey = this.generateCacheKey(type, prompt, options);
    const cachedResponse = this.getCachedResponse(cacheKey);
    if (cachedResponse) {
      llmLogger.debug(`缓存命中: ${type}`, { requestId, cacheKey });
      return cachedResponse.content;
    }

    // 检查是否有相同的请求正在处理
    const duplicateRequestId = this.checkDuplicateRequest(cacheKey);
    if (duplicateRequestId) {
      llmLogger.debug(`请求去重: ${type}`, { requestId, duplicateRequestId });
      return this.waitForDuplicateRequest(duplicateRequestId);
    }

    const request: LLMRequest = {
      id: requestId,
      type,
      priority,
      prompt,
      options,
      timestamp: Date.now(),
      userId: options?.userId,
      contextId: options?.contextId
    };

    performanceMonitor.startOperation(operationId, `LLM请求-${type}`, options?.userId);

    try {
      // 添加到去重映射
      this.addToDeduplication(cacheKey, requestId);

      // 执行请求
      const response = await this.executeRequest(request);

      // 缓存响应
      this.cacheResponse(cacheKey, response);

      performanceMonitor.endOperation(operationId, `LLM请求-${type}`, options?.userId);
      llmLogger.info(`LLM请求完成: ${type}`, {
        requestId,
        duration: response.duration,
        success: response.success
      });

      if (!response.success) {
        throw response.error || new Error("LLM请求失败");
      }

      return response.content;
    } catch (error) {
      performanceMonitor.endOperation(operationId, `LLM请求-${type}`, options?.userId);
      llmLogger.error(`LLM请求失败: ${type}`, error as Error, { requestId });
      throw error;
    } finally {
      // 清理去重映射
      this.removeFromDeduplication(cacheKey, requestId);
    }
  }

  /**
   * 执行单个LLM请求
   */
  private async executeRequest(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now();
    this.activeRequests.add(request.id);

    try {
      const timeout = request.options?.timeout || 60000; // 默认60秒超时
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("LLM请求超时")), timeout);
      });

      const llmPromise = llm.invoke(request.prompt, {
        temperature: request.options?.temperature || 0.75,
        maxTokens: request.options?.maxTokens || 4096,
      });

      const response = await Promise.race([llmPromise, timeoutPromise]);
      const content = typeof response === "string" ? response : (response.content as string);

      return {
        requestId: request.id,
        content: content || "",
        success: true,
        duration: Date.now() - startTime,
        timestamp: Date.now()
      };
    } catch (error) {
      return {
        requestId: request.id,
        content: "",
        success: false,
        error: error as Error,
        duration: Date.now() - startTime,
        timestamp: Date.now()
      };
    } finally {
      this.activeRequests.delete(request.id);
    }
  }

  /**
   * 生成缓存键
   */
  private generateCacheKey(
    type: LLMRequestType,
    prompt: string,
    options?: any
  ): string {
    const optionsStr = options ? JSON.stringify(options) : "";
    const hash = this.simpleHash(prompt + optionsStr);
    return `${type}_${hash}`;
  }

  /**
   * 简单哈希函数
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 转换为32位整数
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * 获取缓存响应
   */
  private getCachedResponse(cacheKey: string): LLMResponse | null {
    const cached = this.responseCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
      return cached;
    }
    if (cached) {
      this.responseCache.delete(cacheKey); // 清理过期缓存
    }
    return null;
  }

  /**
   * 缓存响应
   */
  private cacheResponse(cacheKey: string, response: LLMResponse): void {
    if (response.success) {
      this.responseCache.set(cacheKey, response);
    }
  }

  /**
   * 检查重复请求
   */
  private checkDuplicateRequest(cacheKey: string): string | null {
    const requestIds = this.requestDeduplication.get(cacheKey);
    return requestIds && requestIds.length > 0 ? requestIds[0] : null;
  }

  /**
   * 添加到去重映射
   */
  private addToDeduplication(cacheKey: string, requestId: string): void {
    const existing = this.requestDeduplication.get(cacheKey) || [];
    existing.push(requestId);
    this.requestDeduplication.set(cacheKey, existing);
  }

  /**
   * 从去重映射中移除
   */
  private removeFromDeduplication(cacheKey: string, requestId: string): void {
    const existing = this.requestDeduplication.get(cacheKey) || [];
    const filtered = existing.filter(id => id !== requestId);
    if (filtered.length === 0) {
      this.requestDeduplication.delete(cacheKey);
    } else {
      this.requestDeduplication.set(cacheKey, filtered);
    }
  }

  /**
   * 等待重复请求完成
   */
  private async waitForDuplicateRequest(requestId: string): Promise<string> {
    // 简单的轮询等待，实际应用中可以使用事件机制
    let attempts = 0;
    const maxAttempts = 60; // 最多等待60秒

    while (attempts < maxAttempts) {
      if (!this.activeRequests.has(requestId)) {
        // 请求已完成，查找缓存结果
        for (const [cacheKey, response] of this.responseCache.entries()) {
          if (response.requestId === requestId && response.success) {
            return response.content;
          }
        }
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    throw new Error("等待重复请求超时");
  }

  /**
   * 批量提交请求
   */
  async submitBatchRequests(
    requests: Array<{
      type: LLMRequestType;
      priority: LLMRequestPriority;
      prompt: string;
      options?: any;
    }>
  ): Promise<string[]> {
    const promises = requests.map(req =>
      this.submitRequest(req.type, req.priority, req.prompt, req.options)
    );

    const results = await Promise.allSettled(promises);
    return results.map(result =>
      result.status === 'fulfilled' ? result.value : ""
    );
  }

  /**
   * 获取管理器状态
   */
  getStatus() {
    return {
      activeRequests: this.activeRequests.size,
      cacheSize: this.responseCache.size,
      deduplicationSize: this.requestDeduplication.size,
      maxConcurrentRequests: this.maxConcurrentRequests
    };
  }

  /**
   * 清理过期缓存
   */
  cleanupCache(): void {
    const now = Date.now();
    for (const [key, response] of this.responseCache.entries()) {
      if (now - response.timestamp > this.cacheTimeout) {
        this.responseCache.delete(key);
      }
    }
  }
}

// 创建全局LLM管理器实例
export const asyncLLMManager = new AsyncLLMManager();

// 定期清理缓存
setInterval(() => {
  asyncLLMManager.cleanupCache();
}, 5 * 60 * 1000); // 每5分钟清理一次

/**
 * 便捷的LLM调用函数（保持向后兼容）
 */
export async function invokeLLM(
  prompt: string,
  type: LLMRequestType = LLMRequestType.OTHER,
  priority: LLMRequestPriority = LLMRequestPriority.NORMAL,
  options?: {
    temperature?: number;
    maxTokens?: number;
    timeout?: number;
    userId?: string;
    contextId?: string;
  }
): Promise<string> {
  return asyncLLMManager.submitRequest(type, priority, prompt, options);
}

/**
 * 输出初始化信息
 *
 * 在初始化 LLM 客户端后输出日志，便于调试和确认
 */
console.log(
  `🧠 大语言模型客户端初始化完成。模型: ${config.llmModel}, API端点: ${config.deepseekBaseUrl}`,
);
console.log(`🚀 异步LLM管理器已初始化，支持并发请求、缓存和去重优化`);

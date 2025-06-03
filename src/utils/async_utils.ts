// src/utils/async_utils.ts
/**
 * 异步处理工具模块
 * 
 * 提供高级异步处理功能，包括：
 * 1. 并行任务执行和管理
 * 2. 错误隔离和恢复
 * 3. 超时控制
 * 4. 性能监控集成
 */

import { createModuleLogger } from "./logger.ts";
import { PerformanceMonitor } from "./performance.ts";

const asyncLogger = createModuleLogger("AsyncUtils");
const performanceMonitor = PerformanceMonitor.getInstance();

/**
 * 并行任务结果接口
 */
export interface ParallelTaskResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  duration: number;
  taskName: string;
}

/**
 * 并行任务配置
 */
export interface ParallelTaskConfig {
  name: string;
  timeout?: number;
  retries?: number;
  priority?: number;
  fallbackValue?: any;
}

/**
 * 高级并行任务执行器
 */
export class ParallelTaskExecutor {
  private maxConcurrency: number;
  private activeTaskCount = 0;
  private taskQueue: Array<() => Promise<any>> = [];

  constructor(maxConcurrency = 10) {
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * 执行并行任务（带错误隔离）
   */
  async executeParallel<T>(
    tasks: Array<{
      task: () => Promise<T>;
      config: ParallelTaskConfig;
    }>,
    options?: {
      failFast?: boolean;
      collectErrors?: boolean;
      timeout?: number;
    }
  ): Promise<ParallelTaskResult<T>[]> {
    const operationId = `parallel_execution_${Date.now()}`;
    performanceMonitor.startOperation(operationId, "并行任务执行", "system");

    asyncLogger.info(`开始执行 ${tasks.length} 个并行任务`, {
      taskCount: tasks.length,
      maxConcurrency: this.maxConcurrency,
      options
    });

    try {
      // 按优先级排序任务
      const sortedTasks = tasks.sort((a, b) => 
        (a.config.priority || 5) - (b.config.priority || 5)
      );

      // 创建任务执行Promise
      const taskPromises = sortedTasks.map(({ task, config }) => 
        this.executeTaskWithIsolation(task, config)
      );

      // 根据选项执行任务
      let results: ParallelTaskResult<T>[];
      
      if (options?.timeout) {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("并行任务执行超时")), options.timeout);
        });
        
        results = await Promise.race([
          Promise.allSettled(taskPromises),
          timeoutPromise
        ]) as PromiseSettledResult<ParallelTaskResult<T>>[];
      } else {
        results = await Promise.allSettled(taskPromises) as PromiseSettledResult<ParallelTaskResult<T>>[];
      }

      // 处理结果
      const finalResults = results.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          return {
            success: false,
            error: result.reason,
            duration: 0,
            taskName: sortedTasks[index].config.name
          } as ParallelTaskResult<T>;
        }
      });

      // 统计结果
      const successCount = finalResults.filter(r => r.success).length;
      const failureCount = finalResults.length - successCount;
      const totalDuration = finalResults.reduce((sum, r) => sum + r.duration, 0);

      asyncLogger.info(`并行任务执行完成`, {
        total: finalResults.length,
        success: successCount,
        failure: failureCount,
        totalDuration,
        averageDuration: totalDuration / finalResults.length
      });

      performanceMonitor.endOperation(operationId, "并行任务执行", "system");
      return finalResults;

    } catch (error) {
      performanceMonitor.endOperation(operationId, "并行任务执行", "system");
      asyncLogger.error("并行任务执行失败", error as Error);
      throw error;
    }
  }

  /**
   * 执行单个任务（带错误隔离）
   */
  private async executeTaskWithIsolation<T>(
    task: () => Promise<T>,
    config: ParallelTaskConfig
  ): Promise<ParallelTaskResult<T>> {
    const startTime = Date.now();
    const taskOperationId = `task_${config.name}_${Date.now()}`;
    
    performanceMonitor.startOperation(taskOperationId, `任务-${config.name}`, "system");

    try {
      // 超时控制
      const timeout = config.timeout || 30000; // 默认30秒
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`任务 ${config.name} 超时`)), timeout);
      });

      // 重试逻辑
      let lastError: Error | undefined;
      const maxRetries = config.retries || 0;
      
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const result = await Promise.race([task(), timeoutPromise]);
          const duration = Date.now() - startTime;
          
          performanceMonitor.endOperation(taskOperationId, `任务-${config.name}`, "system");
          
          return {
            success: true,
            result,
            duration,
            taskName: config.name
          };
        } catch (error) {
          lastError = error as Error;
          if (attempt < maxRetries) {
            asyncLogger.warn(`任务 ${config.name} 第 ${attempt + 1} 次尝试失败，准备重试`, {
              error: lastError.message,
              attempt: attempt + 1,
              maxRetries
            });
            // 指数退避
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          }
        }
      }

      // 所有重试都失败了
      const duration = Date.now() - startTime;
      performanceMonitor.endOperation(taskOperationId, `任务-${config.name}`, "system");
      
      return {
        success: false,
        error: lastError,
        duration,
        taskName: config.name,
        result: config.fallbackValue
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      performanceMonitor.endOperation(taskOperationId, `任务-${config.name}`, "system");
      
      return {
        success: false,
        error: error as Error,
        duration,
        taskName: config.name,
        result: config.fallbackValue
      };
    }
  }

  /**
   * 批量执行相似任务
   */
  async executeBatch<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    options?: {
      batchSize?: number;
      timeout?: number;
      concurrency?: number;
    }
  ): Promise<Array<{ success: boolean; result?: R; error?: Error; item: T }>> {
    const batchSize = options?.batchSize || 10;
    const concurrency = options?.concurrency || this.maxConcurrency;
    const results: Array<{ success: boolean; result?: R; error?: Error; item: T }> = [];

    asyncLogger.info(`开始批量处理 ${items.length} 个项目`, {
      batchSize,
      concurrency,
      totalItems: items.length
    });

    // 分批处理
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      
      const batchTasks = batch.map((item, index) => ({
        task: () => processor(item, i + index),
        config: {
          name: `batch_item_${i + index}`,
          timeout: options?.timeout,
          fallbackValue: undefined
        }
      }));

      const batchResults = await this.executeParallel(batchTasks, {
        timeout: options?.timeout
      });

      // 合并结果
      batch.forEach((item, index) => {
        const taskResult = batchResults[index];
        results.push({
          success: taskResult.success,
          result: taskResult.result,
          error: taskResult.error,
          item
        });
      });

      // 批次间短暂延迟，避免过载
      if (i + batchSize < items.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    const successCount = results.filter(r => r.success).length;
    asyncLogger.info(`批量处理完成`, {
      total: results.length,
      success: successCount,
      failure: results.length - successCount
    });

    return results;
  }

  /**
   * 获取执行器状态
   */
  getStatus() {
    return {
      maxConcurrency: this.maxConcurrency,
      activeTaskCount: this.activeTaskCount,
      queuedTaskCount: this.taskQueue.length
    };
  }
}

/**
 * 全局并行任务执行器实例
 */
export const globalParallelExecutor = new ParallelTaskExecutor(8);

/**
 * 便捷的并行执行函数
 */
export async function executeParallelTasks<T>(
  tasks: Array<{
    name: string;
    task: () => Promise<T>;
    timeout?: number;
    priority?: number;
    fallbackValue?: T;
  }>,
  options?: {
    failFast?: boolean;
    timeout?: number;
  }
): Promise<ParallelTaskResult<T>[]> {
  const formattedTasks = tasks.map(t => ({
    task: t.task,
    config: {
      name: t.name,
      timeout: t.timeout,
      priority: t.priority,
      fallbackValue: t.fallbackValue
    }
  }));

  return globalParallelExecutor.executeParallel(formattedTasks, options);
}

/**
 * 安全的Promise.all包装器（带超时和错误隔离）
 */
export async function safePromiseAll<T>(
  promises: Promise<T>[],
  timeout = 30000,
  fallbackValues?: T[]
): Promise<T[]> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Promise.all 超时")), timeout);
  });

  try {
    const results = await Promise.race([
      Promise.allSettled(promises),
      timeoutPromise
    ]) as PromiseSettledResult<T>[];

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        asyncLogger.warn(`Promise ${index} 失败`, { error: result.reason });
        return fallbackValues?.[index] || ({} as T);
      }
    });
  } catch (error) {
    asyncLogger.error("safePromiseAll 执行失败", error as Error);
    return fallbackValues || [];
  }
}

// src/utils/performance.ts
/**
 * 性能监控和优化工具
 */

export interface PerformanceMetrics {
  duration: number;
  memoryUsage: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  timestamp: Date;
  operation: string;
  context?: string;
}

export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private metrics: Map<string, PerformanceMetrics[]> = new Map();
  private activeOperations: Map<
    string,
    { startTime: number; startMemory: Deno.MemoryUsage }
  > = new Map();

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  startOperation(
    operationId: string,
    operation: string,
    context?: string,
  ): void {
    const startTime = performance.now();
    const startMemory = Deno.memoryUsage();

    this.activeOperations.set(operationId, { startTime, startMemory });

    console.log(`🚀 [Performance] 开始操作: ${operation} (ID: ${operationId})`);
    if (context) {
      console.log(`   上下文: ${context}`);
    }
  }

  endOperation(
    operationId: string,
    operation: string,
    context?: string,
  ): PerformanceMetrics | null {
    const activeOp = this.activeOperations.get(operationId);
    if (!activeOp) {
      console.warn(`⚠️ [Performance] 未找到活动操作: ${operationId}`);
      return null;
    }

    const endTime = performance.now();
    const endMemory = Deno.memoryUsage();
    const duration = endTime - activeOp.startTime;

    const metrics: PerformanceMetrics = {
      duration,
      memoryUsage: {
        rss: endMemory.rss - activeOp.startMemory.rss,
        heapUsed: endMemory.heapUsed - activeOp.startMemory.heapUsed,
        heapTotal: endMemory.heapTotal - activeOp.startMemory.heapTotal,
        external: endMemory.external - activeOp.startMemory.external,
      },
      timestamp: new Date(),
      operation,
      context,
    };

    // 存储指标
    if (!this.metrics.has(operation)) {
      this.metrics.set(operation, []);
    }
    this.metrics.get(operation)!.push(metrics);

    // 清理活动操作
    this.activeOperations.delete(operationId);

    // 记录性能信息
    console.log(`✅ [Performance] 完成操作: ${operation} (ID: ${operationId})`);
    console.log(`   耗时: ${duration.toFixed(2)}ms`);
    console.log(
      `   内存变化: ${
        (metrics.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)
      }MB`,
    );

    // 性能警告
    if (duration > 5000) { // 超过5秒
      console.warn(
        `⚠️ [Performance] 操作耗时过长: ${operation} (${
          duration.toFixed(2)
        }ms)`,
      );
    }

    return metrics;
  }

  getMetrics(operation?: string): PerformanceMetrics[] {
    if (operation) {
      return this.metrics.get(operation) || [];
    }

    const allMetrics: PerformanceMetrics[] = [];
    for (const metrics of this.metrics.values()) {
      allMetrics.push(...metrics);
    }
    return allMetrics;
  }

  getAverageMetrics(operation: string): {
    avgDuration: number;
    avgMemoryUsage: number;
    count: number;
  } | null {
    const metrics = this.metrics.get(operation);
    if (!metrics || metrics.length === 0) {
      return null;
    }

    const totalDuration = metrics.reduce((sum, m) => sum + m.duration, 0);
    const totalMemory = metrics.reduce(
      (sum, m) => sum + m.memoryUsage.heapUsed,
      0,
    );

    return {
      avgDuration: totalDuration / metrics.length,
      avgMemoryUsage: totalMemory / metrics.length,
      count: metrics.length,
    };
  }

  clearMetrics(operation?: string): void {
    if (operation) {
      this.metrics.delete(operation);
    } else {
      this.metrics.clear();
    }
  }
}

/**
 * 性能监控装饰器
 */
export function performanceDecorator(operation: string, context?: string) {
  return function (
    _target: unknown,
    _propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      const monitor = PerformanceMonitor.getInstance();
      const operationId = `${operation}_${Date.now()}_${
        Math.random().toString(36).substr(2, 9)
      }`;

      monitor.startOperation(operationId, operation, context);

      try {
        const result = await originalMethod.apply(this, args);
        monitor.endOperation(operationId, operation, context);
        return result;
      } catch (error) {
        monitor.endOperation(operationId, operation, context);
        throw error;
      }
    };

    return descriptor;
  };
}

// 全局性能监控实例
export const performanceMonitor = PerformanceMonitor.getInstance();

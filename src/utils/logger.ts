// src/utils/logger.ts
/**
 * 增强的日志系统
 * 支持不同级别、结构化日志和性能监控
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  CRITICAL = 4,
}

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  module: string;
  message: string;
  context?: Record<string, unknown>;
  error?: Error;
  userId?: string;
  sessionId?: string;
  performance?: {
    duration?: number;
    memoryUsage?: number;
  };
}

export class Logger {
  private static instance: Logger;
  private logLevel: LogLevel = LogLevel.INFO;
  private logs: LogEntry[] = [];
  private maxLogs: number = 1000;

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  setMaxLogs(max: number): void {
    this.maxLogs = max;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.logLevel;
  }

  private addLog(entry: LogEntry): void {
    this.logs.push(entry);
    
    // 保持日志数量在限制内
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
  }

  private formatMessage(entry: LogEntry): string {
    const timestamp = entry.timestamp.toISOString();
    const level = LogLevel[entry.level];
    const module = entry.module;
    
    let message = `[${timestamp}] [${level}] [${module}] ${entry.message}`;
    
    if (entry.userId) {
      message += ` (User: ${entry.userId})`;
    }
    
    if (entry.sessionId) {
      message += ` (Session: ${entry.sessionId})`;
    }
    
    if (entry.performance) {
      if (entry.performance.duration) {
        message += ` (Duration: ${entry.performance.duration.toFixed(2)}ms)`;
      }
      if (entry.performance.memoryUsage) {
        message += ` (Memory: ${(entry.performance.memoryUsage / 1024 / 1024).toFixed(2)}MB)`;
      }
    }
    
    return message;
  }

  private getConsoleMethod(level: LogLevel): (...args: unknown[]) => void {
    switch (level) {
      case LogLevel.DEBUG:
        return console.debug;
      case LogLevel.INFO:
        return console.info;
      case LogLevel.WARN:
        return console.warn;
      case LogLevel.ERROR:
      case LogLevel.CRITICAL:
        return console.error;
      default:
        return console.log;
    }
  }

  private log(
    level: LogLevel,
    module: string,
    message: string,
    context?: Record<string, unknown>,
    error?: Error,
    userId?: string,
    sessionId?: string,
    performance?: { duration?: number; memoryUsage?: number }
  ): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      module,
      message,
      context,
      error,
      userId,
      sessionId,
      performance,
    };

    this.addLog(entry);

    const formattedMessage = this.formatMessage(entry);
    const consoleMethod = this.getConsoleMethod(level);
    
    consoleMethod(formattedMessage);
    
    if (context) {
      console.log('  Context:', context);
    }
    
    if (error) {
      console.log('  Error:', error.message);
      if (error.stack) {
        console.log('  Stack:', error.stack);
      }
    }
  }

  debug(module: string, message: string, context?: Record<string, unknown>, userId?: string, sessionId?: string): void {
    this.log(LogLevel.DEBUG, module, message, context, undefined, userId, sessionId);
  }

  info(module: string, message: string, context?: Record<string, unknown>, userId?: string, sessionId?: string): void {
    this.log(LogLevel.INFO, module, message, context, undefined, userId, sessionId);
  }

  warn(module: string, message: string, context?: Record<string, unknown>, userId?: string, sessionId?: string): void {
    this.log(LogLevel.WARN, module, message, context, undefined, userId, sessionId);
  }

  error(module: string, message: string, error?: Error, context?: Record<string, unknown>, userId?: string, sessionId?: string): void {
    this.log(LogLevel.ERROR, module, message, context, error, userId, sessionId);
  }

  critical(module: string, message: string, error?: Error, context?: Record<string, unknown>, userId?: string, sessionId?: string): void {
    this.log(LogLevel.CRITICAL, module, message, context, error, userId, sessionId);
  }

  performance(
    module: string,
    message: string,
    duration: number,
    memoryUsage?: number,
    context?: Record<string, unknown>,
    userId?: string,
    sessionId?: string
  ): void {
    this.log(LogLevel.INFO, module, message, context, undefined, userId, sessionId, { duration, memoryUsage });
  }

  getLogs(level?: LogLevel, module?: string, limit?: number): LogEntry[] {
    let filteredLogs = this.logs;
    
    if (level !== undefined) {
      filteredLogs = filteredLogs.filter(log => log.level >= level);
    }
    
    if (module) {
      filteredLogs = filteredLogs.filter(log => log.module === module);
    }
    
    if (limit) {
      filteredLogs = filteredLogs.slice(-limit);
    }
    
    return filteredLogs;
  }

  clearLogs(): void {
    this.logs = [];
  }

  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }
}

// 全局日志实例
export const logger = Logger.getInstance();

// 便捷的模块日志创建器
export function createModuleLogger(moduleName: string) {
  return {
    debug: (message: string, context?: Record<string, unknown>, userId?: string, sessionId?: string) =>
      logger.debug(moduleName, message, context, userId, sessionId),
    info: (message: string, context?: Record<string, unknown>, userId?: string, sessionId?: string) =>
      logger.info(moduleName, message, context, userId, sessionId),
    warn: (message: string, context?: Record<string, unknown>, userId?: string, sessionId?: string) =>
      logger.warn(moduleName, message, context, userId, sessionId),
    error: (message: string, error?: Error, context?: Record<string, unknown>, userId?: string, sessionId?: string) =>
      logger.error(moduleName, message, error, context, userId, sessionId),
    critical: (message: string, error?: Error, context?: Record<string, unknown>, userId?: string, sessionId?: string) =>
      logger.critical(moduleName, message, error, context, userId, sessionId),
    performance: (message: string, duration: number, memoryUsage?: number, context?: Record<string, unknown>, userId?: string, sessionId?: string) =>
      logger.performance(moduleName, message, duration, memoryUsage, context, userId, sessionId),
  };
}

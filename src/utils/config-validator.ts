// src/utils/config-validator.ts
/**
 * 配置验证系统
 * 确保所有必需的配置项都正确设置
 */

import { config } from "../config.ts";
import { ConfigurationError } from "../errors.ts";

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  missingRequired: string[];
  invalidValues: string[];
}

export interface ConfigValidationRule {
  key: string;
  required: boolean;
  type: "string" | "number" | "boolean" | "url" | "email";
  validator?: (value: unknown) => boolean;
  description: string;
}

export class ConfigValidator {
  private static instance: ConfigValidator;
  private rules: ConfigValidationRule[] = [];

  static getInstance(): ConfigValidator {
    if (!ConfigValidator.instance) {
      ConfigValidator.instance = new ConfigValidator();
      ConfigValidator.instance.initializeDefaultRules();
    }
    return ConfigValidator.instance;
  }

  private initializeDefaultRules(): void {
    this.rules = [
      // LLM 配置
      {
        key: "deepseekApiKey",
        required: true,
        type: "string",
        description: "DeepSeek API 密钥",
        validator: (value) => typeof value === "string" && value.length > 5,
      },
      {
        key: "deepseekBaseUrl",
        required: true,
        type: "url",
        description: "DeepSeek API 基础 URL",
      },
      {
        key: "llmModel",
        required: true,
        type: "string",
        description: "LLM 模型名称",
      },

      // Embeddings 配置
      {
        key: "siliconflowApiKey",
        required: true,
        type: "string",
        description: "SiliconFlow API 密钥",
        validator: (value) => typeof value === "string" && value.length > 5,
      },
      {
        key: "embeddingModel",
        required: true,
        type: "string",
        description: "嵌入模型名称",
      },
      {
        key: "embeddingDimension",
        required: true,
        type: "number",
        description: "嵌入向量维度",
        validator: (value) =>
          typeof value === "number" && value > 0 && value <= 4096,
      },

      // Qdrant 配置
      {
        key: "qdrantUrl",
        required: true,
        type: "url",
        description: "Qdrant 服务地址",
      },
      {
        key: "qdrantCollectionName",
        required: true,
        type: "string",
        description: "Qdrant 集合名称",
      },

      // Discord 配置（可选）
      {
        key: "discordBotToken",
        required: false,
        type: "string",
        description: "Discord Bot Token",
      },

      // Telegram 配置（可选）
      {
        key: "telegramBotToken",
        required: false,
        type: "string",
        description: "Telegram Bot Token",
        validator: (value) =>
          !value ||
          (typeof value === "string" && /^\d+:[A-Za-z0-9_-]+$/.test(value)),
      },
      {
        key: "telegramOwnerId",
        required: false,
        type: "string",
        description: "Telegram 主人用户 ID",
        validator: (value) =>
          !value || (typeof value === "string" && /^\d+$/.test(value)),
      },
      {
        key: "telegramProcessingThreshold",
        required: false,
        type: "number",
        description: "Telegram 群组消息处理阈值",
        validator: (value) =>
          !value || (typeof value === "number" && value >= 0 && value <= 1),
      },

      // RAG 参数
      {
        key: "ragInitialRetrievalLimit",
        required: true,
        type: "number",
        description: "RAG 初始检索数量",
        validator: (value) =>
          typeof value === "number" && value > 0 && value <= 100,
      },
      {
        key: "ragRerankTopN",
        required: true,
        type: "number",
        description: "Rerank 保留数量",
        validator: (value) =>
          typeof value === "number" && value > 0 && value <= 20,
      },

      // 系统监控配置
      {
        key: "performanceMonitoringEnabled",
        required: false,
        type: "boolean",
        description: "性能监控开关",
      },
      {
        key: "performanceWarningThreshold",
        required: false,
        type: "number",
        description: "性能警告阈值 (毫秒)",
        validator: (value) =>
          !value || (typeof value === "number" && value > 0),
      },
      {
        key: "maxLogEntries",
        required: false,
        type: "number",
        description: "最大日志条数",
        validator: (value) =>
          !value || (typeof value === "number" && value > 0 && value <= 10000),
      },

      // 错误处理配置
      {
        key: "enableAutoErrorRecovery",
        required: false,
        type: "boolean",
        description: "自动错误恢复开关",
      },
      {
        key: "maxRetryAttempts",
        required: false,
        type: "number",
        description: "最大重试次数",
        validator: (value) =>
          !value || (typeof value === "number" && value >= 0 && value <= 10),
      },

      // 内存管理配置
      {
        key: "memoryWarningThresholdMb",
        required: false,
        type: "number",
        description: "内存警告阈值 (MB)",
        validator: (value) =>
          !value || (typeof value === "number" && value > 0),
      },
      {
        key: "maxConcurrentOperations",
        required: false,
        type: "number",
        description: "最大并发操作数",
        validator: (value) =>
          !value || (typeof value === "number" && value > 0 && value <= 100),
      },
    ];
  }

  addRule(rule: ConfigValidationRule): void {
    this.rules.push(rule);
  }

  private validateUrl(value: unknown): boolean {
    if (typeof value !== "string") return false;
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }

  private validateEmail(value: unknown): boolean {
    if (typeof value !== "string") return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value);
  }

  private validateValue(rule: ConfigValidationRule, value: unknown): boolean {
    // 检查必需字段
    if (
      rule.required && (value === undefined || value === null || value === "")
    ) {
      return false;
    }

    // 如果不是必需字段且值为空，则跳过验证
    if (
      !rule.required && (value === undefined || value === null || value === "")
    ) {
      return true;
    }

    // 类型验证
    switch (rule.type) {
      case "string":
        if (typeof value !== "string") return false;
        break;
      case "number":
        if (typeof value !== "number" || isNaN(value)) return false;
        break;
      case "boolean":
        if (typeof value !== "boolean") return false;
        break;
      case "url":
        if (!this.validateUrl(value)) return false;
        break;
      case "email":
        if (!this.validateEmail(value)) return false;
        break;
    }

    // 自定义验证器
    if (rule.validator && !rule.validator(value)) {
      return false;
    }

    return true;
  }

  validate(): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      missingRequired: [],
      invalidValues: [],
    };

    for (const rule of this.rules) {
      const value = (config as Record<string, unknown>)[rule.key];

      if (!this.validateValue(rule, value)) {
        result.isValid = false;

        if (
          rule.required &&
          (value === undefined || value === null || value === "")
        ) {
          result.missingRequired.push(rule.key);
          result.errors.push(`缺少必需配置: ${rule.key} (${rule.description})`);
        } else {
          result.invalidValues.push(rule.key);
          result.errors.push(`无效配置值: ${rule.key} (${rule.description})`);
        }
      }
    }

    // 添加一些警告
    if (!config.discordBotToken && !config.telegramBotToken) {
      result.warnings.push("未配置任何 Bot Token，只能使用 CLI 模式");
    }

    if (config.ragInitialRetrievalLimit > 50) {
      result.warnings.push("RAG 初始检索数量较大，可能影响性能");
    }

    return result;
  }

  validateAndThrow(): void {
    const result = this.validate();

    if (!result.isValid) {
      throw new ConfigurationError(
        `配置验证失败: ${result.errors.join(", ")}`,
        {
          errors: result.errors,
          warnings: result.warnings,
          missingRequired: result.missingRequired,
          invalidValues: result.invalidValues,
        },
      );
    }

    // 输出警告
    if (result.warnings.length > 0) {
      console.warn("⚠️ 配置警告:");
      for (const warning of result.warnings) {
        console.warn(`   - ${warning}`);
      }
    }
  }

  getConfigSummary(): Record<string, unknown> {
    const summary: Record<string, unknown> = {};

    for (const rule of this.rules) {
      const value = (config as Record<string, unknown>)[rule.key];

      if (
        rule.key.toLowerCase().includes("key") ||
        rule.key.toLowerCase().includes("token")
      ) {
        // 隐藏敏感信息
        summary[rule.key] = value ? "***已设置***" : "未设置";
      } else {
        summary[rule.key] = value;
      }
    }

    return summary;
  }
}

// 全局配置验证器实例
export const configValidator = ConfigValidator.getInstance();

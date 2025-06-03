// src/errors.ts

/**
 * Base class for custom errors in the application.
 * Enhanced with severity levels and retry capabilities.
 */
export class BaseError extends Error {
  public readonly timestamp: Date;
  public readonly details?: Record<string, unknown>;
  public errorCode?: string;
  public readonly severity: "low" | "medium" | "high" | "critical";
  public readonly retryable: boolean;
  public readonly context?: string;

  constructor(
    message: string,
    details?: Record<string, unknown>,
    severity: "low" | "medium" | "high" | "critical" = "medium",
    retryable: boolean = false,
    context?: string,
  ) {
    super(message);
    this.name = this.constructor.name; // Set the error name to the class name
    this.timestamp = new Date();
    this.details = details;
    this.severity = severity;
    this.retryable = retryable;
    this.context = context;

    // Ensure the prototype chain is correctly set up
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public override toString(): string {
    let str =
      `${this.constructor.name} (${this.timestamp.toISOString()}) [${this.severity}]: ${this.message}`;
    if (this.errorCode) {
      str += ` [${this.errorCode}]`;
    }
    if (this.context) {
      str += ` (Context: ${this.context})`;
    }
    if (this.retryable) {
      str += ` [RETRYABLE]`;
    }
    return str;
  }

  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.errorCode,
      message: this.message,
      severity: this.severity,
      retryable: this.retryable,
      context: this.context,
      timestamp: this.timestamp.toISOString(),
      details: this.details,
      stack: this.stack,
    };
  }
}

/**
 * Error related to Language Model operations.
 */
export class LLMError extends BaseError {
  public readonly modelName?: string;
  public readonly prompt?: string;

  constructor(
    message: string,
    details?: Record<string, unknown> & { modelName?: string; prompt?: string },
  ) {
    super(message, details);
    this.errorCode = "LLM_ERROR";
    if (details) {
      this.modelName = details.modelName;
      this.prompt = details.prompt;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error related to Deno KV store operations.
 */
export class KVStoreError extends BaseError {
  public readonly operation?: string;
  public readonly key?: Deno.KvKey;

  constructor(
    message: string,
    details?: Record<string, unknown> & {
      operation?: string;
      key?: Deno.KvKey;
    },
  ) {
    super(message, details);
    this.errorCode = "KV_STORE_ERROR";
    if (details) {
      this.operation = details.operation;
      this.key = details.key;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error related to configuration issues.
 */
export class ConfigurationError extends BaseError {
  public readonly configName?: string;

  constructor(
    message: string,
    details?: Record<string, unknown> & { configName?: string },
  ) {
    super(message, details);
    this.errorCode = "CONFIG_ERROR";
    if (details) {
      this.configName = details.configName;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error related to general module operations or failures.
 */
export class ModuleError extends BaseError {
  public readonly moduleName?: string;

  constructor(
    message: string,
    details?: Record<string, unknown> & { moduleName?: string },
  ) {
    super(message, details);
    this.errorCode = "MODULE_ERROR";
    if (details) {
      this.moduleName = details.moduleName;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

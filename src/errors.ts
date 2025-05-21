// src/errors.ts

/**
 * Base class for custom errors in the application.
 */
export class BaseError extends Error {
  public readonly timestamp: Date;
  public readonly details?: Record<string, any>;
  public errorCode?: string;

  constructor(message: string, details?: Record<string, any>) {
    super(message);
    this.name = this.constructor.name; // Set the error name to the class name
    this.timestamp = new Date();
    this.details = details;

    // Ensure the prototype chain is correctly set up
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toString(): string {
    let str = `${this.constructor.name} (${this.timestamp.toISOString()}): ${this.message}`;
    if (this.errorCode) {
      str += ` [${this.errorCode}]`;
    }
    // Consider adding details if they are simple enough for a string representation
    // if (this.details) {
    //   str += `\nDetails: ${JSON.stringify(this.details, null, 2)}`;
    // }
    return str;
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
    details?: Record<string, any> & { modelName?: string; prompt?: string },
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
    details?: Record<string, any> & { operation?: string; key?: Deno.KvKey },
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
    details?: Record<string, any> & { configName?: string },
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
    details?: Record<string, any> & { moduleName?: string },
  ) {
    super(message, details);
    this.errorCode = "MODULE_ERROR";
    if (details) {
      this.moduleName = details.moduleName;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

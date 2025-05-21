// src/aspirations_manager.ts

import { kvHolder } from "./main.ts";
import type { ValueDomain } from "./self_concept.ts"; // ValueDomain is used by SelfAspiration
import { v4 as uuidv4 } from "https://deno.land/std@0.224.0/uuid/mod.ts";
import { KVStoreError, BaseError } from "./errors.ts"; // Import custom errors

/**
 * 自我愿景接口
 * 表示自我模型的目标与愿望
 */
export interface SelfAspiration {
  id: string; // 愿景唯一ID
  details: string; // 愿景具体描述 (changed from 'description' for clarity if needed, or keep as 'description')
  targetDate?: string; // 目标日期 (optional based on new method signature)
  motivation: number; // 动力 (0.0-1.0)
  relevantValues: ValueDomain[]; // 相关价值领域
  progress: number; // 进展程度 (0.0-1.0)
  achieved: boolean; // 是否已实现
  createdAt: number; // 创建时间
  updatedAt: number; // 最后更新时间
}

export class AspirationsManager {
  constructor() {
    // kvHolder is imported directly, no need to pass kv instance for now
    if (!kvHolder.instance) {
      console.warn(
        "[AspirationsManager] KV store not initialized. Aspirations functionality will be limited.",
      );
    }
  }

  /**
   * 创建新的自我愿景
   * @param details 愿景具体描述
   * @param targetDate 目标日期 (optional)
   * @param initialMotivation 初始动力
   * @param relevantValues 相关价值领域
   * @returns 创建的愿景对象或 null
   */
  async createAspiration(
    details: string,
    targetDate: string | undefined, // Made optional to align with potential usage
    initialMotivation: number,
    relevantValues: ValueDomain[],
  ): Promise<SelfAspiration | null> {
    if (!kvHolder.instance) {
      console.error(
        "❌ [AspirationsManager] KV store not available to create aspiration.",
      );
      return null;
    }

    const aspirationId = uuidv4.generate();
    const now = Date.now();

    const aspiration: SelfAspiration = {
      id: aspirationId,
      details: details,
      targetDate: targetDate,
      motivation: Math.max(0, Math.min(1, initialMotivation)),
      relevantValues: relevantValues,
      progress: 0.0,
      achieved: false,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await kvHolder.instance.set(["self_aspiration", aspirationId], aspiration);
      console.log(
        `💫 [AspirationsManager] Created new aspiration: "${
          aspiration.details.substring(0, 30)
        }..." (ID: ${aspirationId})`,
      );
      return aspiration;
    } catch (error) {
      const key = ["self_aspiration", aspirationId];
      console.error(
        `❌ [AspirationsManager] Failed to create aspiration in KV (key: ${key.join("/")}):`,
        error instanceof BaseError ? error.toString() : error.message,
        error instanceof BaseError && error.details ? error.details : ""
      );
      throw new KVStoreError(
        `Failed to set aspiration ${aspirationId}: ${error.message}`,
        { originalError: error, operation: "set", key },
      );
    }
  }

  /**
   * 获取单个自我愿景
   * @param id 愿景ID
   * @returns 愿景对象或 null
   */
  async getAspiration(id: string): Promise<SelfAspiration | null> {
    if (!kvHolder.instance) {
      console.error(
        "❌ [AspirationsManager] KV store not available to get aspiration.",
      );
      return null;
    }
    try {
      const entry = await kvHolder.instance.get<SelfAspiration>([
        "self_aspiration",
        id,
      ]);
      return entry.value;
    } catch (error) {
      const key = ["self_aspiration", id];
      console.error(
        `❌ [AspirationsManager] Failed to get aspiration ${id} from KV (key: ${key.join("/")}):`,
        error instanceof BaseError ? error.toString() : error.message,
        error instanceof BaseError && error.details ? error.details : ""
      );
      throw new KVStoreError(
        `Failed to get aspiration ${id}: ${error.message}`,
        { originalError: error, operation: "get", key },
      );
    }
  }

  /**
   * 根据ID列表获取所有自我愿景
   * @param aspirationIds 愿景ID数组
   * @returns 愿景对象数组
   */
  async getAllAspirationsByIds(
    aspirationIds: string[],
  ): Promise<SelfAspiration[]> {
    if (!kvHolder.instance) {
      console.error(
        "❌ [AspirationsManager] KV store not available to get all aspirations.",
      );
      return [];
    }
    if (!aspirationIds || aspirationIds.length === 0) {
      return [];
    }

    const aspirations: SelfAspiration[] = [];
    // This method now relies on getAspiration to throw KVStoreError if issues occur.
    // The loop will stop if an error is thrown by getAspiration.
    // The caller (SelfConceptManager) should handle this.
    for (const id of aspirationIds) {
      const aspiration = await this.getAspiration(id); // This might throw
      if (aspiration) {
        aspirations.push(aspiration);
      }
    }
    return aspirations;
  }

  /**
   * 更新愿景进度、动力或实现状态
   * @param id 愿景ID
   * @param progress 新进度 (0-1)
   * @param motivation 新动力 (0-1, optional)
   * @param achieved 是否已实现 (optional)
   * @returns 更新后的愿景对象或 null
   */
  async updateAspirationProgress(
    id: string,
    progress: number,
    motivation?: number,
    achieved?: boolean,
  ): Promise<SelfAspiration | null> {
    if (!kvHolder.instance) {
      console.error(
        "❌ [AspirationsManager] KV store not available to update aspiration.",
      );
      return null;
    }

    const key = ["self_aspiration", id];
    let currentAspiration: SelfAspiration;

    try {
        const entry = await kvHolder.instance.get<SelfAspiration>(key);
        if (!entry.value) {
          console.warn(`⚠️ [AspirationsManager] Aspiration not found for update: ${id}`);
          return null; // Or throw new KVStoreError("Aspiration not found for update", { operation: "get_for_update", key });
        }
        currentAspiration = entry.value;
    } catch (error) {
        console.error(
            `❌ [AspirationsManager] Failed to get aspiration ${id} for update (key: ${key.join("/")}):`,
            error instanceof BaseError ? error.toString() : error.message,
            error instanceof BaseError && error.details ? error.details : ""
        );
        throw new KVStoreError(
            `Failed to get aspiration ${id} for update: ${error.message}`,
            { originalError: error, operation: "get", key },
        );
    }

    const updatedAspiration: SelfAspiration = {
      ...currentAspiration,
      progress: Math.max(0, Math.min(1, progress)),
      updatedAt: Date.now(),
    };

    if (motivation !== undefined) {
      updatedAspiration.motivation = Math.max(0, Math.min(1, motivation));
    }
    if (achieved !== undefined) {
      updatedAspiration.achieved = achieved;
      if (achieved) {
        updatedAspiration.progress = 1.0;
      }
    }

    try {
      await kvHolder.instance.set(key, updatedAspiration);
      console.log(
        `📊 [AspirationsManager] Updated aspiration ${id}: Progress ${(updatedAspiration.progress * 100).toFixed(1)}%, Motivation: ${updatedAspiration.motivation.toFixed(2)}, Achieved: ${updatedAspiration.achieved}`,
      );
      return updatedAspiration;
    } catch (error) {
      console.error(
        `❌ [AspirationsManager] Failed to update aspiration ${id} in KV (key: ${key.join("/")}):`,
        error instanceof BaseError ? error.toString() : error.message,
        error instanceof BaseError && error.details ? error.details : ""
      );
      throw new KVStoreError(
        `Failed to set updated aspiration ${id}: ${error.message}`,
        { originalError: error, operation: "set", key },
      );
    }
  }
}

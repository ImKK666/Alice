// src/autobiography_manager.ts

import { kvHolder } from "./main.ts";
import type { ValueDomain } from "./self_concept.ts"; // ValueDomain is used by AutobiographicalEvent
import { v4 as uuidv4 } from "https://deno.land/std@0.224.0/uuid/mod.ts";
import { KVStoreError, BaseError } from "../errors.ts"; // Import custom errors

/**
 * 自传式事件接口
 * 表示构成自我叙事的重要事件
 */
export interface AutobiographicalEvent {
  id: string; // 事件唯一ID
  timestamp: number; // 事件发生时间
  title: string; // 事件标题
  description: string; // 事件描述
  significance: number; // 重要性 (0.0-1.0)
  impact: string; // 对自我的影响描述
  relatedMemoryIds: string[]; // 相关记忆ID
  domains: ValueDomain[]; // 相关价值领域
}

export class AutobiographyManager {
  constructor() {
    if (!kvHolder.instance) {
      console.warn(
        "[AutobiographyManager] KV store not initialized. Autobiography functionality will be limited.",
      );
    }
  }

  /**
   * 记录重要的自传式事件
   * @param title 事件标题
   * @param description 事件描述
   * @param significance 重要性
   * @param impact 影响描述
   * @param relatedMemoryIds 相关记忆ID
   * @param domains 相关价值领域
   * @returns 创建的事件对象或 null
   */
  async recordSignificantEvent(
    title: string,
    description: string,
    significance: number,
    impact: string,
    relatedMemoryIds: string[] = [],
    domains: ValueDomain[] = [],
  ): Promise<AutobiographicalEvent | null> {
    if (!kvHolder.instance) {
      console.error(
        "❌ [AutobiographyManager] KV store not available to record event.",
      );
      return null;
    }

    const eventId = uuidv4.generate();
    const now = Date.now();

    const event: AutobiographicalEvent = {
      id: eventId,
      timestamp: now,
      title,
      description,
      significance,
      impact,
      relatedMemoryIds,
      domains,
    };

    try {
      await kvHolder.instance.set(["autobiographical_event", eventId], event);
      console.log(
        `📝 [AutobiographyManager] Recorded significant event: "${title}" (ID: ${eventId})`,
      );
      return event;
    } catch (error) {
      const key = ["autobiographical_event", eventId];
      console.error(
        `❌ [AutobiographyManager] Failed to record event in KV (key: ${key.join("/")}):`,
        error instanceof BaseError ? error.toString() : error.message,
        error instanceof BaseError && error.details ? error.details : ""
      );
      throw new KVStoreError(
        `Failed to set autobiographical event ${eventId}: ${error.message}`,
        { originalError: error, operation: "set", key },
      );
    }
  }

  /**
   * 获取单个自传式事件
   * @param id 事件ID
   * @returns 事件对象或 null
   */
  async getSignificantEvent(id: string): Promise<AutobiographicalEvent | null> {
    if (!kvHolder.instance) {
      console.error(
        "❌ [AutobiographyManager] KV store not available to get event.",
      );
      return null;
    }
    try {
      const entry = await kvHolder.instance.get<AutobiographicalEvent>([
        "autobiographical_event",
        id,
      ]);
      return entry.value;
    } catch (error) {
      const key = ["autobiographical_event", id];
      console.error(
        `❌ [AutobiographyManager] Failed to get event ${id} from KV (key: ${key.join("/")}):`,
        error instanceof BaseError ? error.toString() : error.message,
        error instanceof BaseError && error.details ? error.details : ""
      );
      throw new KVStoreError(
        `Failed to get autobiographical event ${id}: ${error.message}`,
        { originalError: error, operation: "get", key },
      );
    }
  }

  /**
   * 根据ID列表获取所有自传式事件
   * @param eventIds 事件ID数组
   * @returns 事件对象数组
   */
  async getAllSignificantEventsByIds(
    eventIds: string[],
  ): Promise<AutobiographicalEvent[]> {
    if (!kvHolder.instance) {
      console.error(
        "❌ [AutobiographyManager] KV store not available to get all events.",
      );
      return [];
    }
    if (!eventIds || eventIds.length === 0) {
      return [];
    }

    const events: AutobiographicalEvent[] = [];
    // This method now relies on getSignificantEvent to throw KVStoreError if issues occur.
    // The loop will stop if an error is thrown by getSignificantEvent.
    // The caller (SelfConceptManager) should handle this.
    for (const id of eventIds) {
      const event = await this.getSignificantEvent(id); // This might throw
      if (event) {
        events.push(event);
      }
    }
    return events;
  }
}

// src/core/index.ts
/**
 * 核心模块导出文件
 * 统一管理所有核心功能的导出
 */

// 基础配置和错误处理
export { config } from "../config.ts";
export * from "../errors.ts";

// 核心 AI 服务
export { llm } from "../llm.ts";
export { embeddings } from "../embeddings.ts";
export { reranker } from "../reranker.ts";

// 数据存储
export * from "../qdrant_client.ts";

// 记忆系统
export * from "../memory_processor.ts";
export * from "../stm_manager.ts";
export * from "../ltm_processor.ts";

// 认知模块
export * from "../cognitive_utils.ts";
export * from "../context_detector.ts";
export * from "../prompt_builder.ts";

// 高级认知功能
export * from "../memory_network.ts";
export * from "../thought_streams.ts";
export * from "../self_concept.ts";
export * from "../social_cognition.ts";
export * from "../mind_wandering.ts";
export * from "../time_perception.ts";
export * from "../virtual_embodiment.ts";
export * from "../cognitive_integration.ts";

// 工具函数
export * from "../utils.ts";
export * from "../state_utils.ts";

// 初始化
export * from "../initialization.ts";

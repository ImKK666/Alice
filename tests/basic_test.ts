// tests/basic_test.ts - 基本功能测试

import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { config } from "../src/config.ts";
import { analyzeMessageSentiment, detectImportantMessage } from "../src/cognitive_utils.ts";

Deno.test("配置文件加载测试", () => {
  assertExists(config);
  assertExists(config.llmModel);
  console.log("✅ 配置文件加载成功");
});

Deno.test("情感分析函数存在性测试", () => {
  assertExists(analyzeMessageSentiment);
  console.log("✅ 情感分析函数存在");
});

Deno.test("重要消息检测函数存在性测试", () => {
  assertExists(detectImportantMessage);
  console.log("✅ 重要消息检测函数存在");
});

// 注意：这些测试只检查函数存在性，不进行实际的 LLM 调用
// 实际的 LLM 调用测试需要配置 API 密钥和网络连接

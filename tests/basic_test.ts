// tests/basic_test.ts - 基本功能测试

import {
  assertEquals,
  assertExists,
  describe,
  it,
  runAllTests,
} from "./test-framework.ts";
import { config } from "../src/config.ts";
import {
  analyzeMessageSentiment,
  detectImportantMessage,
} from "../src/cognitive_utils.ts";
import { configValidator } from "../src/utils/config-validator.ts";
import { logger, LogLevel } from "../src/utils/logger.ts";
import { PerformanceMonitor } from "../src/utils/performance.ts";

describe("配置系统测试", () => {
  it("配置文件应该正确加载", () => {
    assertExists(config);
    assertExists(config.llmModel);
    console.log("✅ 配置文件加载成功");
  });

  it("配置验证器应该正常工作", () => {
    assertExists(configValidator);
    const result = configValidator.validate();
    assertExists(result);
    assertExists(result.isValid);
    console.log("✅ 配置验证器正常工作");
  });

  it("配置摘要应该隐藏敏感信息", () => {
    const summary = configValidator.getConfigSummary();
    assertExists(summary);

    // 检查敏感信息是否被隐藏
    if (summary.deepseekApiKey) {
      assertEquals(typeof summary.deepseekApiKey, "string");
      assertEquals((summary.deepseekApiKey as string).includes("***"), true);
    }
    console.log("✅ 敏感信息正确隐藏");
  });
});

describe("认知工具测试", () => {
  it("情感分析函数应该存在", () => {
    assertExists(analyzeMessageSentiment);
    assertEquals(typeof analyzeMessageSentiment, "function");
    console.log("✅ 情感分析函数存在");
  });

  it("重要消息检测函数应该存在", () => {
    assertExists(detectImportantMessage);
    assertEquals(typeof detectImportantMessage, "function");
    console.log("✅ 重要消息检测函数存在");
  });
});

describe("日志系统测试", () => {
  it("日志系统应该正常工作", () => {
    assertExists(logger);

    // 测试不同级别的日志
    logger.setLogLevel(LogLevel.DEBUG);
    logger.debug("TestModule", "调试消息");
    logger.info("TestModule", "信息消息");
    logger.warn("TestModule", "警告消息");

    const logs = logger.getLogs();
    assertEquals(logs.length >= 3, true);
    console.log("✅ 日志系统正常工作");
  });

  it("日志过滤应该正常工作", () => {
    logger.clearLogs();
    logger.info("Module1", "消息1");
    logger.warn("Module2", "消息2");
    logger.error("Module1", "消息3");

    const module1Logs = logger.getLogs(undefined, "Module1");
    assertEquals(module1Logs.length, 2);

    const warningLogs = logger.getLogs(LogLevel.WARN);
    assertEquals(warningLogs.length >= 2, true);
    console.log("✅ 日志过滤正常工作");
  });
});

describe("性能监控测试", () => {
  it("性能监控应该正常工作", async () => {
    const monitor = PerformanceMonitor.getInstance();
    assertExists(monitor);

    const operationId = "test_operation_" + Date.now();
    monitor.startOperation(operationId, "测试操作", "测试上下文");

    // 模拟一些工作
    await new Promise((resolve) => setTimeout(resolve, 10));

    const metrics = monitor.endOperation(
      operationId,
      "测试操作",
      "测试上下文",
    );
    assertExists(metrics);
    assertEquals(typeof metrics.duration, "number");
    assertEquals(metrics.duration >= 10, true);
    console.log("✅ 性能监控正常工作");
  });

  it("性能指标统计应该正常工作", () => {
    const monitor = PerformanceMonitor.getInstance();
    const avgMetrics = monitor.getAverageMetrics("测试操作");
    assertExists(avgMetrics);
    assertEquals(typeof avgMetrics.avgDuration, "number");
    assertEquals(avgMetrics.count >= 1, true);
    console.log("✅ 性能指标统计正常工作");
  });
});

// 运行所有测试
if (import.meta.main) {
  await runAllTests();
}

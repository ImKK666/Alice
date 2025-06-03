// tests/test-framework.ts
/**
 * 增强的测试框架
 * 提供更好的测试组织和报告功能
 */

import { assertEquals, assertExists, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";

export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: Error;
  skipped?: boolean;
}

export interface TestSuite {
  name: string;
  tests: TestResult[];
  setup?: () => Promise<void> | void;
  teardown?: () => Promise<void> | void;
  beforeEach?: () => Promise<void> | void;
  afterEach?: () => Promise<void> | void;
}

export class TestRunner {
  private suites: TestSuite[] = [];
  private currentSuite: TestSuite | null = null;

  describe(name: string, fn: () => void): void {
    const suite: TestSuite = {
      name,
      tests: [],
    };
    
    this.suites.push(suite);
    this.currentSuite = suite;
    
    try {
      fn();
    } finally {
      this.currentSuite = null;
    }
  }

  beforeAll(fn: () => Promise<void> | void): void {
    if (this.currentSuite) {
      this.currentSuite.setup = fn;
    }
  }

  afterAll(fn: () => Promise<void> | void): void {
    if (this.currentSuite) {
      this.currentSuite.teardown = fn;
    }
  }

  beforeEach(fn: () => Promise<void> | void): void {
    if (this.currentSuite) {
      this.currentSuite.beforeEach = fn;
    }
  }

  afterEach(fn: () => Promise<void> | void): void {
    if (this.currentSuite) {
      this.currentSuite.afterEach = fn;
    }
  }

  it(name: string, fn: () => Promise<void> | void): void {
    if (!this.currentSuite) {
      throw new Error('测试必须在 describe 块内定义');
    }

    // 创建测试占位符，实际执行在 run() 时进行
    this.currentSuite.tests.push({
      name,
      passed: false,
      duration: 0,
      error: undefined,
    });

    // 存储测试函数以便后续执行
    (this.currentSuite.tests[this.currentSuite.tests.length - 1] as any).fn = fn;
  }

  skip(name: string, _fn: () => Promise<void> | void): void {
    if (!this.currentSuite) {
      throw new Error('测试必须在 describe 块内定义');
    }

    this.currentSuite.tests.push({
      name,
      passed: true,
      duration: 0,
      skipped: true,
    });
  }

  async run(): Promise<void> {
    console.log('🧪 开始运行测试套件...\n');
    
    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;
    let skippedTests = 0;
    const startTime = performance.now();

    for (const suite of this.suites) {
      console.log(`📋 测试套件: ${suite.name}`);
      
      try {
        // 运行 setup
        if (suite.setup) {
          await suite.setup();
        }

        for (const test of suite.tests) {
          totalTests++;
          
          if (test.skipped) {
            skippedTests++;
            console.log(`  ⏭️  ${test.name} (跳过)`);
            continue;
          }

          const testFn = (test as any).fn;
          if (!testFn) continue;

          try {
            // 运行 beforeEach
            if (suite.beforeEach) {
              await suite.beforeEach();
            }

            const testStartTime = performance.now();
            await testFn();
            const testEndTime = performance.now();
            
            test.duration = testEndTime - testStartTime;
            test.passed = true;
            passedTests++;
            
            console.log(`  ✅ ${test.name} (${test.duration.toFixed(2)}ms)`);

            // 运行 afterEach
            if (suite.afterEach) {
              await suite.afterEach();
            }
          } catch (error) {
            test.passed = false;
            test.error = error as Error;
            failedTests++;
            
            console.log(`  ❌ ${test.name}`);
            console.log(`     错误: ${error instanceof Error ? error.message : String(error)}`);
            
            // 即使测试失败也要运行 afterEach
            if (suite.afterEach) {
              try {
                await suite.afterEach();
              } catch (afterEachError) {
                console.log(`     afterEach 错误: ${afterEachError instanceof Error ? afterEachError.message : String(afterEachError)}`);
              }
            }
          }
        }

        // 运行 teardown
        if (suite.teardown) {
          await suite.teardown();
        }
      } catch (error) {
        console.log(`  💥 套件设置/清理错误: ${error instanceof Error ? error.message : String(error)}`);
        failedTests += suite.tests.filter(t => !t.skipped).length;
      }
      
      console.log('');
    }

    const endTime = performance.now();
    const totalDuration = endTime - startTime;

    // 输出测试报告
    console.log('📊 测试报告');
    console.log('='.repeat(50));
    console.log(`总测试数: ${totalTests}`);
    console.log(`✅ 通过: ${passedTests}`);
    console.log(`❌ 失败: ${failedTests}`);
    console.log(`⏭️  跳过: ${skippedTests}`);
    console.log(`⏱️  总耗时: ${totalDuration.toFixed(2)}ms`);
    console.log(`📈 成功率: ${totalTests > 0 ? ((passedTests / (totalTests - skippedTests)) * 100).toFixed(1) : 0}%`);
    
    if (failedTests > 0) {
      console.log('\n❌ 失败的测试:');
      for (const suite of this.suites) {
        for (const test of suite.tests) {
          if (!test.passed && !test.skipped) {
            console.log(`  - ${suite.name} > ${test.name}`);
            if (test.error) {
              console.log(`    ${test.error.message}`);
            }
          }
        }
      }
      
      throw new Error(`${failedTests} 个测试失败`);
    }
  }

  getResults(): { suites: TestSuite[]; summary: { total: number; passed: number; failed: number; skipped: number } } {
    let total = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const suite of this.suites) {
      for (const test of suite.tests) {
        total++;
        if (test.skipped) {
          skipped++;
        } else if (test.passed) {
          passed++;
        } else {
          failed++;
        }
      }
    }

    return {
      suites: this.suites,
      summary: { total, passed, failed, skipped },
    };
  }
}

// 全局测试运行器实例
export const testRunner = new TestRunner();

// 导出便捷函数
export const describe = testRunner.describe.bind(testRunner);
export const it = testRunner.it.bind(testRunner);
export const skip = testRunner.skip.bind(testRunner);
export const beforeAll = testRunner.beforeAll.bind(testRunner);
export const afterAll = testRunner.afterAll.bind(testRunner);
export const beforeEach = testRunner.beforeEach.bind(testRunner);
export const afterEach = testRunner.afterEach.bind(testRunner);

// 导出断言函数
export { assertEquals, assertExists, assertRejects };

// 运行所有测试的便捷函数
export async function runAllTests(): Promise<void> {
  await testRunner.run();
}

// src/stm_manager_test.ts

import {
  describe,
  it,
  beforeEach,
  afterEach,
} from "https://deno.land/std@0.204.0/testing/bdd.ts"; // Using a slightly older version for broader compatibility if needed, or update to latest.
import {
  assertEquals,
  assertRejects,
  assertSpyCall,
  assertSpyCalls,
  spy,
  stub,
} from "https://deno.land/std@0.204.0/testing/mock.ts";
import {
  getStm,
  updateStm,
  STM_MAX_MESSAGES,
  type PlatformAPI,
} from "./stm_manager.ts";
import { config } from "./config.ts";
import { kvHolder } from "./main.ts"; // Assuming main.ts exports kvHolder
import type { ChatMessageInput } from "./memory_processor.ts";
import { BaseError, KVStoreError } from "./errors.ts";


// Helper function to create mock messages
const createMockMessage = (id: number, text: string): ChatMessageInput => ({
  userId: `user${id}`,
  contextId: `context${id}`,
  messageId: `msg${id}`,
  timestamp: Date.now() + id * 1000,
  text,
});

describe("STM Manager", () => {
  let originalStmHistoryMode: "kv" | "platform";
  let originalKvInstance: typeof kvHolder.instance | undefined;

  beforeEach(() => {
    originalStmHistoryMode = config.stmHistoryMode;
    originalKvInstance = kvHolder.instance;
    // Ensure kvHolder.instance is reset for each test if it's manipulated
    kvHolder.instance = undefined; 
  });

  afterEach(() => {
    config.stmHistoryMode = originalStmHistoryMode;
    kvHolder.instance = originalKvInstance;
  });

  describe("getStm", () => {
    const mockContextId = "test_context";

    it("KV Mode: should call kvHolder.instance.get and return data from KV", async () => {
      config.stmHistoryMode = "kv";
      const mockKvData: ChatMessageInput[] = [createMockMessage(1, "Hello from KV")];
      const getSpy = spy(async () => ({ value: mockKvData, versionstamp: "v1" }));
      kvHolder.instance = { get: getSpy } as any;

      const result = await getStm(mockContextId);

      assertSpyCall(getSpy, 0, { args: [["stm", mockContextId]] });
      assertEquals(result, mockKvData);
    });
    
    it("KV Mode: should return empty array if KV data is null/undefined", async () => {
        config.stmHistoryMode = "kv";
        const getSpy = spy(async () => ({ value: null, versionstamp: "v1" }));
        kvHolder.instance = { get: getSpy } as any;

        const result = await getStm(mockContextId);
        assertSpyCall(getSpy, 0, { args: [["stm", mockContextId]] });
        assertEquals(result, []);
    });

    it("Platform Mode: should call platformApi.fetchHistory and return its data", async () => {
      config.stmHistoryMode = "platform";
      const mockPlatformData: ChatMessageInput[] = [createMockMessage(2, "Hello from Platform")];
      const fetchHistorySpy = spy(async () => mockPlatformData);
      const platformApi: PlatformAPI = { fetchHistory: fetchHistorySpy };
      const kvGetSpy = spy();
      kvHolder.instance = { get: kvGetSpy } as any;


      const result = await getStm(mockContextId, platformApi);

      assertSpyCall(fetchHistorySpy, 0, { args: [mockContextId, STM_MAX_MESSAGES] });
      assertEquals(result, mockPlatformData);
      assertEquals(kvGetSpy.calls.length, 0); // Ensure KV was not called
    });

    it("Platform Mode: should return [] if fetchHistory returns null, and not call KV", async () => {
      config.stmHistoryMode = "platform";
      const fetchHistorySpy = spy(async () => null);
      const platformApi: PlatformAPI = { fetchHistory: fetchHistorySpy };
      const kvGetSpy = spy();
      kvHolder.instance = { get: kvGetSpy } as any;

      const result = await getStm(mockContextId, platformApi);

      assertSpyCall(fetchHistorySpy, 0, { args: [mockContextId, STM_MAX_MESSAGES] });
      assertEquals(result, []);
      assertEquals(kvGetSpy.calls.length, 0); // Ensure KV was not called
    });

    it("Platform Mode: should fallback to KV if platformApi is undefined", async () => {
      config.stmHistoryMode = "platform";
      const mockKvData: ChatMessageInput[] = [createMockMessage(3, "Fallback to KV")];
      const kvGetSpy = spy(async () => ({ value: mockKvData, versionstamp: "v1" }));
      kvHolder.instance = { get: kvGetSpy } as any;

      const result = await getStm(mockContextId, undefined);

      assertSpyCall(kvGetSpy, 0, { args: [["stm", mockContextId]] });
      assertEquals(result, mockKvData);
    });

    it("Platform Mode: should fallback to KV if platformApi.fetchHistory is missing", async () => {
      config.stmHistoryMode = "platform";
      const mockKvData: ChatMessageInput[] = [createMockMessage(4, "Fallback to KV no fetchHistory")];
      const kvGetSpy = spy(async () => ({ value: mockKvData, versionstamp: "v1" }));
      kvHolder.instance = { get: kvGetSpy } as any;
      const platformApi = {} as PlatformAPI; // Missing fetchHistory

      const result = await getStm(mockContextId, platformApi);

      assertSpyCall(kvGetSpy, 0, { args: [["stm", mockContextId]] });
      assertEquals(result, mockKvData);
    });
    
    it("KV Mode: should return empty array and log warning if kvHolder.instance is null", async () => {
        config.stmHistoryMode = "kv";
        kvHolder.instance = undefined; // Ensure it's undefined
        const consoleWarnSpy = spy(console, "warn");

        const result = await getStm(mockContextId);

        assertEquals(result, []);
        assertSpyCall(consoleWarnSpy, 0, {
            args: ["[STM][日志] KV 未初始化，无法获取 STM。"],
        });
        consoleWarnSpy.restore();
    });

    it("Platform Mode: fallback to KV should return empty array and log warning if kvHolder.instance is null", async () => {
        config.stmHistoryMode = "platform";
        kvHolder.instance = undefined; // Ensure it's undefined
        const consoleWarnSpy = spy(console, "warn");

        // Trigger fallback by providing an invalid platformApi
        const result = await getStm(mockContextId, {} as PlatformAPI);

        assertEquals(result, []);
        assertSpyCall(consoleWarnSpy, 0, {
            args: ["[STM][日志] KV 未初始化，无法获取 STM。"],
        });
        consoleWarnSpy.restore();
    });
  });

  describe("updateStm", () => {
    const mockContextId = "test_update_context";
    const newMessage = createMockMessage(100, "New message");

    it("KV Mode: should call atomic operations and return pruned list", async () => {
      config.stmHistoryMode = "kv";
      const initialKvStm: ChatMessageInput[] = Array.from({ length: STM_MAX_MESSAGES - 5 }, (_, i) => createMockMessage(i, `Old ${i}`));
      const expectedPrunedStm = [...initialKvStm.slice(-(STM_MAX_MESSAGES - 1)), newMessage];

      const getSpy = spy(async () => ({ value: initialKvStm, versionstamp: "v1" }));
      const setSpy = spy();
      const commitSpy = spy(async () => ({ ok: true }));
      const checkSpy = spy(() => ({ set: setSpy }));
      const atomicSpy = stub(kvHolder, "atomic", () => ({ check: checkSpy, commit: commitSpy } as any));
      
      kvHolder.instance = { 
        get: getSpy,
        atomic: atomicSpy,
      } as any;


      const result = await updateStm(mockContextId, newMessage);
      
      assertSpyCall(getSpy, 0); // get is called inside the loop
      assertSpyCall(atomicSpy, 0);
      assertSpyCall(checkSpy, 0);
      assertSpyCall(setSpy, 0, { args: [["stm", mockContextId], expectedPrunedStm] });
      assertSpyCall(commitSpy, 0);
      assertEquals(result, expectedPrunedStm);

      atomicSpy.restore(); // Important to restore stubs on kvHolder
    });
    
    it("KV Mode: should handle KV update failure and return best-effort STM", async () => {
        config.stmHistoryMode = "kv";
        const initialKvStm: ChatMessageInput[] = [createMockMessage(1, "Old message")];
        const consoleErrorSpy = spy(console, "error");
        const consoleWarnSpy = spy(console, "warn");
    
        const getSpy = spy(async () => ({ value: initialKvStm, versionstamp: "v1" }));
        const commitSpy = spy(async () => ({ ok: false })); // Simulate commit failure
        const checkSpy = spy(() => ({ set: spy() }));
        const atomicSpy = stub(kvHolder, "atomic", () => ({ check: checkSpy, commit: commitSpy } as any));
    
        kvHolder.instance = {
          get: getSpy,
          atomic: atomicSpy,
        } as any;
    
        // currentTurnStm is not passed in KV mode from outside, it's fetched
        const expectedFallbackStm = [...initialKvStm, newMessage].slice(-STM_MAX_MESSAGES);
    
        const result = await updateStm(mockContextId, newMessage);
    
        assertSpyCalls(commitSpy, 3); // Should retry 3 times
        assertEquals(result, expectedFallbackStm); // Should return the STM based on last KV read + new message
        assertSpyCall(consoleErrorSpy, 0, {
            args: [`❌ [STM][错误] STM KV 更新失败 (上下文 ${mockContextId})，已达最大尝试次数。返回基于KV最后一次读取状态的STM。`],
        });
    
        consoleErrorSpy.restore();
        consoleWarnSpy.restore();
        atomicSpy.restore();
      });


    it("Platform Mode: should not call KV methods and return pruned list (currentTurnStm undefined)", async () => {
      config.stmHistoryMode = "platform";
      const kvAtomicSpy = spy();
      kvHolder.instance = { atomic: kvAtomicSpy } as any;

      const expectedStm = [newMessage];
      const result = await updateStm(mockContextId, newMessage, undefined);

      assertEquals(kvAtomicSpy.calls.length, 0);
      assertEquals(result, expectedStm);
    });

    it("Platform Mode: should return pruned list (currentTurnStm empty)", async () => {
      config.stmHistoryMode = "platform";
      const currentTurnStm: ChatMessageInput[] = [];
      const expectedStm = [newMessage];
      const result = await updateStm(mockContextId, newMessage, currentTurnStm);
      assertEquals(result, expectedStm);
    });

    it("Platform Mode: should return pruned list (currentTurnStm partially full)", async () => {
      config.stmHistoryMode = "platform";
      const currentTurnStm: ChatMessageInput[] = Array.from({ length: 5 }, (_, i) => createMockMessage(i, `Msg ${i}`));
      const expectedStm = [...currentTurnStm, newMessage];
      const result = await updateStm(mockContextId, newMessage, currentTurnStm);
      assertEquals(result, expectedStm);
    });

    it("Platform Mode: should return pruned list (currentTurnStm full, respects STM_MAX_MESSAGES)", async () => {
      config.stmHistoryMode = "platform";
      const currentTurnStm: ChatMessageInput[] = Array.from({ length: STM_MAX_MESSAGES }, (_, i) => createMockMessage(i, `Full ${i}`));
      const expectedStm = [...currentTurnStm.slice(1), newMessage]; // Oldest one removed
      
      assertEquals(currentTurnStm.length, STM_MAX_MESSAGES);
      assertEquals(expectedStm.length, STM_MAX_MESSAGES);

      const result = await updateStm(mockContextId, newMessage, currentTurnStm);
      assertEquals(result, expectedStm);
    });
    
    it("KV Mode: should return [newMessage] and log warning if kvHolder.instance is null", async () => {
        config.stmHistoryMode = "kv";
        kvHolder.instance = undefined;
        const consoleWarnSpy = spy(console, "warn");
        const currentTurnStmForKvMode = undefined; // Not applicable directly, but updateStm handles it

        const result = await updateStm(mockContextId, newMessage, currentTurnStmForKvMode);
        
        // The behavior is it constructs a pruned STM with just the new message if currentTurnStm is not provided
        const expectedStm = [newMessage].slice(-STM_MAX_MESSAGES);


        assertEquals(result, expectedStm);
        assertSpyCall(consoleWarnSpy, 0, {
            args: ["[STM][日志] KV 未初始化，无法更新 STM。将仅返回新消息和传入的STM（如有）。"],
        });
        consoleWarnSpy.restore();
    });
  });
});

// Run tests: deno test src/stm_manager_test.ts --allow-read --allow-env
// The --allow-env is for config loading, --allow-read for .env file.
// Depending on how kvHolder is initialized (e.g. if it tries to connect),
// other permissions might be needed or more extensive mocking.
// For this test, we primarily mock kvHolder.instance directly.

// To handle potential Deno KV connection errors if kvHolder.instance is not mocked early enough
// or if some code path tries to use a real KV connection:
// It's good practice to ensure that kvHolder.instance is set to a mock or undefined
// *before* any tested function that might use it is called.
// The beforeEach hook handles this by setting kvHolder.instance = undefined initially.
// If main.ts initializes kvHolder.instance on import, that could be an issue.
// Assuming kvHolder is an object { instance: Deno.Kv | undefined }
// and main.ts does something like:
// export const kvHolder: { instance: Deno.Kv | undefined } = { instance: undefined };
// export async function initializeKv() { if (!kvHolder.instance) kvHolder.instance = await Deno.openKv(); }
// Then the tests should be fine as long as initializeKv() is not called automatically.
// If Deno.openKv() is called at the top level of main.ts, we'd need to mock Deno.openKv itself.
// For these tests, direct manipulation of kvHolder.instance is assumed to be sufficient.

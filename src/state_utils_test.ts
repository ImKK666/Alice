// src/state_utils_test.ts

import { assertEquals, assertArrayIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { updateActiveUserContexts } from "./state_utils.ts";

Deno.test("updateActiveUserContexts should manage user contexts correctly", () => {
  let activeUserContextsMap: Map<string, string[]>;

  // Scenario 1: New user, new context
  activeUserContextsMap = new Map<string, string[]>();
  updateActiveUserContexts(activeUserContextsMap, "user1", "context1");
  assertEquals(activeUserContextsMap.get("user1"), ["context1"], "New user, new context: user1 has context1");
  assertEquals(activeUserContextsMap.size, 1, "New user, new context: map size is 1");

  // Scenario 2: Existing user, new context
  updateActiveUserContexts(activeUserContextsMap, "user1", "context2");
  assertEquals(activeUserContextsMap.get("user1"), ["context1", "context2"], "Existing user, new context: user1 has context1, context2");
  
  // Scenario 3: Existing user, duplicate context (should move to end)
  updateActiveUserContexts(activeUserContextsMap, "user1", "context1");
  assertEquals(activeUserContextsMap.get("user1"), ["context2", "context1"], "Existing user, duplicate context: context1 moved to end");

  // Scenario 4: New user, for context limit testing
  activeUserContextsMap.set("user2", []); // Initialize user2 for limit testing
  const user2Contexts = activeUserContextsMap.get("user2")!;

  // Add 9 contexts for user2
  for (let i = 1; i <= 9; i++) {
    updateActiveUserContexts(activeUserContextsMap, "user2", `ctx${i}`);
  }
  assertEquals(user2Contexts.length, 9, "Context limit: user2 has 9 contexts");
  assertEquals(user2Contexts[8], "ctx9", "Context limit: last added is ctx9");

  // Add 10th context for user2
  updateActiveUserContexts(activeUserContextsMap, "user2", "ctx10");
  assertEquals(user2Contexts.length, 10, "Context limit: user2 has 10 contexts after adding 10th");
  assertEquals(user2Contexts[9], "ctx10", "Context limit: last added is ctx10");
  assertArrayIncludes(user2Contexts, ["ctx1", "ctx10"], "Context limit: user2 includes ctx1 and ctx10");


  // Add 11th context for user2 - oldest (ctx1) should be removed
  updateActiveUserContexts(activeUserContextsMap, "user2", "ctx11");
  assertEquals(user2Contexts.length, 10, "Context limit: user2 still has 10 contexts after adding 11th");
  assertEquals(user2Contexts[0], "ctx2", "Context limit: oldest context ctx1 removed, ctx2 is now oldest");
  assertEquals(user2Contexts[9], "ctx11", "Context limit: newest context ctx11 is at the end");
  assertEquals(user2Contexts.includes("ctx1"), false, "Context limit: user2 no longer includes ctx1");
  assertArrayIncludes(user2Contexts, ["ctx2", "ctx11"], "Context limit: user2 includes ctx2 and ctx11");
  
  // Verify map size with two users
  assertEquals(activeUserContextsMap.size, 2, "Map size with two users");

  // Test adding to a different user doesn't affect the first
  updateActiveUserContexts(activeUserContextsMap, "user1", "context3");
  assertEquals(activeUserContextsMap.get("user1"), ["context2", "context1", "context3"], "User1 context update independent");
  assertEquals(activeUserContextsMap.get("user2")?.length, 10, "User2 context count unchanged");

});

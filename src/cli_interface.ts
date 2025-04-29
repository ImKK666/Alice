// src/cli_interface.ts (修改后 - 使用 social_cognition)
/**
 * CLI (Command Line Interface) 交互模块
 *
 * 负责处理用户在控制台的输入、特殊命令，并调用核心 RAG 逻辑。
 */

import { getStm, handleIncomingMessage, kv } from "./main.ts"; // 确保 kv 仍然从 main 导出或在这里直接初始化
import type { ChatMessageInput } from "./memory_processor.ts"; // 导入类型
// 导入时间感知模块的函数，用于清除时间上下文
import {
  getTemporalContext,
  updateTemporalContext,
} from "./time_perception.ts";
// --- 修改：导入新的社交认知模块 ---
import { getSocialCognitionManager } from "./social_cognition.ts"; // 导入新的社交认知管理器
// import { // 旧的社交动态导入 (注释掉)
//   getRelationshipState,
//   updateRelationshipState,
// } from "./social_dynamics.ts";
// --- 修改结束 ---
// 导入身体状态模块的函数，用于清除身体状态
import { getBodyState, updateBodyState } from "./virtual_embodiment.ts";

// --- 新增：获取社交认知管理器实例 ---
const socialCognition = getSocialCognitionManager();
// --- 新增结束 ---

/**
 * 启动命令行交互界面
 */
export async function startCli(): Promise<void> {
  console.log("\n▶️ 可以开始输入了。 输入 /exit 退出。");
  console.log("ℹ️ 输入内容将作为当前用户的消息发送。");
  console.log("ℹ️ 使用特殊命令进行操作：");
  console.log("    /user <新用户ID>    - 切换当前用户");
  console.log(
    "    /context <上下文ID> - 切换/手动设置当前RAG上下文 (会覆盖自动判断)",
  );
  console.log("    /whoami             - 查看当前用户和上下文");
  console.log("    /stm                - 查看当前RAG上下文的 STM (最近消息)");
  console.log("    /clearstm           - 清除当前RAG上下文的 STM");
  console.log(
    "    /clearstate         - 清除当前用户在此上下文的所有状态 (STM, Time, Body, Relationship)",
  );
  console.log(
    "    /getstate <type>    - 查看当前用户在此上下文的指定状态 (time, body, relationship)",
  );
  console.log("    /exit               - 退出程序");

  let currentUserId = "UserCLI"; // CLI 默认用户
  // 初始上下文ID，后续会被 handleIncomingMessage 的返回值更新
  let currentRAGContextId = "cli_default_context";

  console.log(
    `▶️ 初始用户: ${currentUserId}, 初始RAG上下文: ${currentRAGContextId}`,
  );
  console.log("----------------------------------------------");

  while (true) {
    // Prompt 显示当前状态
    const promptPrefix = `[${currentUserId}@${currentRAGContextId}]`;
    const userInput = prompt(`${promptPrefix} > `); // 使用 Deno 的 prompt

    if (userInput === null || userInput.trim().toLowerCase() === "/exit") {
      if (userInput === null) console.log("\n⚠️ 输入中断 (null)。");
      break; // 退出循环
    }

    const trimmedInput = userInput.trim();

    // --- 处理特殊命令 ---
    if (trimmedInput.startsWith("/")) {
      const parts = trimmedInput.split(" ");
      const command = parts[0].toLowerCase();
      const arg1 = parts[1];
      // const argRest = parts.slice(1).join(" "); // 如果需要多个参数

      try { // 包裹命令处理逻辑以捕获错误
        switch (command) {
          case "/user":
            if (arg1) {
              currentUserId = arg1;
              currentRAGContextId = `cli_${currentUserId}_context`;
              console.log(
                `✅ 用户切换为: ${currentUserId}, 上下文重置为: ${currentRAGContextId}`,
              );
            } else console.log("用法: /user <新用户ID>");
            break;
          case "/context":
            if (arg1) {
              currentRAGContextId = arg1;
              console.log(`✅ RAG 上下文手动设置为: ${currentRAGContextId}`);
            } else console.log("用法: /context <新上下文ID>");
            break;
          case "/whoami":
            console.log(
              `ℹ️ 当前用户: ${currentUserId}, RAG 上下文: ${currentRAGContextId}`,
            );
            break;
          case "/stm": {
            if (!kv) {
              console.log("⚠️ STM (KV) 未初始化。");
              break;
            }
            const stm = await getStm(currentRAGContextId);
            console.log(
              `📝 STM 内容 (${currentRAGContextId}, ${stm.length} 条):`,
            );
            if (stm.length > 0) {
              stm.forEach((m, i) =>
                console.log(`  [${i}] ${m.userId}: ${m.text}`)
              );
            } else {
              console.log("  (当前上下文无 STM 记录)");
            }
            break;
          }
          case "/clearstm": {
            if (!kv) {
              console.log("⚠️ STM (KV) 未初始化。");
              break;
            }
            await kv.delete(["stm", currentRAGContextId]);
            console.log(`✅ STM 已清除 (${currentRAGContextId})。`);
            break;
          }
          case "/clearstate": {
            if (!kv) {
              console.log("⚠️ KV 未初始化，无法清除状态。");
              break;
            }
            console.log(
              `⚠️ 准备清除用户 ${currentUserId} 在上下文 ${currentRAGContextId} 的所有状态...`,
            );
            await kv.delete(["stm", currentRAGContextId]);
            console.log("  - STM 已清除。");
            await kv.delete([
              "temporal_context",
              currentUserId,
              currentRAGContextId,
            ]);
            console.log("  - 时间上下文已清除。");
            await kv.delete(["body_state", currentUserId, currentRAGContextId]);
            console.log("  - 虚拟身体状态已清除。");
            // --- 修改：使用新的社交认知模块的键前缀来清除关系状态 ---
            // 注意：关系状态现在是 Alice <-> entityId，所以清除时需要用 ('alice', currentUserId)
            const aliceId = "alice"; // 假设 Alice 的固定 ID 是 'alice'
            await kv.delete(["social_relationship", aliceId, currentUserId]);
            console.log(`  - 与用户 ${currentUserId} 的关系状态已重置。`);
            // --- 修改结束 ---
            await kv.delete([
              "last_wandering_time",
              currentUserId,
              currentRAGContextId,
            ]);
            console.log("  - 上次思维漫游时间已清除。");
            console.log("✅ 所有相关状态已清除/重置。");
            break;
          }
          case "/getstate": {
            if (!kv) {
              console.log("⚠️ KV 未初始化，无法获取状态。");
              break;
            }
            if (!arg1) {
              console.log(
                "用法: /getstate <type> (type可以是 time, body, relationship)",
              );
              break;
            }
            const stateType = arg1.toLowerCase();
            console.log(
              `🔍 获取状态: ${stateType} (用户: ${currentUserId}, 上下文: ${currentRAGContextId})`,
            );
            let stateData;
            switch (stateType) {
              case "time":
                stateData = await getTemporalContext(
                  currentUserId,
                  currentRAGContextId,
                  kv,
                );
                break;
              case "body":
                stateData = await getBodyState(
                  currentUserId,
                  currentRAGContextId,
                  kv,
                );
                break;
              case "relationship":
                // --- 修改：使用新的社交认知模块获取关系状态 ---
                // getRelationshipState 现在需要传入 entityId (即对方用户 ID)
                stateData = await socialCognition.getRelationshipState(
                  currentUserId,
                );
                // --- 修改结束 ---
                break;
              default:
                console.log(
                  "⚠️ 未知的状态类型。可用类型: time, body, relationship",
                );
                stateData = null;
            }
            if (stateData) {
              console.log(JSON.stringify(stateData, null, 2));
            } else {
              console.log(`  (未找到 ${stateType} 状态)`);
            }
            break;
          }
          case "/exit":
            break;
          default:
            console.log("⚠️ 未知命令。");
        }
      } catch (cmdError) {
        console.error(`❌ 处理命令 ${command} 时出错:`, cmdError);
      }

      if (command === "/exit") break; // 退出主循环
      console.log("----------------------------------------------");
      continue; // 处理完命令，等待下一个输入
    }

    // --- 处理普通消息 ---
    if (!trimmedInput) continue; // 跳过空输入

    // 创建消息对象
    const message: ChatMessageInput = {
      userId: currentUserId,
      contextId: currentRAGContextId, // 使用 RAG 上下文 ID
      text: trimmedInput,
      timestamp: Date.now(),
    };

    try {
      // 调用核心处理函数，传入当前 RAG 上下文 ID
      const result = await handleIncomingMessage(
        message,
        currentRAGContextId, // 传递当前的 RAG 上下文状态
        "cli", // 平台标识
      );

      // 使用返回的、可能已更新的 RAG contextId 更新 CLI 的当前状态
      currentRAGContextId = result.newContextId;

      // 在CLI模式下，我们将回复打印到控制台
      console.log(`\n🤖 Alice: ${result.responseText}\n`);
    } catch (error) {
      console.error("❌ 处理消息时发生顶层错误:", error);
      console.log("\n🤖 Alice: [抱歉，处理时遇到错误...]\n");
    }
    console.log("----------------------------------------------");
  } // end while loop

  console.log("👋 正在退出 CLI...");
}

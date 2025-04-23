// src/cli_interface.ts
/**
 * CLI (Command Line Interface) 交互模块
 *
 * 负责处理用户在控制台的输入、特殊命令，并调用核心 RAG 逻辑。
 */

import { getStm, handleIncomingMessage, kv } from "./main.ts";
import type { ChatMessageInput } from "./memory_processor.ts"; // 导入类型

/**
 * 启动命令行交互界面
 */
export async function startCli(): Promise<void> {
  console.log("\n▶️ 可以开始输入了。 输入 /exit 退出。");
  console.log("ℹ️ 输入内容将作为当前用户的消息发送。");
  console.log("ℹ️ 使用特殊命令进行操作：");
  console.log("    /user <新用户ID>    - 切换当前用户");
  console.log(
    "    /context <新上下文ID> - 切换当前聊天上下文 (会覆盖自动判断)",
  );
  console.log("    /whoami             - 查看当前用户和上下文");
  console.log("    /stm                - 查看当前上下文的 STM (最近消息)");
  console.log("    /clearstm           - 清除当前上下文的 STM");
  console.log("    /exit               - 退出程序");

  let currentUserId = "UserCLI"; // CLI 默认用户
  let currentContextId = "cli_default_context"; // CLI 默认上下文

  console.log(`▶️ 当前用户: ${currentUserId}, 初始上下文: ${currentContextId}`);
  console.log("----------------------------------------------");

  while (true) {
    const promptPrefix = `[${currentUserId}@${currentContextId}]`; // 显示当前状态
    const userInput = prompt(`${promptPrefix} > `); // Deno 的 prompt

    if (userInput === null || userInput.trim().toLowerCase() === "/exit") {
      if (userInput === null) console.log("\n⚠️ 输入中断。");
      break; // 退出循环
    }

    const trimmedInput = userInput.trim();

    // --- 处理特殊命令 ---
    if (trimmedInput.startsWith("/")) {
      const parts = trimmedInput.split(" ");
      const command = parts[0].toLowerCase();
      const arg = parts.slice(1).join(" ");

      switch (command) {
        case "/user":
          if (arg) {
            currentUserId = arg;
            console.log(`✅ 用户切换为: ${currentUserId}`);
          } else console.log("用法: /user <新用户ID>");
          break;
        case "/context": // 手动覆盖当前上下文
          if (arg) {
            currentContextId = arg;
            console.log(`✅ 上下文手动设置为: ${currentContextId}`);
          } else console.log("用法: /context <新上下文ID>");
          break;
        case "/whoami":
          console.log(
            `ℹ️ 当前用户: ${currentUserId}, 上下文: ${currentContextId}`,
          );
          break;
        case "/stm": {
          if (!kv) {
            console.log("⚠️ STM (KV) 未初始化。");
            break;
          }
          try {
            const stm = await getStm(currentContextId);
            console.log(`📝 STM 内容 (${currentContextId}, ${stm.length} 条):`);
            stm.forEach((m, i) =>
              console.log(`  [${i}] ${m.userId}: ${m.text}`)
            );
          } catch (e) {
            console.error("❌ 获取 STM 时出错:", e);
          }
          break;
        }
        case "/clearstm": {
          if (kv) {
            try {
              await kv.delete(["stm", currentContextId]);
              console.log(`✅ STM 已清除 (${currentContextId})。`);
            } catch (e) {
              console.error("❌ 清除 STM 时出错:", e);
            }
          } else console.log("⚠️ STM (KV) 未初始化。");
          break;
        }
        case "/exit": // 这个 break 会跳出 switch, 外层 while 条件处理退出
          break;
        default:
          console.log("⚠️ 未知命令。");
      }
      if (command === "/exit") break; // 退出主循环
      console.log("----------------------------------------------");
      continue; // 继续等待下一个输入
    }

    // --- 处理普通消息 ---
    if (!trimmedInput) continue; // 跳过空输入

    const message: ChatMessageInput = {
      userId: currentUserId,
      contextId: currentContextId, // 传递当前的 contextId 给处理函数
      text: trimmedInput,
      timestamp: Date.now(),
    };

    try {
      // 调用核心处理函数，传入当前 contextId
      // 注意：handleIncomingMessage 现在会返回新的 contextId
      const result = await handleIncomingMessage(
        message,
        currentContextId,
        "cli",
      );

      // 使用返回的、可能已更新的 contextId 更新 CLI 的当前状态
      currentContextId = result.newContextId;
      // CLI 模式下，我们通常直接在 handleIncomingMessage 内部打印回复，
      // 但如果 handleIncomingMessage 不打印了，需要在这里打印 result.responseText
      // (根据后续 main.ts 的重构决定)
      // console.log(result.responseText); // 如果需要在这里打印
    } catch (error) {
      console.error("❌ 处理消息时发生顶层错误:", error);
    }
    console.log("----------------------------------------------");
  } // end while loop
}

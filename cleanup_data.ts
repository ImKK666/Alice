// cleanup_data.ts

import { config } from "./src/config.ts"; // 导入配置以获取 Qdrant 地址和集合名称
import { QdrantClient } from "npm:@qdrant/js-client-rest"; // 导入 Qdrant 客户端
import { Schemas } from "npm:@qdrant/js-client-rest"; // 导入类型

// --- Deno KV 清理 ---

async function clearDenoKvPrefixes() {
  console.log("🧹 开始清理 Deno KV 数据...");
  let kv: Deno.Kv | null = null;
  try {
    kv = await Deno.openKv();
    console.log("✅ Deno KV 连接成功。");

    // 定义需要清理的 Key 前缀 (根据你的代码确定)
    const prefixesToClear: Array<string[]> = [
      ["stm"], // 短期记忆
      ["last_wandering_time"], // 思维漫游时间戳
      ["temporal_context"], // 时间感知上下文
      ["body_state"], // 虚拟身体状态
      ["social_relationship"], // 社交关系状态
      ["shared_experience"], // 共享经历
      ["relationship_milestone"], // 关系里程碑
      ["autobiographical_event"], // 自传事件
      ["self_aspiration"], // 自我愿景
      ["ethical_decision"], // 伦理决策
      ["memory_relation"], // 记忆关联
      ["memory_relations_from"], // 记忆关联索引
      ["memory_relations_to"], // 记忆关联索引
      ["memory_consolidation_task"], // 记忆巩固任务
      ["memory_task_schedule"], // 记忆任务调度
      // --- 注意：以下两个键可能需要保留 ---
      // ["self_model"],             // 自我模型 (通常只需要一个，可能不想删)
      // ["cognitive_state"],        // 整体认知状态 (可能只想重置部分)
    ];

    for (const prefix of prefixesToClear) {
      console.log(`  - 正在删除前缀: ${JSON.stringify(prefix)}...`);
      let count = 0;
      const iter = kv.list({ prefix }); // 获取该前缀下的所有条目
      for await (const entry of iter) {
        await kv.delete(entry.key);
        count++;
      }
      console.log(`    - 删除了 ${count} 条记录。`);
    }

    // 如果你想完全清空 Self Model 和 Cognitive State，取消下面的注释
    // console.log("  - 正在删除 self_model...");
    // await kv.delete(["self_model", "primary"]);
    // console.log("  - 正在删除 cognitive_state...");
    // await kv.delete(["cognitive_state", "current"]);

    console.log("✅ Deno KV 相关数据清理完成。");
  } catch (error) {
    console.error("❌ 清理 Deno KV 时出错:", error);
  } finally {
    if (kv) {
      kv.close();
      console.log("ℹ️ Deno KV 连接已关闭。");
    }
  }
}

// --- Qdrant 清理 ---

async function clearQdrantCollection() {
  console.log(`🧹 开始清理 Qdrant 集合: ${config.qdrantCollectionName}...`);
  const client = new QdrantClient({ url: config.qdrantUrl });

  try {
    // 方案一：删除集合中的所有点 (保留集合结构)
    console.log(
      `  - 正在删除集合 "${config.qdrantCollectionName}" 中的所有点...`,
    );
    // 注意：Qdrant JS 客户端目前（截至上次我了解时）没有直接的 "delete all points" 方法。
    // 最常用的方法是删除并重建集合，或者使用一个永远为真的过滤器来删除（但可能效率不高）。
    // 这里我们采用删除并重建集合的方式，因为这通常更干净利落。

    // // （如果只想删除点，可以尝试用过滤器，但这可能很慢且不一定保证完全清空）
    // const alwaysTrueFilter: Schemas["Filter"] = { must: [{ /* 可以用一个必定存在的字段 */ has_id: ["00000000-0000-0000-0000-000000000000"]}]}; // 这是一个技巧，不保证完美
    // await client.delete(config.qdrantCollectionName, { filter: alwaysTrueFilter });

    // 方案二：删除整个集合，然后重建（推荐）
    console.log(`  - 正在删除集合 "${config.qdrantCollectionName}"...`);
    await client.deleteCollection(config.qdrantCollectionName);
    console.log(`  - 集合 "${config.qdrantCollectionName}" 已删除。`);

    console.log(`  - 正在重新创建集合 "${config.qdrantCollectionName}"...`);
    await client.createCollection(config.qdrantCollectionName, {
      vectors: {
        size: config.embeddingDimension,
        distance: "Cosine", // 确保与你的配置一致
      },
      // 如果之前有设置 payload_schema 或其他索引，这里也需要加上
    });
    console.log(`  - 集合 "${config.qdrantCollectionName}" 已重新创建。`);

    console.log(
      `✅ Qdrant 集合 "${config.qdrantCollectionName}" 清理并重建完成。`,
    );
  } catch (error) {
    // 检查是否是因为集合不存在而删除失败
    if (error?.status === 404 || String(error).includes("Not found")) {
      console.warn(
        `  - 集合 "${config.qdrantCollectionName}" 本身不存在，无需删除。尝试创建...`,
      );
      // 如果删除失败是因为集合不存在，直接尝试创建
      try {
        await client.createCollection(config.qdrantCollectionName, {
          vectors: {
            size: config.embeddingDimension,
            distance: "Cosine",
          },
        });
        console.log(`  - 集合 "${config.qdrantCollectionName}" 已创建。`);
        console.log(
          `✅ Qdrant 集合 "${config.qdrantCollectionName}" 清理（实际为创建）完成。`,
        );
      } catch (createError) {
        console.error(
          `❌ 重新创建 Qdrant 集合 "${config.qdrantCollectionName}" 时出错:`,
          createError,
        );
      }
    } else {
      console.error(
        `❌ 清理或重建 Qdrant 集合 "${config.qdrantCollectionName}" 时出错:`,
        error,
      );
    }
  }
}

// --- 主执行逻辑 ---

async function runCleanup() {
  console.log("=====================================");
  console.log("  Alice AI 数据清理脚本");
  console.log("=====================================");
  console.warn("⚠️ 警告：此脚本将删除 Deno KV 和 Qdrant 中的数据！");

  const confirmation = prompt("❓ 是否确定要继续？(输入 'yes' 确认):");

  if (confirmation?.toLowerCase() !== "yes") {
    console.log("🛑 操作已取消。");
    return;
  }

  await clearDenoKvPrefixes();
  console.log("-------------------------------------");
  await clearQdrantCollection();
  console.log("=====================================");
  console.log("✅ 所有清理操作已完成。");
}

// --- 脚本入口 ---
if (import.meta.main) {
  runCleanup().catch((err) => {
    console.error("❌ 清理脚本执行过程中发生未捕获错误:", err);
    Deno.exit(1);
  });
} else {
  // 如果这个文件被其他模块导入，可以导出函数供调用
  // export { clearDenoKvPrefixes, clearQdrantCollection };
  console.log("ℹ️ 清理脚本被导入，未自动执行。");
}

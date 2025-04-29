// src/utils.ts

/**
 * 从指定的 JSON 文件路径加载停用词。
 * @param filePath JSON 文件的路径 (例如: "./data/stopwords-zh.json")
 * @returns 一个 Promise，解析为一个包含停用词的 Set<string>。
 * @throws 如果文件无法读取或解析。
 */
export async function loadStopwordsFromFile(
  filePath: string,
): Promise<Set<string>> {
  try {
    console.log(`🔄 正在从以下路径加载停用词: ${filePath}...`);
    const fileContent = await Deno.readTextFile(filePath); // 读取文件内容
    const stopwordsArray: string[] = JSON.parse(fileContent); // 解析 JSON

    // 验证是否为字符串数组
    if (
      !Array.isArray(stopwordsArray) ||
      !stopwordsArray.every((item) => typeof item === "string")
    ) {
      throw new Error("无效的 JSON 格式：应为字符串数组。");
    }

    const stopwordsSet = new Set(stopwordsArray); // 创建 Set 以提高查找效率
    console.log(`✅ 成功加载 ${stopwordsSet.size} 个停用词。`);
    return stopwordsSet;
  } catch (error) {
    console.error(`❌ 从 ${filePath} 加载停用词时出错:`, error);
    // 处理错误：可以选择重新抛出错误、返回空集合或使用默认集合
    console.warn("⚠️ 因加载错误，将返回空的停用词集合。");
    // throw error; // 如果停用词是关键的，则取消注释以抛出错误
    return new Set<string>(); // 或者返回一个最小的默认集合: new Set(['的', '了'])
  }
}

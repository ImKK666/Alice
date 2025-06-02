# Qdrant 向量数据库设置指南

## 🚨 问题描述

如果您看到以下错误：
```
❌ 检查集合 "rag_deno_collection" 时遇到预期之外的错误: Error: Bad Gateway
```

这意味着 Qdrant 向量数据库服务没有运行。

## 🛠️ 解决方案

### 方法 1: 使用提供的脚本（推荐）

1. **启动 Qdrant 服务**：
   ```bash
   # 双击运行或在命令行执行
   start-qdrant.bat
   ```

2. **检查服务状态**：
   ```bash
   # 验证 Qdrant 是否正常运行
   check-qdrant.bat
   ```

### 方法 2: 手动使用 Docker

1. **启动 Qdrant 容器**：
   ```bash
   docker run -d --name qdrant -p 6333:6333 -p 6334:6334 qdrant/qdrant:latest
   ```

2. **验证服务**：
   - 访问 Web UI: http://localhost:6333/dashboard
   - 检查 API: http://localhost:6333/collections

### 方法 3: 下载独立版本

如果您没有 Docker，可以下载 Qdrant 的独立可执行文件：
- 访问: https://github.com/qdrant/qdrant/releases
- 下载适合您系统的版本
- 运行可执行文件

## 🔧 配置说明

项目会自动：
1. 检查 `rag_deno_collection` 集合是否存在
2. 如果不存在，自动创建集合
3. 设置向量维度为 1024（与 bge-m3 模型匹配）
4. 使用余弦距离作为相似度度量

## 📋 验证步骤

1. **检查端口**：确保端口 6333 被占用
2. **访问 Web UI**：http://localhost:6333/dashboard
3. **运行项目**：
   ```bash
   deno run --allow-all src/main.ts
   ```

## 🐛 常见问题

### Q: Docker 未安装怎么办？
A: 安装 Docker Desktop 或下载 Qdrant 独立版本

### Q: 端口被占用怎么办？
A: 修改 .env 文件中的 QDRANT_URL 配置

### Q: 服务启动但无法连接？
A: 检查防火墙设置，确保端口 6333 可访问

## 📞 获取帮助

如果仍有问题：
1. 检查 Docker 日志: `docker logs qdrant`
2. 访问 Qdrant 文档: https://qdrant.tech/documentation/
3. 确认配置文件 .env 中的 QDRANT_URL 设置正确

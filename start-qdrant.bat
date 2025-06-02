@echo off
echo 🚀 启动 Qdrant 向量数据库...
echo.

REM 检查 Docker 是否安装
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker 未安装或未在 PATH 中找到
    echo 请先安装 Docker Desktop: https://www.docker.com/products/docker-desktop
    echo.
    echo 或者您可以下载 Qdrant 的独立版本:
    echo https://github.com/qdrant/qdrant/releases
    pause
    exit /b 1
)

echo ✅ Docker 已安装，正在启动 Qdrant...
echo.

REM 停止并删除现有的 Qdrant 容器（如果存在）
echo 🔄 清理现有容器...
docker stop qdrant 2>nul
docker rm qdrant 2>nul

REM 启动 Qdrant 容器
echo 🚀 启动新的 Qdrant 容器...
docker run -d ^
  --name qdrant ^
  -p 6333:6333 ^
  -p 6334:6334 ^
  -v qdrant_storage:/qdrant/storage ^
  qdrant/qdrant:latest

if %errorlevel% equ 0 (
    echo.
    echo ✅ Qdrant 容器启动成功！
    echo 📍 Web UI: http://localhost:6333/dashboard
    echo 📍 API 端点: http://localhost:6333
    echo 📍 gRPC 端点: http://localhost:6334
    echo.
    echo ⏳ 等待服务完全启动...
    timeout /t 8 /nobreak >nul

    REM 检查服务是否响应
    echo 🔍 检查服务状态...
    curl -s http://localhost:6333/collections >nul 2>&1
    if %errorlevel% equ 0 (
        echo ✅ Qdrant 服务已就绪！
        echo.
        echo 🎯 现在您可以运行 Alice 项目了:
        echo    deno run --allow-all src/main.ts
    ) else (
        echo ⏳ 服务仍在启动中，请稍等片刻再运行项目...
        echo    您可以访问 http://localhost:6333/dashboard 检查状态
    )
) else (
    echo ❌ Qdrant 启动失败
    echo 请检查 Docker 是否正常运行
    echo 您可以尝试手动运行: docker run -p 6333:6333 qdrant/qdrant
)

echo.
echo 💡 提示: 按任意键关闭此窗口
pause >nul

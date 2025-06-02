@echo off
echo 🔍 检查 Qdrant 服务状态...
echo.

REM 检查端口是否被占用
echo 📡 检查端口 6333 是否被占用...
netstat -an | findstr :6333 >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ 端口 6333 正在被使用
) else (
    echo ❌ 端口 6333 未被占用，Qdrant 可能未启动
    goto :suggest_start
)

REM 检查 HTTP 服务是否响应
echo 🌐 检查 HTTP 服务是否响应...
curl -s http://localhost:6333/collections >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Qdrant HTTP 服务正常响应
    
    REM 获取集合列表
    echo.
    echo 📋 当前集合列表:
    curl -s http://localhost:6333/collections 2>nul | findstr "name"
    
    echo.
    echo 🎯 Qdrant 服务运行正常！
    echo 📍 Web UI: http://localhost:6333/dashboard
    echo 📍 API 文档: http://localhost:6333/docs
    
) else (
    echo ❌ Qdrant HTTP 服务无响应
    goto :suggest_start
)

goto :end

:suggest_start
echo.
echo 💡 建议操作:
echo 1. 运行 start-qdrant.bat 启动 Qdrant 服务
echo 2. 或手动运行: docker run -p 6333:6333 qdrant/qdrant
echo 3. 检查 Docker 是否正在运行
echo.

:end
echo.
pause

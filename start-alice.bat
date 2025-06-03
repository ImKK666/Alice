@echo off
echo 🚀 Alice AI 核心系统启动器
echo.

REM 检查 Deno 是否安装
deno --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Deno 未安装或未在 PATH 中找到
    echo 请先安装 Deno: https://deno.land/manual/getting_started/installation
    pause
    exit /b 1
)

echo ✅ Deno 已安装
echo.

REM 检查 .env 文件是否存在
if not exist ".env" (
    echo ❌ .env 文件不存在
    echo 请先复制 .env.template 为 .env 并配置必要的环境变量
    pause
    exit /b 1
)

echo ✅ 配置文件存在
echo.

echo 请选择启动模式:
echo 1. CLI 模式（命令行交互）
echo 2. Telegram Bot 模式
echo 3. Discord Bot 模式
echo 4. Discord + Telegram 双 Bot 模式
echo.

set /p choice=请输入选择 (1-4): 

if "%choice%"=="1" (
    echo.
    echo 🖥️ 启动 CLI 模式...
    deno run --allow-all --unstable-kv src/main.ts
) else if "%choice%"=="2" (
    echo.
    echo 🤖 启动 Telegram Bot 模式...
    deno run --allow-all --unstable-kv src/main.ts --telegram
) else if "%choice%"=="3" (
    echo.
    echo 🤖 启动 Discord Bot 模式...
    deno run --allow-all --unstable-kv src/main.ts --discord
) else if "%choice%"=="4" (
    echo.
    echo 🤖🤖 启动双 Bot 模式...
    deno run --allow-all --unstable-kv src/main.ts --discord --telegram
) else (
    echo.
    echo ❌ 无效选择，默认启动 CLI 模式
    echo.
    deno run --allow-all --unstable-kv src/main.ts
)

if %errorlevel% neq 0 (
    echo.
    echo ❌ 启动失败
    echo.
    echo 💡 常见问题解决方案:
    echo 1. 检查 .env 文件中的配置是否正确
    echo 2. 确保 Qdrant 服务正在运行（运行 start-qdrant.bat）
    echo 3. 检查网络连接
    echo 4. 验证 API 密钥是否有效
    echo.
)

pause

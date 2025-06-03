@echo off
echo 🚀 启动 Alice AI 核心 - Telegram Bot 模式
echo.

REM 检查 Deno 是否安装
deno --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Deno 未安装或未在 PATH 中找到
    echo 请先安装 Deno: https://deno.land/manual/getting_started/installation
    pause
    exit /b 1
)

echo ✅ Deno 已安装，正在启动 Alice AI...
echo.

REM 检查 .env 文件是否存在
if not exist ".env" (
    echo ❌ .env 文件不存在
    echo 请先复制 .env.template 为 .env 并配置必要的环境变量
    echo.
    echo 必需配置项:
    echo - TELEGRAM_BOT_TOKEN
    echo - DEEPSEEK_API_KEY
    echo - SILICONFLOW_API_KEY
    echo.
    pause
    exit /b 1
)

echo ✅ 配置文件存在，正在启动...
echo.

REM 启动 Alice AI Telegram Bot
echo 🤖 启动 Telegram Bot 模式...
echo 📍 使用正确的 Deno 参数（包含 --unstable-kv）
echo.

deno run --allow-all --unstable-kv src/main.ts --telegram

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
    pause
    exit /b 1
)

echo.
echo ✅ Alice AI Telegram Bot 已启动
pause

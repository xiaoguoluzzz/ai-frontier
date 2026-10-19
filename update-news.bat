@echo off
REM ============================================================
REM  AI Frontier - 数据更新脚本（本地可选机制）
REM  用途：双击运行 scripts/build-data.js，更新 data\*.json
REM  主机制是 GitHub Actions 每日构建（见 AUTO-UPDATE.md），
REM  本脚本用于本地预览或无法使用 Actions 时的备用。
REM  要求：已安装 Node.js（https://nodejs.org）
REM ============================================================

cd /d "%~dp0"

echo ==========================================
echo   AI Frontier 数据更新
echo   运行时间：%date% %time%
echo ==========================================

REM 检查 Node.js 是否安装
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo.
  echo [错误] 未检测到 Node.js，请先安装：https://nodejs.org
  pause
  exit /b 1
)

REM 执行全站数据构建（新闻 / 论文 / 排行榜）
node scripts\build-data.js

echo.
echo 更新完成：data\news.json、data\papers.json、data\leaderboards.json
echo 部署到 GitHub Pages 后线上页面将加载这些文件。
timeout /t 5 >nul

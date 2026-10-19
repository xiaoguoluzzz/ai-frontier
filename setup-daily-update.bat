@echo off
REM ============================================================
REM  注册 Windows 计划任务：每天本地更新 data\*.json（可选备用机制）
REM  主机制是 GitHub Actions 每日构建（.github\workflows\daily-update.yml），
REM  仅在无法使用 GitHub Actions 时才需要本计划任务。
REM  请右键"以管理员身份运行"，注册一次即可
REM ============================================================

echo.
echo 正在注册计划任务 "AI Frontier News Update"...
echo 任务将在每天 08:00 自动运行。
echo.
echo 注意：GitHub Actions 才是线上站点的主更新机制（免费、无需开机）。
echo 本计划任务仅作为本地备用，更新的是本地 data 文件，需手动 push 才会影响线上。
echo.

schtasks /create /tn "AI Frontier News Update" /tr "\"%~dp0update-news.bat\"" /sc daily /st 08:00 /f

if %errorlevel% equ 0 (
  echo.
  echo [成功] 计划任务已注册！
  echo.
  echo 说明：
  echo   - 任务每天 08:00 自动运行一次
  echo   - 也可双击 update-news.bat 手动立即更新
  echo   - 取消任务：schtasks /delete /tn "AI Frontier News Update"
) else (
  echo.
  echo [失败] 注册失败，请右键本文件 - 以管理员身份运行
)

pause

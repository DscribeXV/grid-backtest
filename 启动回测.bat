@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo  ============================================
echo   网格交易回测 - 一键运行
echo  ============================================
echo.
echo  [1/3] 正在跑回测（约 5-30 秒）...
node src\run_all.mjs
if errorlevel 1 (
    echo.
    echo  [错误] 回测失败，请看上面的输出排查。
    pause
    exit /b 1
)

echo.
echo  [2/3] 打开最新一次对比报告 ...
set "RUNS=%~dp0results\runs"
set "NEWEST="
for /f "delims=" %%d in ('dir /b /ad /od "%RUNS%" 2^>nul') do set "NEWEST=%%d"
if defined NEWEST (
    start "" "%RUNS%\%NEWEST%\comparison.html"
) else (
    echo  [提示] 没有找到回测结果目录。
)

echo.
echo  [3/3] 完成。结果在 results\runs\^<时间戳^>\
pause

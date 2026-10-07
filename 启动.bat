@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo  正在用 VSCode 打开本项目 ...
where code >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    start "" code "%~dp0."
) else (
    echo  [提示] 没有在 PATH 里找到 code 命令，请手动用 VSCode 打开本文件夹。
)
echo  Done.
pause

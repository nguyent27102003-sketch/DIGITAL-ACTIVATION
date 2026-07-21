@echo off
title FBEval Bot - Khoi Dong
echo ==================================================
echo   FBEVAL BOT - BOT DANH GIA TU DONG BAI VIET FB
echo ==================================================
echo.

:: Check Node.js installation
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [Loi] May tinh cua anh chua cai dat Node.js.
    echo Vui long tai va cai dat Node.js tai: https://nodejs.org/
    pause
    exit
)

:: Auto install dependencies if missing
if not exist node_modules (
    echo [Thong bao] Dang tu dong cai dat cac thu vien backend...
    call npm install
)

if not exist frontend\node_modules (
    echo [Thong bao] Dang tu dong cai dat cac thu vien frontend...
    call npm run frontend-install
)

:: Install Playwright browser if missing
if not exist %USERPROFILE%\AppData\Local\ms-playwright (
    echo [Thong bao] Dang tai trinh duyet Chrome cho Playwright (khoang 1-2 phut)...
    call npx playwright install chromium
)

echo.
echo [OK] Tat ca da san sang!
echo Cua so trinh duyet se tu dong mo tai: http://localhost:5000 sau 3 giay...
echo.

:: Open browser after 3 seconds in parallel
start "" cmd /c "timeout /t 3 >nul && start http://localhost:5000"

:: Start backend server
npm start

pause

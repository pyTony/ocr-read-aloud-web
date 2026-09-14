@echo off
echo ========================================================
echo  OCR Magazine Read-Aloud - Local Windows Setup ^& Runner
echo  Zero-cost, 100%% offline ^& local testing on your PC
echo ========================================================

node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found.
    echo Please download and install Node.js 18+ from https://nodejs.org/
    pause
    exit /b 1
)

echo [OK] Node.js is installed.
echo [1/2] Installing dependencies...
call npm install

echo.
echo [2/2] Launching server on http://localhost:3000 ...
echo Press Ctrl+C anytime to stop.
echo.
call npm run dev
pause

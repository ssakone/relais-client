@echo off
echo 🏗️ Building Relais Windows Executable
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js is not installed. Please install Node.js 18+ first.
    exit /b 1
)

echo ✅ Node.js found
echo.

REM Install dependencies if node_modules doesn't exist
if not exist "node_modules" (
    echo 📥 Installing dependencies...
    npm install
    if errorlevel 1 (
        echo ❌ Failed to install dependencies
        exit /b 1
    )
)

echo 🔨 Building Windows executable...
npm run build:win-only

if errorlevel 1 (
    echo ❌ Build failed
    exit /b 1
)

echo.
echo ✅ Build completed successfully!
echo 📦 Executable created: dist\relais-win.exe
echo.
echo 🚀 Usage:
echo   dist\relais-win.exe tunnel -p 3000
echo   dist\relais-win.exe deploy ./my-app
echo   dist\relais-win.exe set-token YOUR_TOKEN
echo.
pause


@echo off
echo =====================================================
echo   Git Branch Agent - Quick Launcher
echo =====================================================
echo.
echo Starting application...
echo.
echo Note: This is a development launcher.
echo For a proper standalone executable, see PACKAGING-GUIDE.md
echo.

cd /d "%~dp0"

:: Check if fnm is installed and initialize it
where fnm >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo Initializing fnm and loading Node.js 18...
    :: Initialize fnm environment for this session
    FOR /f "tokens=*" %%z IN ('fnm env --use-on-cd') DO CALL %%z
    :: Use Node 18
    fnm use 18 --silent-if-unchanged 2>nul
    if %ERRORLEVEL% NEQ 0 (
        echo Installing Node.js 18 via fnm...
        fnm install 18
        fnm use 18
    )
) else (
    echo Note: fnm not found, using system Node.js
)

:: Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed or not in PATH
    echo.
    echo Please either:
    echo   1. Install Node.js 18+ from https://nodejs.org/
    echo   2. Or use fnm: fnm install 18
    pause
    exit /b 1
)

:: Display Node version
echo Using Node.js version:
node --version
echo.

:: Check if node_modules exists
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: Failed to install dependencies
        pause
        exit /b 1
    )
)

:: Check if .env exists
if not exist ".env" (
    echo.
    echo WARNING: .env file not found!
    echo Please create a .env file with your configuration.
    echo See README.md for required variables.
    echo.
    pause
)

:: Start the application
npm start

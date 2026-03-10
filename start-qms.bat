@echo off
title WAVEMEDIX QMS
color 0A

echo.
echo  ========================================
echo   WAVEMEDIX Quality Management System
echo  ========================================
echo.

:: Set Node.js path explicitly
set "PATH=C:\Program Files\nodejs;C:\Program Files\nodejs\node_modules\npm\bin;%APPDATA%\npm;%PATH%"

:: Navigate to project folder (same folder as this .bat file)
cd /d "%~dp0"

:: Verify node works
where node >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Node.js nicht gefunden!
    echo  Bitte installiere Node.js von https://nodejs.org
    pause
    exit /b 1
)

echo  [OK] Node.js gefunden
for /f "tokens=*" %%i in ('node -v') do echo       Version: %%i

:: Check if node_modules exist
if not exist "node_modules\next" (
    echo.
    echo  [!] node_modules nicht gefunden. Installiere...
    call npm install
    if errorlevel 1 (
        echo  [ERROR] npm install fehlgeschlagen!
        pause
        exit /b 1
    )
    echo  [OK] Pakete installiert
)

:: Check if .env.local exists
if not exist ".env.local" (
    echo.
    echo  [ERROR] .env.local nicht gefunden!
    echo  Bitte erstelle die Datei mit den API-Keys.
    pause
    exit /b 1
)

:: Kill any existing process on port 3000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000.*LISTENING" 2^>nul') do (
    echo  [!] Port 3000 belegt - beende alten Prozess...
    taskkill /PID %%a /F >nul 2>&1
)

:: Clear old build cache to ensure latest code is used
if exist ".next" (
    echo  [!] Loesche alten Build-Cache...
    rmdir /s /q ".next" >nul 2>&1
    echo  [OK] Cache geloescht
)

echo.
echo  [OK] Starte Server auf http://localhost:3000 ...
echo  [OK] Build: v3 - Copy-and-Replace mit Template-Design
echo  ========================================
echo.
echo  Chrome oeffnet sich automatisch sobald der Server bereit ist.
echo  Zum Beenden: Ctrl+C druecken und mit J bestaetigen.
echo.

:: Wait for server to be ready in background, then open Chrome
start "" /min "%~dp0wait-and-open.bat"

:: Start the dev server using node directly (not npx)
node "node_modules\next\dist\bin\next" dev -p 3000

:: If server stops
echo.
echo  Server wurde beendet.
pause

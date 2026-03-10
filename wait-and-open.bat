@echo off
:: Wartet bis der Next.js Server auf Port 3000 komplett bereit ist
:: Testet die Session-API (nicht nur den Port)
set attempts=0

:loop
set /a attempts+=1
if %attempts% gtr 30 (
    echo Server konnte nicht gestartet werden.
    exit /b 1
)
timeout /t 2 /nobreak >nul

:: Teste ob die NextAuth API antwortet (das beweist der Server ist komplett kompiliert)
curl -s http://localhost:3000/api/auth/providers >nul 2>&1
if errorlevel 1 goto loop

:: Server ist bereit! Oeffne Chrome
start "" "chrome" "http://localhost:3000"

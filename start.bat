@echo off
title ChatGPT - Local Neural AI
color 0f
echo ========================================================
echo                 STARTING REAL CHATGPT
echo     (Local Neural Brain: Ollama qwen3:4b-instruct)
echo ========================================================
echo.

cd /d "%~dp0"

echo [1/4] Checking dependencies...
if not exist "node_modules\" (
    echo node_modules not found. Installing dependencies...
    call npm install
)

echo [2/4] Ensuring Ollama Neural Engine is active...
tasklist /fi "imagename eq ollama.exe" | findstr /i "ollama.exe" >nul
if errorlevel 1 (
    echo Starting Ollama...
    start "" ollama serve
    timeout /t 3 /nobreak >nul
)

echo [3/4] Starting Local Server...
start "" node server.js

echo [4/4] Launching ChatGPT Web App...
start "" python app_gui.py
timeout /t 1 >nul
start http://localhost:3000

echo.
echo ========================================================
echo   ChatGPT is now running both on your Desktop and Web!
echo ========================================================
timeout /t 3 >nul
exit

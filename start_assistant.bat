@echo off
title AETHERIA - Real Autonomous Desktop AI
color 0b
echo ========================================================
echo       AETHERIA DESKTOP AI - FULL SYSTEM ACCESS
echo  (ChatGPT Intelligence + Voice + Autonomous PC Control)
echo ========================================================
echo.

cd /d "%~dp0"

echo [1/2] Verifying Ollama Neural Core...
tasklist /fi "imagename eq ollama.exe" | findstr /i "ollama.exe" >nul
if errorlevel 1 (
    echo Starting Ollama background engine...
    start "" ollama serve
    timeout /t 3 /nobreak >nul
)

echo [2/2] Launching Aetheria Desktop HUD...
python app_gui.py

pause

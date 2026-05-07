@echo off
chcp 65001 >nul
echo ================================================
echo   SmartAgent4 本地语音服务启动器
echo ================================================
echo.
echo 正在启动本地语音服务...
echo - ASR: faster-whisper (中文)
echo - TTS: Piper (中文女声)
echo.
cd /d "%~dp0local-voice-service"
python main.py
pause

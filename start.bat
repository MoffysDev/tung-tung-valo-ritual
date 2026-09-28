@echo off
title Tung Tung Tracker
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
    echo Python est introuvable. Installe Python 3.10+ depuis https://www.python.org/downloads/
    echo (coche "Add python.exe to PATH" pendant l'installation^)
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo Premiere installation, creation de l'environnement...
    python -m venv .venv || goto :error
)
".venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check -r requirements.txt || goto :error
rem Fenetre native optionnelle : sans pywebview, l'app s'ouvre dans le navigateur.
".venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check pywebview pystray pillow >nul 2>nul
".venv\Scripts\python.exe" app.py %*
exit /b 0

:error
echo.
echo L'installation a echoue. Verifie ta connexion internet puis relance start.bat.
pause
exit /b 1

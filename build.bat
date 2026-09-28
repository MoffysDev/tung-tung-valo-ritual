@echo off
rem Construit dist\TungTungTracker.exe (un seul fichier, fenetre native, sans console).
cd /d "%~dp0"

rem pywebview est le plus fiable sur Python 3.12/3.13.
set PY=python
where py >nul 2>nul && set PY=py -3
py -3.12 -c "" >nul 2>nul && set PY=py -3.12
py -3.13 -c "" >nul 2>nul && set PY=py -3.13

if not exist ".venv-build\Scripts\python.exe" (
    echo Creation de l'environnement de build...
    %PY% -m venv .venv-build || goto :error
)
set VPY=.venv-build\Scripts\python.exe
%VPY% -m pip install -q --disable-pip-version-check -r requirements.txt pywebview pystray pyinstaller pillow || goto :error
%VPY% tools\make_icon.py || goto :error

%VPY% -m PyInstaller --noconfirm --clean --onefile --windowed ^
    --name TungTungTracker ^
    --icon tools\icon.ico ^
    --add-data "static;static" ^
    --collect-submodules webview ^
    --collect-submodules pystray ^
    app.py || goto :error

echo.
echo OK : dist\TungTungTracker.exe
exit /b 0

:error
echo.
echo Le build a echoue.
exit /b 1

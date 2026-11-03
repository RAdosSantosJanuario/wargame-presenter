@echo off
rem Wargame Presenter - double-click to start (opens the browser automatically)
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 server.py %*
) else (
  python server.py %*
)
pause

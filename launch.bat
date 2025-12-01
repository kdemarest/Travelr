@echo off
setlocal
set "ROOT=%~dp0"

if not defined TRAVELR_CONFIG (
    echo.
    echo ERROR: TRAVELR_CONFIG environment variable is not set.
    echo.
    echo Run 'node setup.js' first to configure your environment.
    echo.
    exit /b 1
)

start "Travelr API Server" cmd /k "pushd ""%ROOT%"" && npm run dev --workspace server"
start "Travelr Web Server" cmd /k "pushd ""%ROOT%"" && npm run dev --workspace client"

echo.
echo Travelr API server and web server launch windows started.
echo Close this window if you no longer need it.
exit /b 0

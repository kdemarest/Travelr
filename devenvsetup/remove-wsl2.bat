@echo off
setlocal

set "SCRIPT_NAME=%~nx0"
set "RESTART_REQUIRED="
set "DISTRO_LIST="

call :require_admin || goto :eof

echo This will shut down WSL, unregister every distro, and disable the WSL-related Windows features.
echo Press Ctrl+C to cancel or any other key to continue.
pause >nul

echo.
echo Shutting down any running WSL instances ...
wsl.exe --shutdown >nul 2>&1

call :gather_distros
call :unregister_distros || goto :eof

call :disable_feature VirtualMachinePlatform || goto :eof
call :disable_feature Microsoft-Windows-Subsystem-Linux || goto :eof

if defined RESTART_REQUIRED (
    echo.
    echo A restart is required to finish removing WSL components.
) else (
    echo.
    echo WSL features disabled. A restart is still recommended before reinstalling.
)

echo.
echo Removal complete. Run %SCRIPT_NAME% again after reboot if DISM reports pending changes.
exit /b 0

:require_admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo %SCRIPT_NAME% must be run from an elevated Command Prompt.
    exit /b 1
)
exit /b 0

:gather_distros
for /f "usebackq tokens=*" %%D in (`wsl.exe -l -q 2^>nul`) do (
    for /f "tokens=1" %%E in ("%%D") do (
        if not "%%E"=="" (
            if defined DISTRO_LIST (
                set "DISTRO_LIST=%DISTRO_LIST%|%%E"
            ) else (
                set "DISTRO_LIST=%%E"
            )
        )
    )
)
exit /b 0

:unregister_distros
if not defined DISTRO_LIST (
    echo No registered distros found.
    exit /b 0
)

for %%D in (%DISTRO_LIST:|= % ) do (
    echo Unregistering distro %%D ...
    wsl.exe --unregister %%D
    if %errorlevel% neq 0 (
        echo Failed to unregister %%D (error %errorlevel%).
        exit /b %errorlevel%
    )
)
exit /b 0

:disable_feature
set "FEATURE=%~1"
echo.
echo Disabling optional feature %FEATURE% ...
dism.exe /online /get-featureinfo /featurename:%FEATURE% | findstr /C:"State : Disabled" >nul 2>&1
if %errorlevel% equ 0 (
    echo %FEATURE% already disabled.
    exit /b 0
)

dism.exe /online /disable-feature /featurename:%FEATURE% /norestart
set "DISM_ERROR=%errorlevel%"
if %DISM_ERROR% equ 0 (
    echo %FEATURE% disabled successfully.
    exit /b 0
)

if %DISM_ERROR% equ 3010 (
    echo %FEATURE% disabled. Restart required.
    set "RESTART_REQUIRED=1"
    exit /b 0
)

echo Failed to disable %FEATURE% (error %DISM_ERROR%).
exit /b %DISM_ERROR%

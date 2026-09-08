@echo off
REM start_server.bat - Run the Vivid Mistress server in the background on Windows.
REM
REM Usage:
REM   start_server.bat            Start the server in the background
REM   start_server.bat stop       Stop the background server
REM   start_server.bat status     Show whether the server is running
REM   start_server.bat restart    Stop, then start again
REM
REM Extra arguments are passed to the server, e.g.:
REM   start_server.bat -addr :9090 -data C:\chatdata
REM
REM The server keeps running after you close the command prompt. Its output is
REM written to server.log (created in this script's folder).

setlocal enabledelayedexpansion

set "DIR=%~dp0"
set "BIN=%DIR%server.exe"
set "LOG_FILE=%DIR%server.log"

if /I "%~1"=="stop" goto :stop
if /I "%~1"=="status" goto :status
if /I "%~1"=="restart" goto :restart

:start
if exist "%BIN%" (
    "%BIN%" -h >nul 2>&1
    if errorlevel 9009 (
        echo Error: '%BIN%' is not a valid executable.
        exit /b 1
    )
) else (
    echo Error: '%BIN%' not found.
    echo Put the 'server.exe' binary in this folder (%DIR%) first.
    exit /b 1
)

echo Starting server in the background...
start "Vivid Mistress Server" /min "%BIN%" %* >> "%LOG_FILE%" 2>&1

echo Server started in the background.
echo   Log:      %LOG_FILE%
echo   Stop:     %~nx0 stop
echo   Status:   %~nx0 status
goto :eof

:stop
echo Stopping server...
tasklist /FI "WINDOWTITLE eq Vivid Mistress Server" /FO CSV 2>nul | findstr /i "server.exe" >nul
if errorlevel 1 (
    echo Server is not running.
    goto :eof
)
taskkill /FI "WINDOWTITLE eq Vivid Mistress Server" /F >nul 2>&1
if errorlevel 1 (
    echo Could not stop the server. Try: taskkill /IM server.exe /F
) else (
    echo Server stopped.
)
goto :eof

:status
tasklist /FI "WINDOWTITLE eq Vivid Mistress Server" /FO CSV 2>nul | findstr /i "server.exe" >nul
if errorlevel 1 (
    echo Server is not running.
) else (
    echo Server is running.
)
goto :eof

:restart
call :stop
timeout /t 2 /nobreak >nul
shift
goto :start
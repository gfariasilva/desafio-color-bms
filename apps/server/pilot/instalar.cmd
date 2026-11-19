@echo off
rem Sistema Color - installs the system on this PC, in trial mode; run it from the extracted zip (backlog #26).
rem All the logic and the messages are in app\server\dist\pilot\cli.js.
setlocal
if not exist "%~dp0app\node\node.exe" (
  echo Extraia o arquivo .zip inteiro antes de rodar este script.
  pause
  exit /b 1
)
"%~dp0app\node\node.exe" "%~dp0app\server\dist\pilot\cli.js" instalar %*
set CODE=%ERRORLEVEL%
if /i not "%~1"=="/silencioso" pause
exit /b %CODE%

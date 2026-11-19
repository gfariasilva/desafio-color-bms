@echo off
rem Sistema Color - stops the system (backlog #26).
rem All the logic and the messages are in app\server\dist\pilot\cli.js.
setlocal
if not exist "%~dp0app\node\node.exe" (
  echo Extraia o arquivo .zip inteiro antes de rodar este script.
  pause
  exit /b 1
)
"%~dp0app\node\node.exe" "%~dp0app\server\dist\pilot\cli.js" parar %*
set CODE=%ERRORLEVEL%
if /i not "%~1"=="/silencioso" pause
exit /b %CODE%

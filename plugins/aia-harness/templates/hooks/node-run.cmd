@echo off
rem aia-harness node resolver (Windows). Usage: node-run.cmd <script.mjs> [args...]
setlocal
set "SCRIPT=%~1"
if "%SCRIPT%"=="" (
  echo node-run: missing script argument 1>&2
  exit /b 1
)
shift

if defined CLAUDE_NODE (
  "%CLAUDE_NODE%" "%SCRIPT%" %*
  exit /b %errorlevel%
)
where node >nul 2>nul
if %errorlevel%==0 (
  node "%SCRIPT%" %*
  exit /b %errorlevel%
)
where bun >nul 2>nul
if %errorlevel%==0 (
  bun "%SCRIPT%" %*
  exit /b %errorlevel%
)
echo node-run: no Node.js runtime found (set CLAUDE_NODE to override) 1>&2
rem Fail open: never block Claude Code on a missing runtime.
exit /b 0

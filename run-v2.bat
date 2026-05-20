@echo off
setlocal

REM ── New stack runner: FastAPI + React ───────────────────────────────
REM  Vite can't handle "#" in paths, so we mount this project as drive Z:
REM  via `subst`. All tooling runs from Z: to keep paths clean.

echo.
echo ===== GolfAdmin v2 (FastAPI + React) =====
echo.

REM Ensure Z: points at this project
subst | findstr /C:"Z:\\" >nul 2>&1
if errorlevel 1 (
  echo Mounting Z: to %~dp0...
  subst Z: "%~dp0." 2>nul
)

echo Starting backend on http://127.0.0.1:8000 ...
start "GolfAdmin API" cmd /k "Z: && cd Z:\backend && venv\Scripts\python.exe run.py"

timeout /T 2 /NOBREAK >nul

echo Starting frontend on http://127.0.0.1:5173 ...
start "GolfAdmin UI" cmd /k "Z: && cd Z:\frontend && npm run dev"

echo.
echo Opened two windows. Close them to stop servers.
echo.
echo   API  → http://127.0.0.1:8000
echo   Docs → http://127.0.0.1:8000/docs
echo   UI   → http://127.0.0.1:5173
echo.
echo Admins: admin/admin, manager/manager, cashier/cashier
echo.
pause

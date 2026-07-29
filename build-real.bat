@echo off
REM Build the KillCam frontend against the real (/api) backend shim.
REM npm install may omit dev deps in some setups, so we call the vite binary
REM directly rather than via "npm run build".
setlocal
cd /d "%~dp0"
set VITE_REAL_BACKEND=1
set VITE_MOCK_BACKEND=
if exist "node_modules\.bin\vite.cmd" (
  call "node_modules\.bin\vite.cmd" build
) else (
  call "node_modules\.bin\vite" build
)
endlocal

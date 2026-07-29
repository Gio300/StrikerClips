@echo off
REM Run the KillCam backend tests (server/) with vitest.
REM npm here is configured to omit dev deps in some flows, so call the local
REM vitest binary directly rather than `npm test`.
cd /d "%~dp0"
call "node_modules\.bin\vitest.cmd" run server

@echo off
cd /d "C:\Users\Flying Phoenix PCs\Desktop\StrikerClips"
echo === TSC === > testpass.log
call npx tsc --noEmit -p tsconfig.json >> testpass.log 2>&1
echo TSC_EXIT %ERRORLEVEL% >> testpass.log
echo === VITEST === >> testpass.log
call npx vitest run >> testpass.log 2>&1
echo VITEST_EXIT %ERRORLEVEL% >> testpass.log
echo ALL_DONE >> testpass.log

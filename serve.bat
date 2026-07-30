@echo off
cd /d "C:\Users\Flying Phoenix PCs\Desktop\StrikerClips"
call npx vite preview --outDir dist --port 4173 > preview.log 2>&1

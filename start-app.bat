@echo off
echo Starting AI StudyMate Pro...
echo.

:: Start Django backend in a new window
start "Django Backend" cmd /k "cd /d "%~dp0" && backend\venv\Scripts\python.exe backend\manage.py runserver 127.0.0.1:8000"

:: Wait 3 seconds then start Next.js frontend in another new window
timeout /t 3 /nobreak >nul
start "Next.js Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo.
echo Both servers are starting...
echo.
echo Django  -^> http://127.0.0.1:8000
echo Next.js -^> http://localhost:3000
echo.
echo Open your browser at: http://localhost:3000
echo.
echo Close the two server windows to stop the app.
pause

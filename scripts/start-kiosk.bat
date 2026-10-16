@echo off
title OneDrive TV Kiosk Launcher
cd /d "%~dp0\.."

echo ========================================================
echo        OneDrive Media Kiosk - Windows Launcher
echo ========================================================

echo [1/3] Menjalankan Server Node.js di latar belakang...
start "OneDriveKioskServer" /min cmd /c "node src/server.js"

echo [2/3] Menunggu Server Siap di http://localhost:3000...
set RETRY_COUNT=0
:wait_loop
timeout /t 1 /nobreak >nul
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:3000/api/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
if not errorlevel 1 goto server_ready

set /a RETRY_COUNT+=1
if %RETRY_COUNT% geq 30 (
    echo.
    echo ========================================================
    echo [ERROR] Server gagal merespons setelah 30 detik!
    echo Periksa dependensi Node.js atau file konfigurasi server.
    echo ========================================================
    pause
    exit /b 1
)
goto wait_loop

:server_ready
echo Server siap!
echo [3/3] Membuka Microsoft Edge Kiosk Mode...
start "" "msedge.exe" --kiosk "http://localhost:3000/kiosk" --edge-kiosk-type=fullscreen --no-first-run --disable-pinch --overscroll-history-navigation=0 --disable-features=Translate

echo ========================================================
echo Kiosk aktif! Layar TV sedang menampilkan player.
echo Web Admin dapat diakses di http://localhost:3000/admin
echo ========================================================

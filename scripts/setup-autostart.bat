@echo off
title Setup Windows Auto-start Kiosk
cd /d "%~dp0\.."

echo Membuat Shortcut Auto-Start di folder Windows Startup...
set "TARGET_BAT=%CD%\scripts\start-kiosk.bat"
set "SHORTCUT_PATH=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\OneDriveKiosk.lnk"

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = '%TARGET_BAT%'; $s.WorkingDirectory = '%CD%'; $s.Save()"

if exist "%SHORTCUT_PATH%" (
  echo [SUKSES] Kiosk telah terdaftar untuk otomatis mulai saat Mini PC menyala!
  echo Lokasi Shortcut: %SHORTCUT_PATH%
) else (
  echo [GAGAL] Gagal membuat shortcut di folder Startup.
)
pause

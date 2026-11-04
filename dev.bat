@echo off
chcp 65001 >nul
setlocal
title Leon Editor - Dev

set "ROOT=%~dp0"
set "MSYS=D:\leon\tools\msys64\mingw64\bin"
set "CARGOBIN=%USERPROFILE%\.cargo\bin"

set "PATH=%CARGOBIN%;%MSYS%;%PATH%"
set "RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu"
set "TAURI_TARGET=x86_64-pc-windows-gnu"
set "CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=%MSYS%\x86_64-w64-mingw32-gcc.exe"
set "CARGO_TARGET_X86_64_PC_WINDOWS_GNU_AR=%MSYS%\ar.exe"

cd /d "%ROOT%"
echo Starting dev mode (hot reload enabled)...
npx tauri dev --target x86_64-pc-windows-gnu
pause

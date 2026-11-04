@echo off
chcp 65001 >nul
setlocal
title Leon Editor - Build

set "ROOT=%~dp0"

REM ============================================================
REM  改这两行指向你自己的工具链
REM ============================================================
set "MSYS=D:\leon\tools\msys64\mingw64\bin"
set "CARGOBIN=%USERPROFILE%\.cargo\bin"
REM ============================================================

echo ============================================================
echo   Leon Editor - portable build
echo ============================================================
echo.

if not exist "%MSYS%\x86_64-w64-mingw32-gcc.exe" (
    echo [ERROR] mingw toolchain not found at:
    echo         %MSYS%
    echo         Edit this .bat and fix the MSYS variable, or see README.
    pause
    exit /b 1
)

set "PATH=%CARGOBIN%;%MSYS%;%PATH%"
set "RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu"
set "TAURI_TARGET=x86_64-pc-windows-gnu"
set "CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=%MSYS%\x86_64-w64-mingw32-gcc.exe"
set "CARGO_TARGET_X86_64_PC_WINDOWS_GNU_AR=%MSYS%\ar.exe"

cd /d "%ROOT%"

echo [1/2] Building (frontend + Rust backend)...
echo       NOTE: must use "tauri build", not "cargo build" -
echo       only tauri build embeds the frontend resources into the exe.
echo.
call npx tauri build --no-bundle --target x86_64-pc-windows-gnu
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed.
    pause
    exit /b 1
)

echo.
echo [2/2] Assembling portable folder...
node "%ROOT%scripts\make-portable.mjs"
if errorlevel 1 (
    echo [ERROR] Packaging failed.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   Done. Output: %ROOT%dist-portable
echo ============================================================
pause

@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title PhotoCloud - Gestione App (Windows)

:: Posizionati nella cartella dello script
cd /d "%~dp0"

set REPO_URL=https://github.com/ValerioMassimoDeCecco/PhotoCloud.git

:MENU
cls
echo ======================================================================
echo           PhotoCloud -- Gestione App (Windows)
echo ======================================================================
echo.
echo Seleziona un'operazione:
echo.
echo   [1] Avvia PhotoCloud (Modalita Sviluppo -- npm run dev)
echo   [2] Avvia PhotoCloud (Modalita Produzione -- npm start)
echo   [3] Aggiorna la Web App (git pull + npm install + build)
echo   [4] Clona Repository Git (in un'altra cartella)
echo   [5] Verifica e Installa Dipendenze Mancanti (Git, Node.js)
echo   [6] Compila APK Release Android (v1.2.4)
echo   [7] Esci
echo.
echo ======================================================================
set /p CHOICE="Scelta [1-7]: "

if "%CHOICE%"=="1" goto START_DEV
if "%CHOICE%"=="2" goto START_PROD
if "%CHOICE%"=="3" goto UPDATE_APP
if "%CHOICE%"=="4" goto CLONE_REPO
if "%CHOICE%"=="5" goto CHECK_DEPS_MENU
if "%CHOICE%"=="6" goto BUILD_APK
if "%CHOICE%"=="7" goto EXIT_APP

echo.
echo [!] Scelta non valida. Riprova.
timeout /t 2 >nul
goto MENU

:CHECK_DEPS
echo.
echo === Verifica Dipendenze di Sistema ===
set MISSING_GIT=0
set MISSING_NODE=0

git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Git NON risulta installato.
    set MISSING_GIT=1
) else (
    for /f "tokens=*" %%g in ('git --version') do echo [V] Git e installato: %%g
)

node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Node.js NON risulta installato.
    set MISSING_NODE=1
) else (
    for /f "tokens=*" %%n in ('node -v') do echo [V] Node.js e installato: %%n
)

npm -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] npm NON risulta installato.
) else (
    for /f "tokens=*" %%m in ('npm -v') do echo [V] npm e installato: v%%m
)

if %MISSING_GIT%==1 (
    echo.
    echo Tentativo di installazione di Git tramite Windows Package Manager (winget)...
    where winget >nul 2>&1
    if !errorlevel! equ 0 (
        winget install -e --id Git.Git
    ) else (
        echo Winget non trovato. Apertura pagina di download ufficiale di Git...
        start https://git-scm.com/download/win
    )
)

if %MISSING_NODE%==1 (
    echo.
    echo Tentativo di installazione di Node.js tramite Windows Package Manager (winget)...
    where winget >nul 2>&1
    if !errorlevel! equ 0 (
        winget install -e --id OpenJS.NodeJS
    ) else (
        echo Winget non trovato. Apertura pagina di download ufficiale di Node.js...
        start https://nodejs.org/
    )
)

if exist "%~dp0package.json" (
    if not exist "%~dp0node_modules" (
        echo.
        echo [i] La cartella node_modules non esiste. Esecuzione di 'npm install'...
        call npm install
        echo [V] Dipendenze NPM installate con successo.
    ) else (
        echo [V] Dipendenze NPM in node_modules presenti.
    )
)
goto :eof

:CHECK_DEPS_MENU
cls
call :CHECK_DEPS
echo.
echo Premere un tasto per tornare al menu principale...
pause >nul
goto MENU

:START_DEV
cls
echo === Avvio PhotoCloud (Modalita Sviluppo - Dev) ===
echo.
call :CHECK_DEPS
echo.
echo [i] Avvio del server Express + Vite sulla porta 3000...
call npm run dev
pause
goto MENU

:START_PROD
cls
echo === Avvio PhotoCloud (Modalita Produzione - Prod) ===
echo.
call :CHECK_DEPS
echo.
if not exist "%~dp0dist" (
    echo [i] Compilazione bundle produzione (npm run build)...
    call npm run build
)
set PORT=3000
set /p CUSTOM_PORT="Inserisci la porta del server (default: 3000): "
if not "!CUSTOM_PORT!"=="" set PORT=!CUSTOM_PORT!

echo [i] Avvio del server Node.js sulla porta !PORT!...
call npm start
pause
goto MENU

:UPDATE_APP
cls
echo === Aggiornamento Web App Localmente ===
echo.
call :CHECK_DEPS
echo.
echo 1/4. Download ultimi aggiornamenti dal repository git (git pull)...
call git pull
if %errorlevel% neq 0 (
    echo [!] Errore durante git pull.
    pause
    goto MENU
)

echo.
echo 2/4. Sincronizzazione dipendenze NPM (npm install)...
call npm install
if %errorlevel% neq 0 (
    echo [!] Errore durante npm install.
    pause
    goto MENU
)

echo.
echo 3/4. Compilazione bundle Web App (npm run build)...
call npm run build
if %errorlevel% neq 0 (
    echo [!] Errore durante npm run build.
    pause
    goto MENU
)

echo.
echo 4/4. Aggiornamento completato con successo!
echo.
echo Premere un tasto per tornare al menu principale...
pause >nul
goto MENU

:CLONE_REPO
cls
echo === Clonazione Repository PhotoCloud ===
echo.
set TARGET_DIR=PhotoCloud
set /p TARGET_INPUT="Inserisci il nome della cartella dove clonare (default: PhotoCloud): "
if not "!TARGET_INPUT!"=="" set TARGET_DIR=!TARGET_INPUT!

if exist "!TARGET_DIR!" (
    echo [!] La cartella '!TARGET_DIR!' esiste gia.
    set /p PULL_CONFIRM="Vuoi aggiornarla con 'git pull'? (S/N): "
    if /i "!PULL_CONFIRM!"=="S" (
        cd /d "!TARGET_DIR!"
        call git pull
        call npm install
        echo [V] Repository aggiornata in '!TARGET_DIR!'.
        cd /d "%~dp0"
    )
) else (
    echo [i] Clonazione da %REPO_URL% in '!TARGET_DIR!'...
    call git clone %REPO_URL% "!TARGET_DIR!"
    cd /d "!TARGET_DIR!"
    echo [i] Installazione dipendenze NPM...
    call npm install
    echo [V] Clonazione e installazione completate in '!TARGET_DIR!'!
    cd /d "%~dp0"
)
echo.
echo Premere un tasto per tornare al menu principale...
pause >nul
goto MENU

:BUILD_APK
cls
echo === Compilazione APK Release Android (v1.2.4) ===
echo.
call :CHECK_DEPS
echo.
echo [i] Avvio compilazione APK tramite script NPM...
call npm run release:apk
echo.
echo Premere un tasto per tornare al menu principale...
pause >nul
goto MENU

:EXIT_APP
echo.
echo Arrivederci!
timeout /t 1 >nul
exit /b 0

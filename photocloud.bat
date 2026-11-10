@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul 2>&1
title PhotoCloud - Gestione App (Windows)

:: Posizionati sempre nella cartella in cui si trova questo script
cd /d "%~dp0"

set "REPO_URL=https://github.com/ValerioMassimoDeCecco/PhotoCloud.git"
set "DEFAULT_PORT=3000"

:: Aggiungi i percorsi standard di Git e Node.js al PATH della sessione corrente
if exist "%ProgramFiles%\nodejs" set "PATH=%PATH%;%ProgramFiles%\nodejs"
if exist "%ProgramFiles(x86)%\nodejs" set "PATH=%PATH%;%ProgramFiles(x86)%\nodejs"
if exist "%AppData%\npm" set "PATH=%PATH%;%AppData%\npm"
if exist "%LocalAppData%\Programs\Git\cmd" set "PATH=%PATH%;%LocalAppData%\Programs\Git\cmd"
if exist "%ProgramFiles%\Git\cmd" set "PATH=%PATH%;%ProgramFiles%\Git\cmd"
if exist "%ProgramFiles(x86)%\Git\cmd" set "PATH=%PATH%;%ProgramFiles(x86)%\Git\cmd"

:MENU
cls
echo ======================================================================
echo           PhotoCloud -- Gestione App (Windows)
echo ======================================================================
echo.
echo   Cartella corrente: %CD%
echo.
echo   Seleziona un'operazione:
echo.
echo   [1] Avvia PhotoCloud - Modalita Sviluppo (npm run dev)
echo   [2] Avvia PhotoCloud - Modalita Produzione (npm start)
echo   [3] Aggiorna la Web App (git pull + npm install + npm run build)
echo   [4] Clona Repository Git (in una nuova sottocartella)
echo   [5] Verifica e Installa Dipendenze Mancanti (Git, Node.js, npm)
echo   [6] Compila APK Release Android (v1.2.4)
echo   [7] Esci
echo.
echo ======================================================================
set "CHOICE="
set /p "CHOICE=Inserisci il numero dell'operazione [1-7]: "

if "%CHOICE%"=="1" goto START_DEV
if "%CHOICE%"=="2" goto START_PROD
if "%CHOICE%"=="3" goto UPDATE_APP
if "%CHOICE%"=="4" goto CLONE_REPO
if "%CHOICE%"=="5" goto CHECK_DEPS_STANDALONE
if "%CHOICE%"=="6" goto BUILD_APK
if "%CHOICE%"=="7" goto EXIT_APP

echo.
echo [ERRORE] Scelta non valida: "%CHOICE%". Inserisci un numero da 1 a 7.
timeout /t 2 >nul
goto MENU


:: ======================================================================
:: SUBROUTINE: Verifica Git, Node.js e npm (senza blocchi parentesi annidati)
:: ======================================================================
:ENSURE_TOOLS
echo.
echo --- Verifica Dipendenze di Sistema ---
set "TOOLS_OK=1"

:: 1. Controllo Git
where git >nul 2>&1
if not errorlevel 1 goto GIT_FOUND
echo [MANCANTE] Git non trovato nel sistema.
call :INSTALL_GIT
where git >nul 2>&1
if not errorlevel 1 goto GIT_FOUND
echo [ERRORE] Impossibile trovare Git. Installalo da https://git-scm.com/download/win e riavvia lo script.
set "TOOLS_OK=0"
goto CHECK_NODE

:GIT_FOUND
for /f "delims=" %%G in ('git --version 2^>nul') do echo [OK] %%G

:CHECK_NODE
:: 2. Controllo Node.js
where node >nul 2>&1
if not errorlevel 1 goto NODE_FOUND
echo [MANCANTE] Node.js non trovato nel sistema.
call :INSTALL_NODE
where node >nul 2>&1
if not errorlevel 1 goto NODE_FOUND
echo [ERRORE] Impossibile trovare Node.js. Installalo da https://nodejs.org/ e riavvia lo script.
set "TOOLS_OK=0"
goto CHECK_NPM

:NODE_FOUND
for /f "delims=" %%N in ('node -v 2^>nul') do echo [OK] Node.js versione %%N

:CHECK_NPM
:: 3. Controllo npm
where npm.cmd >nul 2>&1
if not errorlevel 1 goto NPM_FOUND
where npm >nul 2>&1
if not errorlevel 1 goto NPM_FOUND
echo [ERRORE] npm non trovato nel sistema. Reinstalla Node.js da https://nodejs.org/
set "TOOLS_OK=0"
goto TOOLS_DONE

:NPM_FOUND
for /f "delims=" %%M in ('call npm -v 2^>nul') do echo [OK] npm versione v%%M

:TOOLS_DONE
exit /b 0


:: ======================================================================
:: SUBROUTINE: Installa Git tramite winget
:: ======================================================================
:INSTALL_GIT
where winget >nul 2>&1
if errorlevel 1 goto GIT_MANUAL
echo [INFO] Installazione automatica di Git tramite winget in corso...
call winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
if exist "%LocalAppData%\Programs\Git\cmd" set "PATH=%PATH%;%LocalAppData%\Programs\Git\cmd"
if exist "%ProgramFiles%\Git\cmd" set "PATH=%PATH%;%ProgramFiles%\Git\cmd"
exit /b 0

:GIT_MANUAL
echo [INFO] Winget non disponibile. Apertura pagina download di Git...
start "" "https://git-scm.com/download/win"
exit /b 0


:: ======================================================================
:: SUBROUTINE: Installa Node.js tramite winget
:: ======================================================================
:INSTALL_NODE
where winget >nul 2>&1
if errorlevel 1 goto NODE_MANUAL
echo [INFO] Installazione automatica di Node.js LTS tramite winget in corso...
call winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
if exist "%ProgramFiles%\nodejs" set "PATH=%PATH%;%ProgramFiles%\nodejs"
if exist "%ProgramFiles(x86)%\nodejs" set "PATH=%PATH%;%ProgramFiles(x86)%\nodejs"
if exist "%AppData%\npm" set "PATH=%PATH%;%AppData%\npm"
exit /b 0

:NODE_MANUAL
echo [INFO] Winget non disponibile. Apertura pagina download di Node.js...
start "" "https://nodejs.org/"
exit /b 0


:: ======================================================================
:: SUBROUTINE: Assicura che node_modules sia installato
:: ======================================================================
:ENSURE_NODE_MODULES
if not exist "%~dp0package.json" goto NO_PKG_JSON
if exist "%~dp0node_modules" goto NODE_MODULES_OK
echo.
echo [INFO] Cartella node_modules mancante. Installazione pacchetti NPM in corso...
call npm install
if errorlevel 1 goto NPM_INSTALL_ERR
echo [OK] Dipendenze NPM installate correttamente.
exit /b 0

:NODE_MODULES_OK
echo [OK] Cartella node_modules presente.
exit /b 0

:NO_PKG_JSON
echo [ERRORE] File package.json non trovato in "%~dp0".
echo Assicurati di aver posizionato questo script nella radice del progetto PhotoCloud,
echo oppure usa l'opzione [4] per clonare la repository.
exit /b 1

:NPM_INSTALL_ERR
echo [ERRORE] "npm install" ha restituito un errore. Controlla la connessione internet.
exit /b 1


:: ======================================================================
:: OPZIONE 1: Avvia in Modalita Sviluppo (npm run dev)
:: ======================================================================
:START_DEV
cls
echo ======================================================================
echo   Avvio PhotoCloud -- Modalita Sviluppo
echo ======================================================================
call :ENSURE_TOOLS
if "%TOOLS_OK%"=="0" goto PAUSE_RETURN
call :ENSURE_NODE_MODULES
if errorlevel 1 goto PAUSE_RETURN

echo.
echo [INFO] Avvio del server Express + Vite su http://localhost:3000 ...
echo [INFO] Premi CTRL+C per arrestare il server.
echo.
call npm run dev
goto PAUSE_RETURN


:: ======================================================================
:: OPZIONE 2: Avvia in Modalita Produzione (npm start)
:: ======================================================================
:START_PROD
cls
echo ======================================================================
echo   Avvio PhotoCloud -- Modalita Produzione
echo ======================================================================
call :ENSURE_TOOLS
if "%TOOLS_OK%"=="0" goto PAUSE_RETURN
call :ENSURE_NODE_MODULES
if errorlevel 1 goto PAUSE_RETURN

if exist "%~dp0dist" goto ASK_PORT
echo.
echo [INFO] Cartella dist non trovata. Compilazione bundle di produzione in corso...
call npm run build
if errorlevel 1 goto BUILD_ERR

:ASK_PORT
echo.
set "CUSTOM_PORT="
set /p "CUSTOM_PORT=Inserisci la porta del server [invio per usare %DEFAULT_PORT%]: "
if "%CUSTOM_PORT%"=="" set "CUSTOM_PORT=%DEFAULT_PORT%"
set "PORT=%CUSTOM_PORT%"

echo.
echo [INFO] Avvio del server PhotoCloud in produzione su http://localhost:%PORT% ...
echo [INFO] Premi CTRL+C per arrestare il server.
echo.
call npm start
goto PAUSE_RETURN

:BUILD_ERR
echo.
echo [ERRORE] Compilazione fallita durante "npm run build".
goto PAUSE_RETURN


:: ======================================================================
:: OPZIONE 3: Aggiorna la Web App Localmente
:: ======================================================================
:UPDATE_APP
cls
echo ======================================================================
echo   Aggiornamento Web App PhotoCloud
echo ======================================================================
call :ENSURE_TOOLS
if "%TOOLS_OK%"=="0" goto PAUSE_RETURN

if not exist "%~dp0package.json" goto UPDATE_NO_REPO

:: Se la cartella e stata scaricata come ZIP (senza .git), inizializza il collegamento Git
if exist "%~dp0.git" goto DO_GIT_PULL
echo.
echo [AVVISO] Cartella .git non trovata (progetto scaricato probabilmente come archivio ZIP).
set "INIT_GIT_CHOICE="
set /p "INIT_GIT_CHOICE=Vuoi collegare questa cartella al repository GitHub per ricevere gli aggiornamenti? (S/N): "
if /i not "%INIT_GIT_CHOICE%"=="S" goto UPDATE_NPM_STEP
echo [INFO] Collegamento al repository %REPO_URL% ...
call git init
call git remote remove origin >nul 2>&1
call git remote add origin "%REPO_URL%"
call git fetch origin main
if errorlevel 1 goto GIT_PULL_ERR
call git checkout -f -B main origin/main
if errorlevel 1 goto GIT_PULL_ERR
goto UPDATE_NPM_STEP

:DO_GIT_PULL
echo.
echo [1/3] Scaricamento ultimi aggiornamenti da GitHub (git pull)...
call git pull --rebase --autostash
if not errorlevel 1 goto UPDATE_NPM_STEP
echo [INFO] Tentativo di allineamento dal branch principale (origin/main)...
call git pull origin main
if errorlevel 1 goto GIT_PULL_ERR

:UPDATE_NPM_STEP
echo.
echo [2/3] Aggiornamento pacchetti e dipendenze (npm install)...
call npm install
if errorlevel 1 goto NPM_INSTALL_ERR

echo.
echo [3/3] Ricompilazione della Web App (npm run build)...
call npm run build
if errorlevel 1 goto BUILD_ERR

echo.
echo ======================================================================
echo [OK] Aggiornamento completato con successo!
echo ======================================================================
echo.
set "RUN_AFTER_UPDATE="
set /p "RUN_AFTER_UPDATE=Vuoi avviare subito la Web App? [1=Sviluppo, 2=Produzione, N=Torna al menu]: "
if "%RUN_AFTER_UPDATE%"=="1" goto START_DEV
if "%RUN_AFTER_UPDATE%"=="2" goto START_PROD
goto MENU

:UPDATE_NO_REPO
echo.
echo [ERRORE] Non ti trovi dentro una cartella valida di PhotoCloud (package.json assente).
echo Usa l'opzione [4] per clonare la repository.
goto PAUSE_RETURN

:GIT_PULL_ERR
echo.
echo [ERRORE] Impossibile completare "git pull". Verifica la connessione internet o eventuali conflitti locali.
goto PAUSE_RETURN


:: ======================================================================
:: OPZIONE 4: Clona Repository Git
:: ======================================================================
:CLONE_REPO
cls
echo ======================================================================
echo   Clonazione Repository PhotoCloud
echo ======================================================================
call :ENSURE_TOOLS
if "%TOOLS_OK%"=="0" goto PAUSE_RETURN

echo.
set "TARGET_DIR=PhotoCloud"
set /p "TARGET_DIR=Inserisci il nome o percorso della cartella di destinazione [default: PhotoCloud]: "
if "%TARGET_DIR%"=="" set "TARGET_DIR=PhotoCloud"

if exist "%TARGET_DIR%\.git" goto CLONE_EXISTS_GIT
if exist "%TARGET_DIR%" goto CLONE_EXISTS_FOLDER

echo.
echo [INFO] Clonazione di %REPO_URL% in "%TARGET_DIR%"...
call git clone "%REPO_URL%" "%TARGET_DIR%"
if errorlevel 1 goto CLONE_ERR

cd /d "%TARGET_DIR%"
echo.
echo [INFO] Installazione dipendenze NPM nella nuova cartella...
call npm install
if errorlevel 1 goto CLONE_NPM_ERR
echo.
echo [OK] Repository clonata e configurata con successo in "%CD%"
cd /d "%~dp0"
goto PAUSE_RETURN

:CLONE_EXISTS_GIT
echo.
echo [AVVISO] La cartella "%TARGET_DIR%" contiene gia un repository Git.
set "PULL_EXISTING="
set /p "PULL_EXISTING=Vuoi aggiornarla con git pull e npm install? (S/N): "
if /i not "%PULL_EXISTING%"=="S" goto PAUSE_RETURN
cd /d "%TARGET_DIR%"
call git pull --rebase --autostash
call npm install
echo [OK] Cartella "%TARGET_DIR%" aggiornata.
cd /d "%~dp0"
goto PAUSE_RETURN

:CLONE_EXISTS_FOLDER
echo.
echo [ERRORE] La cartella "%TARGET_DIR%" esiste gia ma non e un repository Git.
echo Specifica un nome di cartella diverso.
goto PAUSE_RETURN

:CLONE_ERR
echo.
echo [ERRORE] Clonazione fallita. Verifica la connessione internet.
cd /d "%~dp0"
goto PAUSE_RETURN

:CLONE_NPM_ERR
echo.
echo [ERRORE] Installazione dipendenze NPM fallita nella cartella clonata.
cd /d "%~dp0"
goto PAUSE_RETURN


:: ======================================================================
:: OPZIONE 5: Verifica e Installa Dipendenze Mancanti
:: ======================================================================
:CHECK_DEPS_STANDALONE
cls
echo ======================================================================
echo   Verifica e Installazione Dipendenze
echo ======================================================================
call :ENSURE_TOOLS
if "%TOOLS_OK%"=="0" goto PAUSE_RETURN
if exist "%~dp0package.json" call :ENSURE_NODE_MODULES
echo.
echo [OK] Controllo dipendenze terminato.
goto PAUSE_RETURN


:: ======================================================================
:: OPZIONE 6: Compila APK Release Android
:: ======================================================================
:BUILD_APK
cls
echo ======================================================================
echo   Compilazione APK Release Android (v1.2.4)
echo ======================================================================
call :ENSURE_TOOLS
if "%TOOLS_OK%"=="0" goto PAUSE_RETURN
call :ENSURE_NODE_MODULES
if errorlevel 1 goto PAUSE_RETURN

echo.
echo [INFO] Avvio compilazione APK Release tramite "npm run release:apk"...
call npm run release:apk
goto PAUSE_RETURN


:: ======================================================================
:: Ritorno al menu e uscita
:: ======================================================================
:PAUSE_RETURN
echo.
echo ----------------------------------------------------------------------
echo Premi un tasto qualsiasi per tornare al menu principale...
pause >nul
cd /d "%~dp0"
goto MENU

:EXIT_APP
echo.
echo Uscita da PhotoCloud. Arrivederci!
endlocal
exit /b 0

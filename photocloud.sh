#!/usr/bin/env bash
# ==============================================================================
# PhotoCloud — Script di Gestione Interattivo per Linux e macOS
# Supporta: Clonazione repository, Aggiornamento, Installazione dipendenze e Avvio
# Nota: NON usiamo "set -e" globale per evitare che il menu interattivo si
# chiuda improvvisamente quando l'utente preme CTRL+C sul server o se un comando
# restituisce un codice di uscita non-zero.
# ==============================================================================

set -u

# Posizionati nella directory dello script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# Carica percorsi standard macOS Homebrew / Linux / NVM se presenti
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
fi

# Colori per il terminale
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

REPO_URL="https://github.com/ValerioMassimoDeCecco/PhotoCloud.git"

print_header() {
    clear 2>/dev/null || true
    echo -e "${CYAN}${BOLD}"
    echo "======================================================================"
    echo "           PhotoCloud — Gestione App (Linux / macOS)                  "
    echo "======================================================================"
    echo -e "${NC}"
    echo -e "  Cartella corrente: ${SCRIPT_DIR}\n"
}

print_success() {
    echo -e "${GREEN}✔ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✖ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

# Rileva il gestore dei pacchetti del sistema
detect_packager() {
    if command -v brew &>/dev/null; then
        echo "brew"
    elif command -v apt-get &>/dev/null; then
        echo "apt"
    elif command -v dnf &>/dev/null; then
        echo "dnf"
    elif command -v pacman &>/dev/null; then
        echo "pacman"
    else
        echo "unknown"
    fi
}

# Verifica e installa le dipendenze di sistema (Git, Node.js, npm)
check_system_tools() {
    echo -e "\n${BOLD}=== Verifica Strumenti di Sistema ===${NC}"
    local missing_deps=()
    local PKGER
    PKGER="$(detect_packager)"

    if command -v git &>/dev/null; then
        print_success "Git è installato: $(git --version 2>/dev/null)"
    else
        print_warning "Git NON risulta installato."
        missing_deps+=("git")
    fi

    if command -v node &>/dev/null; then
        print_success "Node.js è installato: $(node -v 2>/dev/null)"
    else
        print_warning "Node.js NON risulta installato."
        missing_deps+=("node")
    fi

    if command -v npm &>/dev/null; then
        print_success "npm è installato: v$(npm -v 2>/dev/null)"
    else
        print_warning "npm NON risulta installato."
        if [[ ! " ${missing_deps[*]} " =~ " node " ]]; then
            missing_deps+=("npm")
        fi
    fi

    if [ ${#missing_deps[@]} -gt 0 ]; then
        echo -e "\n${YELLOW}Rilevate dipendenze di sistema mancanti: ${missing_deps[*]}${NC}"
        read -rp "Vuoi tentare l'installazione automatica delle dipendenze mancanti? (s/N): " choice
        case "${choice:-n}" in
            [sS]*|[yY]*)
                case "$PKGER" in
                    brew)
                        print_info "Installazione tramite Homebrew (macOS / Linux)..."
                        brew install "${missing_deps[@]}" || return 1
                        ;;
                    apt)
                        print_info "Installazione tramite apt (Ubuntu / Debian)..."
                        sudo apt-get update
                        if [[ " ${missing_deps[*]} " =~ " node " ]]; then
                            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
                            sudo apt-get install -y nodejs git build-essential || return 1
                        else
                            sudo apt-get install -y "${missing_deps[@]}" || return 1
                        fi
                        ;;
                    dnf)
                        print_info "Installazione tramite dnf (Fedora / RHEL)..."
                        sudo dnf install -y "${missing_deps[@]}" || return 1
                        ;;
                    pacman)
                        print_info "Installazione tramite pacman (Arch Linux)..."
                        sudo pacman -Sy --noconfirm "${missing_deps[@]}" || return 1
                        ;;
                    *)
                        print_error "Gestore pacchetti non riconosciuto. Installa manualmente: ${missing_deps[*]}"
                        return 1
                        ;;
                esac
                ;;
            *)
                print_warning "Installazione annullata dall'utente."
                return 1
                ;;
        esac
    fi
    return 0
}

ensure_node_modules() {
    if [ ! -f "$SCRIPT_DIR/package.json" ]; then
        print_error "package.json non trovato in $SCRIPT_DIR."
        return 1
    fi
    if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
        print_info "La cartella node_modules non esiste. Esecuzione di 'npm install'..."
        npm install || {
            print_error "Errore durante 'npm install'."
            return 1
        }
        print_success "Dipendenze NPM installate con successo."
    else
        print_success "Le dipendenze NPM in node_modules sono presenti."
    fi
    return 0
}

# Wrapper di compatibilità chiamato dai test e dall'opzione 5
check_and_install_dependencies() {
    check_system_tools || return 1
    if [ -f "$SCRIPT_DIR/package.json" ]; then
        ensure_node_modules || return 1
    fi
    return 0
}

# Opzione 4: Clonare la repository in una cartella locale
clone_repository() {
    print_header
    echo -e "${BOLD}=== Clonazione Repository PhotoCloud ===${NC}\n"
    check_system_tools || return 1

    read -rp "Inserisci il percorso della cartella dove clonare (default: ./PhotoCloud): " target_dir
    target_dir="${target_dir:-PhotoCloud}"

    if [ -d "$target_dir/.git" ]; then
        print_warning "La cartella '$target_dir' contiene già un repository Git."
        read -rp "Vuoi aggiornarla con 'git pull' e 'npm install'? (s/N): " pull_choice
        case "${pull_choice:-n}" in
            [sS]*|[yY]*)
                (
                    cd "$target_dir" &&
                    git pull --rebase --autostash &&
                    npm install
                ) && print_success "Repository aggiornata in '$target_dir'."
                ;;
            *)
                print_info "Operazione annullata."
                ;;
        esac
    elif [ -d "$target_dir" ] && [ "$(ls -A "$target_dir" 2>/dev/null)" ]; then
        print_error "La cartella '$target_dir' esiste già e non è vuota."
    else
        print_info "Clonazione da $REPO_URL in '$target_dir'..."
        if git clone "$REPO_URL" "$target_dir"; then
            (
                cd "$target_dir" &&
                print_info "Installazione dipendenze NPM..." &&
                npm install
            ) && print_success "Clonazione e installazione completate in '$target_dir'!"
        else
            print_error "Errore durante git clone."
        fi
    fi
}

# Opzione 3: Aggiornare la web app localmente
update_webapp() {
    print_header
    echo -e "${BOLD}=== Aggiornamento Web App Localmente ===${NC}\n"

    check_system_tools || return 1

    if [ ! -f "$SCRIPT_DIR/package.json" ]; then
        print_error "Non ti trovi dentro una cartella valida di PhotoCloud (package.json assente)."
        return 1
    fi

    # Se la cartella è stata scaricata come ZIP (senza .git), offri il collegamento a GitHub
    if [ ! -d "$SCRIPT_DIR/.git" ]; then
        print_warning "Cartella .git non trovata (progetto scaricato probabilmente come archivio ZIP)."
        read -rp "Vuoi collegare questa cartella al repository GitHub per scaricare gli aggiornamenti? (s/N): " init_choice
        case "${init_choice:-n}" in
            [sS]*|[yY]*)
                git init &&
                git remote remove origin 2>/dev/null || true
                git remote add origin "$REPO_URL" &&
                git fetch origin main &&
                git checkout -f -B main origin/main || {
                    print_error "Impossibile collegare e scaricare il branch main."
                    return 1
                }
                ;;
            *)
                print_info "Passaggio a npm install e npm run build..."
                ;;
        esac
    else
        print_info "1/3. Download ultimi aggiornamenti dal repository git (git pull)..."
        if ! git pull --rebase --autostash; then
            print_info "Tentativo di allineamento dal branch origin/main..."
            git pull origin main || {
                print_error "Errore durante git pull."
                return 1
            }
        fi
    fi

    print_info "2/3. Sincronizzazione dipendenze NPM (npm install)..."
    npm install || {
        print_error "Errore durante npm install."
        return 1
    }

    print_info "3/3. Compilazione bundle Web App (npm run build)..."
    npm run build || {
        print_error "Errore durante npm run build."
        return 1
    }

    print_success "Aggiornamento completato con successo!"
    echo ""
    read -rp "Vuoi avviare subito la Web App? [1=Sviluppo, 2=Produzione, Invio=Torna al menu]: " run_now
    case "${run_now:-}" in
        1) start_dev ;;
        2) start_prod ;;
        *) ;;
    esac
}

# Opzione 1: Avviare la Web App in Sviluppo (Dev)
start_dev() {
    print_header
    echo -e "${BOLD}=== Avvio PhotoCloud (Modalità Sviluppo - Dev) ===${NC}\n"
    check_and_install_dependencies || return 1
    print_info "Avvio del server di sviluppo Express + Vite su http://localhost:3000 ..."
    print_info "Premi CTRL+C per fermare il server e tornare al menu."
    echo ""
    trap 'echo -e "\n${YELLOW}Server arrestato.${NC}"' INT
    npm run dev
    trap - INT
}

# Opzione 2: Avviare la Web App in Produzione (Start)
start_prod() {
    print_header
    echo -e "${BOLD}=== Avvio PhotoCloud (Modalità Produzione - Prod) ===${NC}\n"
    check_and_install_dependencies || return 1
    if [ ! -d "$SCRIPT_DIR/dist" ]; then
        print_info "Compilazione bundle produzione (npm run build)..."
        npm run build || {
            print_error "Errore durante npm run build."
            return 1
        }
    fi
    read -rp "Inserisci la porta per il server (default: 3000): " custom_port
    custom_port="${custom_port:-3000}"
    print_info "Avvio del server Node.js su http://localhost:${custom_port} ..."
    print_info "Premi CTRL+C per fermare il server e tornare al menu."
    echo ""
    trap 'echo -e "\n${YELLOW}Server arrestato.${NC}"' INT
    PORT="$custom_port" npm start
    trap - INT
}

# Opzione 6: Compilare APK Android Release
build_android_apk() {
    print_header
    echo -e "${BOLD}=== Compilazione APK Release Android (v1.2.9) ===${NC}\n"
    check_and_install_dependencies || return 1

    if command -v gradle &>/dev/null || [ -f "$SCRIPT_DIR/android-app/gradlew" ]; then
        print_info "Compilazione APK tramite script di release (npm run release:apk)..."
        npm run release:apk &&
            print_success "APK compilato in release/photocloud-release-v1.2.9-signed.apk"
    else
        print_error "Gradle / Android SDK non trovati nel sistema."
        print_info "Per compilare l'APK Android occorrono JDK 17 e Android SDK 35."
    fi
}

# Loop menu principale
main_menu() {
    while true; do
        cd "$SCRIPT_DIR" || exit 1
        print_header
        echo -e "Seleziona un'operazione:\n"
        echo -e "  ${BOLD}1)${NC} ${GREEN}Avvia PhotoCloud${NC} (Modalità Sviluppo — npm run dev)"
        echo -e "  ${BOLD}2)${NC} ${GREEN}Avvia PhotoCloud${NC} (Modalità Produzione — npm start)"
        echo -e "  ${BOLD}3)${NC} ${CYAN}Aggiorna la Web App${NC} (git pull + npm install + build)"
        echo -e "  ${BOLD}4)${NC} ${CYAN}Clona Repository Git${NC} (in un'altra cartella)"
        echo -e "  ${BOLD}5)${NC} ${YELLOW}Verifica e Installa Dipendenze Mancanti${NC} (Git, Node.js, npm)"
        echo -e "  ${BOLD}6)${NC} ${BLUE}Compila APK Release Android${NC} (v1.2.9)"
        echo -e "  ${BOLD}7)${NC} ${RED}Esci${NC}"
        echo -e ""
        read -rp "Scelta [1-7]: " menu_choice

        case "${menu_choice:-}" in
            1) start_dev ;;
            2) start_prod ;;
            3) update_webapp ;;
            4) clone_repository ;;
            5) print_header; check_and_install_dependencies ;;
            6) build_android_apk ;;
            7) echo -e "\nArrivederci!\n"; exit 0 ;;
            *) print_error "Scelta non valida. Riprova." ;;
        esac

        echo -e "\nPremere INVIO per tornare al menu principale..."
        read -r _
    done
}

main_menu

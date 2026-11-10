#!/usr/bin/env bash
# ==============================================================================
# PhotoCloud — Script di Gestione Interattivo per Linux e macOS
# Supporta: Clonazione repository, Aggiornamento, Installazione dipendenze e Avvio
# ==============================================================================

set -e

# Posizionati nella directory dello script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colori per il terminale
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

REPO_URL="https://github.com/ValerioMassimoDeCecco/PhotoCloud.git"

print_header() {
    clear 2>/dev/null || true
    echo -e "${CYAN}${BOLD}"
    echo "======================================================================"
    echo "           PhotoCloud — Gestione App (Linux / macOS)                  "
    echo "======================================================================"
    echo -e "${NC}"
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
check_and_install_dependencies() {
    echo -e "\n${BOLD}=== Verifica Dipendenze di Sistema ===${NC}"
    local missing_deps=()
    local PKGER
    PKGER=$(detect_packager)

    # 1. Verifica Git
    if command -v git &>/dev/null; then
        print_success "Git è installato: $(git --version)"
    else
        print_warning "Git NON risulta installato."
        missing_deps+=("git")
    fi

    # 2. Verifica Node.js
    if command -v node &>/dev/null; then
        NODE_VER=$(node -v)
        print_success "Node.js è installato: $NODE_VER"
    else
        print_warning "Node.js NON risulta installato."
        missing_deps+=("node")
    fi

    # 3. Verifica npm
    if command -v npm &>/dev/null; then
        NPM_VER=$(npm -v)
        print_success "npm è installato: v$NPM_VER"
    else
        print_warning "npm NON risulta installato."
        missing_deps+=("npm")
    fi

    # Se ci sono dipendenze mancanti, prova ad installarle
    if [ ${#missing_deps[@]} -gt 0 ]; then
        echo -e "\n${YELLOW}Rilevate dipendenze mancanti: ${missing_deps[*]}${NC}"
        read -rp "Vuoi tentare l'installazione automatica delle dipendenze mancanti? (s/N): " choice
        case "$choice" in
            [sS][eE][sS]|[sS])
                case "$PKGER" in
                    brew)
                        print_info "Installazione tramite Homebrew (macOS / Linux)..."
                        brew install "${missing_deps[@]}"
                        ;;
                    apt)
                        print_info "Installazione tramite apt (Ubuntu / Debian)..."
                        sudo apt-get update
                        if [[ " ${missing_deps[*]} " =~ " node " ]]; then
                            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
                            sudo apt-get install -y nodejs git build-essential
                        else
                            sudo apt-get install -y git
                        fi
                        ;;
                    dnf)
                        print_info "Installazione tramite dnf (Fedora / RHEL)..."
                        sudo dnf install -y "${missing_deps[@]}"
                        ;;
                    pacman)
                        print_info "Installazione tramite pacman (Arch Linux)..."
                        sudo pacman -Sy --noconfirm "${missing_deps[@]}"
                        ;;
                    *)
                        print_error "Gestore pacchetti non riconosciuto. Installa manualmente: ${missing_deps[*]}"
                        return 1
                        ;;
                esac
                ;;
            *)
                print_warning "Installazione annullata dall'utente. Alcune funzionalità potrebbero non funzionare."
                ;;
        esac
    fi

    # 4. Verifica dipendenze NPM del progetto (node_modules)
    if [ -f "$SCRIPT_DIR/package.json" ]; then
        if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
            print_info "La cartella node_modules non esiste. Esecuzione di 'npm install'..."
            npm install
            print_success "Dipendenze NPM installate con successo."
        else
            print_success "Le dipendenze NPM in node_modules sono presenti."
        fi
    fi
}

# Opzione 1: Clonare la repository in una cartella locale
clone_repository() {
    print_header
    echo -e "${BOLD}=== Clonazione Repository PhotoCloud ===${NC}\n"
    read -rp "Inserisci il percorso della cartella dove clonare (default: ./PhotoCloud): " target_dir
    target_dir="${target_dir:-PhotoCloud}"

    if [ -d "$target_dir" ] && [ "$(ls -A "$target_dir" 2>/dev/null)" ]; then
        print_warning "La cartella '$target_dir' esiste già e non è vuota."
        read -rp "Vuoi aggiornarla con 'git pull'? (s/N): " pull_choice
        case "$pull_choice" in
            [sS][eE][sS]|[sS])
                cd "$target_dir"
                git pull
                npm install
                print_success "Repository aggiornata in '$target_dir'."
                cd "$SCRIPT_DIR"
                ;;
            *)
                print_info "Operazione annullata."
                ;;
        esac
    else
        print_info "Clonazione da $REPO_URL in '$target_dir'..."
        git clone "$REPO_URL" "$target_dir"
        cd "$target_dir"
        print_info "Installazione dipendenze NPM..."
        npm install
        print_success "Clonazione e installazione completate in '$target_dir'!"
        cd "$SCRIPT_DIR"
    fi
}

# Opzione 2: Aggiornare la web app localmente
update_webapp() {
    print_header
    echo -e "${BOLD}=== Aggiornamento Web App Localmente ===${NC}\n"

    check_and_install_dependencies

    print_info "1/4. Download ultimi aggiornamenti dal repository git (git pull)..."
    git pull || { print_error "Errore durante git pull"; return 1; }

    print_info "2/4. Sincronizzazione dipendenze NPM (npm install)..."
    npm install || { print_error "Errore durante npm install"; return 1; }

    print_info "3/4. Compilazione bundle Web App (npm run build)..."
    npm run build || { print_error "Errore durante npm run build"; return 1; }

    print_success "4/4. Aggiornamento completato con successo!"
}

# Opzione 3: Avviare la Web App in Sviluppo (Dev)
start_dev() {
    print_header
    echo -e "${BOLD}=== Avvio PhotoCloud (Modalità Sviluppo - Dev) ===${NC}\n"
    check_and_install_dependencies
    print_info "Avvio del server di sviluppo Express + Vite sulla porta 3000..."
    npm run dev
}

# Opzione 4: Avviare la Web App in Produzione (Start)
start_prod() {
    print_header
    echo -e "${BOLD}=== Avvio PhotoCloud (Modalità Produzione - Prod) ===${NC}\n"
    check_and_install_dependencies
    if [ ! -d "$SCRIPT_DIR/dist" ]; then
        print_info "Compilazione bundle produzione (npm run build)..."
        npm run build
    fi
    read -rp "Inserisci la porta per il server (default: 3000): " custom_port
    custom_port="${custom_port:-3000}"
    print_info "Avvio del server Node.js sulla porta $custom_port..."
    PORT="$custom_port" npm start
}

# Opzione 5: Compilare APK Android Release
build_android_apk() {
    print_header
    echo -e "${BOLD}=== Compilazione APK Release Android (v1.2.4) ===${NC}\n"
    check_and_install_dependencies

    if command -v gradle &>/dev/null || [ -f "$SCRIPT_DIR/android-app/gradlew" ]; then
        print_info "Compilazione APK tramite script di release (npm run release:apk)..."
        npm run release:apk
        print_success "APK compilato in release/photocloud-release-v1.2.4-signed.apk"
    else
        print_error "Gradle / Android SDK non trovati nel sistema."
        print_info "Per compilare l'APK Android occorrono JDK 17 e Android SDK 35."
    fi
}

# Loop menu principale
main_menu() {
    while true; do
        print_header
        echo -e "Seleziona un'operazione:\n"
        echo -e "  ${BOLD}1)${NC} ${GREEN}Avvia PhotoCloud${NC} (Modalità Sviluppo — npm run dev)"
        echo -e "  ${BOLD}2)${NC} ${GREEN}Avvia PhotoCloud${NC} (Modalità Produzione — npm start)"
        echo -e "  ${BOLD}3)${NC} ${CYAN}Aggiorna la Web App${NC} (git pull + npm install + build)"
        echo -e "  ${BOLD}4)${NC} ${CYAN}Clona Repository Git${NC} (in un'altra cartella)"
        echo -e "  ${BOLD}5)${NC} ${YELLOW}Verifica e Installa Dipendenze Mancanti${NC} (Git, Node.js, npm)"
        echo -e "  ${BOLD}6)${NC} ${BLUE}Compila APK Release Android${NC} (v1.2.4)"
        echo -e "  ${BOLD}7)${NC} ${RED}Esci${NC}"
        echo -e ""
        read -rp "Scelta [1-7]: " menu_choice

        case "$menu_choice" in
            1) start_dev ;;
            2) start_prod ;;
            3) update_webapp ;;
            4) clone_repository ;;
            5) print_header; check_and_install_dependencies ;;
            6) build_android_apk ;;
            7) echo -e "\nArrivederci!\n"; exit 0 ;;
            *) print_error "Scelta non valida. Riprova." ;;
        esac

        echo -e "\nPremere invio per tornare al menu principale..."
        read -r
    done
}

# Esegui il menu principale
main_menu

// static/scripts/security.js

async function loadTrustedBrowsers() {
    try {
        const response = await fetch('/api/trusted-browsers');
        const browsers = await response.json();
        
        const container = document.getElementById('trusted-browsers-list');
        container.innerHTML = '';
        
        browsers.forEach(browser => {
            const browserElement = createBrowserElement(browser);
            container.appendChild(browserElement);
        });
    } catch (error) {
        console.error('Error loading trusted browsers:', error);
    }
}

async function loadActiveSessions() {
    try {
        const response = await fetch('/api/sessions');
        const sessions = await response.json();
        
        const container = document.getElementById('active-sessions-list');
        container.innerHTML = '';
        
        sessions.forEach(session => {
            const sessionElement = createSessionElement(session);
            container.appendChild(sessionElement);
        });
    } catch (error) {
        console.error('Error loading active sessions:', error);
    }
}

async function loadPendingRequests() {
    try {
        const response = await fetch('/api/pending-requests');
        const requests = await response.json();
        
        const container = document.getElementById('pending-requests-list');
        container.innerHTML = '';
        
        requests.forEach(request => {
            const requestElement = createRequestElement(request);
            container.appendChild(requestElement);
        });
    } catch (error) {
        console.error('Error loading pending requests:', error);
    }
}

function createBrowserElement(browser) {
    const element = document.createElement('div');
    element.className = 'browser-item';
    
    element.innerHTML = `
        <div class="browser-info">
            <span class="browser-icon">${getBrowserIcon(browser.browser)}</span>
            <div class="browser-details">
                <h4>${browser.browser} ${browser.version}</h4>
                <p>${browser.platform} • ${browser.ip}</p>
                <p class="browser-time">Ultimo uso: ${formatTime(browser.last_used)}</p>
            </div>
        </div>
        <button class="btn icon danger revoke-browser" data-browser-id="${browser.id}">
            <span class="material-icons">delete</span>
        </button>
    `;
    
    return element;
}

function createRequestElement(request) {
    const element = document.createElement('div');
    element.className = 'request-item';
    
    element.innerHTML = `
        <div class="request-info">
            <span class="browser-icon">${getBrowserIcon(request.browser_info.browser)}</span>
            <div class="request-details">
                <h4>${request.browser_info.browser} ${request.browser_info.version}</h4>
                <p>${request.browser_info.platform} • ${request.browser_info.ip}</p>
                <p class="request-time">Richiesto: ${formatTime(request.created_at)}</p>
            </div>
        </div>
        <div class="request-actions">
            <button class="btn primary approve-request" data-request-id="${request.id}">
                <span class="material-icons">check</span> Approva
            </button>
            <button class="btn danger deny-request" data-request-id="${request.id}">
                <span class="material-icons">close</span> Nega
            </button>
        </div>
    `;
    
    return element;
}
// Application State
let serverStatus = 'stopped';
let commandHistory = [];
let historyIndex = -1;
let currentTab = 'tab-active';

// Cache DOM Elements
const connectionDot = document.getElementById('connection-dot');
const connectionText = document.getElementById('connection-text');
const modeBadge = document.getElementById('mode-badge');

const statusRing = document.getElementById('status-ring');
const statusLabel = document.getElementById('server-status-label');

const cpuValue = document.getElementById('cpu-value');
const cpuBar = document.getElementById('cpu-bar');
const ramValue = document.getElementById('ram-value');
const ramBar = document.getElementById('ram-bar');

const localIpText = document.getElementById('local-ip-text');
const tailscaleIpText = document.getElementById('tailscale-ip-text');
const portText = document.getElementById('port-text');

const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const btnKill = document.getElementById('btn-kill');
const btnLock = document.getElementById('btn-lock');

const terminalOutput = document.getElementById('terminal-output');
const terminalForm = document.getElementById('terminal-form');
const terminalInput = document.getElementById('terminal-input');
const btnClearTerm = document.getElementById('btn-clear-term');

const activeCount = document.getElementById('active-count');
const opsCount = document.getElementById('ops-count');
const wlCount = document.getElementById('wl-count');
const bannedCount = document.getElementById('banned-count');

const activeList = document.getElementById('active-players-list');
const opsList = document.getElementById('ops-players-list');
const wlList = document.getElementById('whitelist-players-list');
const bannedList = document.getElementById('banned-players-list');

const playerActionInput = document.getElementById('player-action-input');
const btnAddWhitelist = document.getElementById('btn-add-whitelist');
const btnAddOp = document.getElementById('btn-add-op');
const btnAddBan = document.getElementById('btn-add-ban');

// Tab Switching
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        
        btn.classList.add('active');
        const tabId = btn.getAttribute('data-tab');
        document.getElementById(tabId).classList.add('active');
        currentTab = tabId;
    });
});

// INITIALIZE EVENT SOURCE (SSE)
let eventSource = null;

function connectSSE() {
    if (eventSource) {
        eventSource.close();
    }
    
    eventSource = new EventSource('/api/logs');
    
    eventSource.onopen = () => {
        connectionDot.className = 'status-dot connected';
        connectionText.textContent = 'Connected';
    };
    
    eventSource.onerror = () => {
        connectionDot.className = 'status-dot disconnected';
        connectionText.textContent = 'Disconnected (Retrying...)';
    };
    
    // Custom events
    eventSource.addEventListener('connected', (e) => {
        const data = JSON.parse(e.data);
        modeBadge.textContent = `${data.mode} Mode`;
        if (data.mode === 'Simulator') {
            modeBadge.className = 'badge badge-simulator';
        } else {
            modeBadge.className = 'badge badge-production';
        }
    });

    eventSource.addEventListener('log', (e) => {
        appendLogLine(e.data);
    });

    eventSource.addEventListener('status_change', (e) => {
        const data = JSON.parse(e.data);
        updateStatusUI(data.status);
    });

    eventSource.addEventListener('status_update', () => {
        refreshPlayers();
    });

    eventSource.addEventListener('stats', (e) => {
        const data = JSON.parse(e.data);
        updateStatsUI(data.cpu, data.ram);
    });
}

// LOG TERMINAL PARSER & APPENDER
function appendLogLine(line) {
    const lineEl = document.createElement('div');
    lineEl.className = 'terminal-line';
    
    // Parse timestamp and logs
    if (line.includes('[Server thread/WARN]')) {
        lineEl.classList.add('log-warn');
    } else if (line.includes('[Server thread/ERROR]') || line.includes('[System/WARNING]')) {
        lineEl.classList.add('log-error');
    } else if (line.includes('[Console/Command]') || line.includes('[Console/Action]')) {
        lineEl.classList.add('log-command');
    } else if (line.includes('[System]')) {
        lineEl.classList.add('system-line');
    } else {
        lineEl.classList.add('log-info');
    }
    
    lineEl.textContent = line;
    terminalOutput.appendChild(lineEl);
    
    // Auto-scroll
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

// UI UPDATES
function updateStatusUI(status) {
    serverStatus = status;
    statusLabel.textContent = status.toUpperCase();
    
    // Update colors
    statusRing.className = `status-pulse-ring status-${status}`;
    statusLabel.className = 'status-text-lg';
    if (status === 'running') statusLabel.classList.add('text-glowing-green');
    else if (status === 'starting' || status === 'stopping') statusLabel.classList.add('text-glowing-orange');
    else statusLabel.classList.add('text-glowing-red');

    // Enable/Disable controls
    btnStart.disabled = (status !== 'stopped');
    btnStop.disabled = (status !== 'running');
    btnKill.disabled = (status === 'stopped');
    btnLock.disabled = (status !== 'stopped');
}

function updateStatsUI(cpu, ram) {
    cpuValue.textContent = `${cpu}%`;
    cpuBar.style.width = `${cpu}%`;
    
    ramValue.textContent = `${ram} / 4 GB`;
    // calculate ram percent based on 4GB limit
    const ramPercent = Math.min((parseFloat(ram) / 4.0) * 100, 100);
    ramBar.style.width = `${ramPercent}%`;
}

// FETCH STATIC STATE
function loadInitialState() {
    fetch('/api/server/status')
        .then(res => res.json())
        .then(data => {
            updateStatusUI(data.status);
            updateStatsUI(data.cpu, data.ram);
            localIpText.textContent = data.localIp;
            tailscaleIpText.textContent = data.tailscaleIp;
            portText.textContent = data.port;
            refreshPlayers();
        })
        .catch(err => console.error('Failed fetching status:', err));
}

// PLAYERS TAB SYNC
function refreshPlayers() {
    fetch('/api/server/players')
        .then(res => res.json())
        .then(data => {
            renderActive(data.active, data.operators);
            renderOperators(data.operators);
            renderWhitelist(data.whitelist);
            renderBanned(data.banned);
        })
        .catch(err => console.error('Failed fetching players:', err));
}

// Player rendering helper
function createPlayerRow(name, badgeText, badgeClass, actions) {
    const item = document.createElement('div');
    item.className = 'player-item';
    
    const info = document.createElement('div');
    info.className = 'player-info-wrapper';
    
    const avatar = document.createElement('img');
    avatar.className = 'player-avatar';
    avatar.src = `https://minotar.net/helm/${name}/32.png`;
    avatar.alt = name;
    avatar.onerror = () => {
        // Fallback generic avatar if minotar fails or offline
        avatar.src = `data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect width=%22100%22 height=%22100%22 fill=%22%23444%22/><text y=%22.7em%22 x=%22.15em%22 font-size=%2260%22 fill=%22white%22>${name[0]}</text></svg>`;
    };

    const meta = document.createElement('div');
    meta.className = 'player-meta';
    
    const nameEl = document.createElement('span');
    nameEl.className = 'player-name';
    nameEl.textContent = name;
    
    const badge = document.createElement('span');
    badge.className = `player-badge ${badgeClass}`;
    badge.textContent = badgeText;
    
    meta.appendChild(nameEl);
    meta.appendChild(badge);
    info.appendChild(avatar);
    info.appendChild(meta);
    item.appendChild(info);

    // Actions block
    const actionsWrapper = document.createElement('div');
    actionsWrapper.className = 'player-actions';

    actions.forEach(act => {
        const btn = document.createElement('button');
        btn.className = `btn-icon ${act.cls}`;
        btn.title = act.label;
        btn.innerHTML = act.svg;
        btn.onclick = () => {
            btn.disabled = true;
            fetch(act.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: name })
            })
            .then(res => res.json())
            .then(res => {
                if (res.success) refreshPlayers();
                else alert(res.error || 'Operation failed');
            })
            .catch(err => console.error(err))
            .finally(() => btn.disabled = false);
        };
        actionsWrapper.appendChild(btn);
    });

    item.appendChild(actionsWrapper);
    return item;
}

// Render Lists
function renderActive(active, operators) {
    activeCount.textContent = active.length;
    activeList.innerHTML = '';
    
    if (active.length === 0) {
        activeList.innerHTML = '<div class="empty-list-msg">No players online.</div>';
        return;
    }

    active.forEach(player => {
        const isOp = operators.some(o => o.name.toLowerCase() === player.toLowerCase());
        const badgeText = isOp ? 'OP' : 'User';
        const badgeClass = isOp ? 'badge-op' : 'badge-user';

        // SVGs
        const svgDeop = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="18" y1="8" x2="23" y2="13"/></svg>`;
        const svgOp = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="17" y1="11" x2="23" y2="11"/></svg>`;
        const svgKick = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`;
        const svgBan = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`;

        const actions = [
            {
                label: isOp ? 'De-OP Player' : 'OP Player',
                cls: isOp ? 'hover-red' : 'hover-cyan',
                svg: isOp ? svgDeop : svgOp,
                url: isOp ? '/api/server/players/deop' : '/api/server/players/op'
            },
            {
                label: 'Kick Player',
                cls: 'hover-red',
                svg: svgKick,
                url: '/api/server/players/kick'
            },
            {
                label: 'Ban Player',
                cls: 'hover-red',
                svg: svgBan,
                url: '/api/server/players/ban'
            }
        ];

        activeList.appendChild(createPlayerRow(player, badgeText, badgeClass, actions));
    });
}

function renderOperators(operators) {
    opsCount.textContent = operators.length;
    opsList.innerHTML = '';
    
    if (operators.length === 0) {
        opsList.innerHTML = '<div class="empty-list-msg">No Operators.</div>';
        return;
    }

    operators.forEach(op => {
        const svgDeop = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="18" y1="8" x2="23" y2="13"/></svg>`;
        
        const actions = [
            {
                label: 'De-OP Operator',
                cls: 'hover-red',
                svg: svgDeop,
                url: '/api/server/players/deop'
            }
        ];

        opsList.appendChild(createPlayerRow(op.name, `Level ${op.level}`, 'badge-op', actions));
    });
}

function renderWhitelist(wl) {
    wlCount.textContent = wl.length;
    wlList.innerHTML = '';
    
    if (wl.length === 0) {
        wlList.innerHTML = '<div class="empty-list-msg">Whitelist is empty.</div>';
        return;
    }

    wl.forEach(name => {
        const svgRemove = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
        
        const actions = [
            {
                label: 'Remove from Whitelist',
                cls: 'hover-red',
                svg: svgRemove,
                url: '/api/server/players/whitelist_remove'
            }
        ];

        wlList.appendChild(createPlayerRow(name, 'Whitelisted', 'badge-wl', actions));
    });
}

function renderBanned(banned) {
    bannedCount.textContent = banned.length;
    bannedList.innerHTML = '';
    
    if (banned.length === 0) {
        bannedList.innerHTML = '<div class="empty-list-msg">No banned players.</div>';
        return;
    }

    banned.forEach(name => {
        const svgUnban = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`;
        
        const actions = [
            {
                label: 'Pardon (Unban) Player',
                cls: 'hover-cyan',
                svg: svgUnban,
                url: '/api/server/players/pardon'
            }
        ];

        bannedList.appendChild(createPlayerRow(name, 'Banned', 'badge-op', actions));
    });
}

// ACTION BUTTON EVENT BINDINGS
btnStart.onclick = () => {
    btnStart.disabled = true;
    fetch('/api/server/start', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if (!data.success) {
                alert('Failed to start: ' + data.error);
                btnStart.disabled = false;
            }
        });
};

btnStop.onclick = () => {
    btnStop.disabled = true;
    fetch('/api/server/stop', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if (!data.success) {
                alert('Failed to stop: ' + data.error);
                btnStop.disabled = false;
            }
        });
};

btnKill.onclick = () => {
    if (confirm('Are you sure you want to force kill the java process? This can corrupt world files!')) {
        btnKill.disabled = true;
        fetch('/api/server/kill', { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                if (!data.success) {
                    alert('Failed to kill: ' + data.error);
                    btnKill.disabled = false;
                }
            });
    }
};

btnLock.onclick = () => {
    btnLock.disabled = true;
    fetch('/api/server/clearlock', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            alert(data.message);
        })
        .finally(() => {
            btnLock.disabled = false;
        });
};

btnClearTerm.onclick = () => {
    terminalOutput.innerHTML = '<div class="terminal-line system-line">[System] Terminal output cleared.</div>';
};

// TERMINAL COMMAND SUBMIT
terminalForm.onsubmit = (e) => {
    e.preventDefault();
    const cmd = terminalInput.value.trim();
    if (!cmd) return;

    // Send to backend
    fetch('/api/server/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd })
    });

    // History management
    commandHistory.push(cmd);
    if (commandHistory.length > 50) commandHistory.shift();
    historyIndex = commandHistory.length;

    terminalInput.value = '';
};

// Terminal command history UP/DOWN keys
terminalInput.onkeydown = (e) => {
    if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (historyIndex > 0) {
            historyIndex--;
            terminalInput.value = commandHistory[historyIndex];
        }
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (historyIndex < commandHistory.length - 1) {
            historyIndex++;
            terminalInput.value = commandHistory[historyIndex];
        } else {
            historyIndex = commandHistory.length;
            terminalInput.value = '';
        }
    }
};

// QUICK ADD PLAYER UTILITIES
function executePlayerAction(actionUrl) {
    const username = playerActionInput.value.trim();
    if (!username) {
        alert('Please enter a username');
        return;
    }
    fetch(actionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username })
    })
    .then(res => res.json())
    .then(res => {
        if (res.success) {
            playerActionInput.value = '';
            refreshPlayers();
        } else {
            alert(res.error || 'Operation failed');
        }
    });
}

btnWlAdd = document.getElementById('btn-add-whitelist');
btnWlAdd.onclick = () => executePlayerAction('/api/server/players/whitelist_add');

btnOpAdd = document.getElementById('btn-add-op');
btnOpAdd.onclick = () => executePlayerAction('/api/server/players/op');

btnBanAdd = document.getElementById('btn-add-ban');
btnBanAdd.onclick = () => executePlayerAction('/api/server/players/ban');

// BOOTSTRAP
loadInitialState();
connectSSE();
// Periodically refresh players just in case
setInterval(refreshPlayers, 15000);

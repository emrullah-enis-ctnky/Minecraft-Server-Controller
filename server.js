const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const os = require('os');
const { EventEmitter } = require('events');

const PORT = 8080;
const SERVER_DIR = path.dirname(__dirname);
const LOG_FILE = path.join(SERVER_DIR, 'logs', 'latest.log');
const JAR_FILE = path.join(SERVER_DIR, 'server.jar');
const LOCK_FILE = path.join(SERVER_DIR, 'world', 'session.lock');

// Event emitter for broadcasting logs and status updates to UI clients (SSE)
const sseBroadcaster = new EventEmitter();

// Application State
let isSimulatorMode = false;
let serverStatus = 'stopped'; // stopped, starting, running, stopping
let activePlayers = new Set();
let operatorList = []; // Array of { name, level }
let whitelist = []; // Array of names
let bannedPlayers = []; // Array of names
let activeTailProcess = null;
let realLogHistory = [];

// Simulator variables
let simulatorIntervals = [];
let simLogHistory = [];
let simCpu = 0;
let simRam = 0;

// Helper: Find actual server JAR name
function getJarFilename() {
  try {
    if (fs.existsSync(SERVER_DIR)) {
      const files = fs.readdirSync(SERVER_DIR);
      const jar = files.find(f => f.endsWith('.jar') && (f.startsWith('server') || f.startsWith('paper') || f.startsWith('spigot') || f.startsWith('purpur')));
      if (jar) return jar;
      const anyJar = files.find(f => f.endsWith('.jar'));
      if (anyJar) return anyJar;
    }
  } catch (e) {}
  return 'server.jar';
}

// Verify server environment and choose mode
function initEnvironment() {
  console.log(`Checking Minecraft server directory: ${SERVER_DIR}`);
  if (!fs.existsSync(SERVER_DIR)) {
    console.log(`Server directory not found. Creating placeholder directory: ${SERVER_DIR}`);
    fs.mkdirSync(SERVER_DIR, { recursive: true });
  }

  // Create logs directory
  const logsDir = path.join(SERVER_DIR, 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  // Check if real Minecraft server exists (if latest.log exists OR jar exists OR properties exist)
  const hasLog = fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 0;
  const jarName = getJarFilename();
  const hasJar = fs.existsSync(path.join(SERVER_DIR, jarName));
  const hasProperties = fs.existsSync(path.join(SERVER_DIR, 'server.properties'));

  if (hasLog || hasJar || hasProperties) {
    isSimulatorMode = false;
    console.log(`[+] Real Minecraft server files detected at ${SERVER_DIR}. Running in PRODUCTION mode.`);
    loadRealData();
    startTailLog();
  } else {
    isSimulatorMode = true;
    console.warn(`\n[!] Real server files not found at ${SERVER_DIR}.\n[!] Running in SIMULATOR MODE for demonstration.\n`);
    loadMockData();
  }
}

// Helper: Get local LAN IP (highly compatible & ignores virtual interfaces)
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  let fallbackIP = '127.0.0.1';

  for (const name of Object.keys(interfaces)) {
    // Skip virtual/docker bridges
    if (name.startsWith('docker') || name.startsWith('vbox') || name.startsWith('br-') || name.startsWith('veth') || name.startsWith('lo')) {
      continue;
    }
    for (const iface of interfaces[name]) {
      // Check for both string 'IPv4' and numeric 4 to support different Node versions
      if ((iface.family === 'IPv4' || iface.family === 4) && !iface.internal) {
        const addr = iface.address;
        // Prioritize standard local private subnets
        if (addr.startsWith('192.168.') || addr.startsWith('10.') || addr.startsWith('172.')) {
          return addr;
        }
        fallbackIP = addr;
      }
    }
  }
  return fallbackIP;
}

// Helper: Get Tailscale IP (direct interface check + command fallback)
function getTailscaleIP(callback) {
  if (isSimulatorMode) {
    return callback('100.82.140.45'); // Simulated Tailscale IP
  }

  // 1. Direct Interface Check (Instant, avoids spawning sub-processes)
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    if (name.includes('tailscale') || name === 'ts0') {
      for (const iface of interfaces[name]) {
        if ((iface.family === 'IPv4' || iface.family === 4) && !iface.internal) {
          return callback(iface.address);
        }
      }
    }
  }

  // 2. Command Fallback
  exec('tailscale ip -4', (err, stdout) => {
    if (!err && stdout.trim()) {
      return callback(stdout.trim());
    }
    callback('VPN Offline');
  });
}

// Load mock config files for Simulator Mode
function loadMockData() {
  operatorList = [
    { name: 'Notch', level: 4 },
    { name: 'jeb_', level: 4 }
  ];
  whitelist = ['Steve', 'Alex', 'Dinnerbone', 'Grumm'];
  bannedPlayers = ['Herobrine'];
}

// Load actual config files from ~/mc_server
function loadRealData() {
  try {
    const opsPath = path.join(SERVER_DIR, 'ops.json');
    if (fs.existsSync(opsPath)) {
      const opsContent = fs.readFileSync(opsPath, 'utf8');
      const parsed = JSON.parse(opsContent);
      operatorList = parsed.map(op => ({ name: op.name, level: op.level || 4 }));
    } else {
      operatorList = [];
    }

    const wlPath = path.join(SERVER_DIR, 'whitelist.json');
    if (fs.existsSync(wlPath)) {
      const wlContent = fs.readFileSync(wlPath, 'utf8');
      const parsed = JSON.parse(wlContent);
      whitelist = parsed.map(w => w.name);
    } else {
      whitelist = [];
    }

    const banPath = path.join(SERVER_DIR, 'banned-players.json');
    if (fs.existsSync(banPath)) {
      const banContent = fs.readFileSync(banPath, 'utf8');
      const parsed = JSON.parse(banContent);
      bannedPlayers = parsed.map(b => b.name);
    } else {
      bannedPlayers = [];
    }
  } catch (e) {
    console.error('Error loading config JSON files:', e.message);
  }
}

// Send system event or log update to SSE clients
function broadcast(event, data) {
  sseBroadcaster.emit('message', { event, data });
}

// Append log helper (broadcasts to UI without modifying Minecraft's latest.log)
function addLog(message) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const formattedLog = `[${timestamp}] ${message}`;
  if (isSimulatorMode) {
    simLogHistory.push(formattedLog);
    if (simLogHistory.length > 300) simLogHistory.shift();
  } else {
    if (Array.isArray(realLogHistory)) {
      realLogHistory.push(formattedLog);
      if (realLogHistory.length > 300) realLogHistory.shift();
    }
  }
  broadcast('log', formattedLog);
}

// Check real server status via screen session detection (proven reliable method)
const screenEnv = { ...process.env, HOME: os.homedir(), TERM: 'xterm' };

function checkRealServerStatus(callback) {
  // First wipe dead sessions, then check for live mcsunucu
  exec('screen -wipe > /dev/null 2>&1; screen -ls 2>&1', { env: screenEnv }, (err, stdout) => {
    const output = (stdout || '') + (err && err.stdout ? err.stdout : '');
    // Check each line for mcsunucu - but ignore Dead sessions
    const lines = output.split('\n');
    let hasLiveScreen = false;
    for (const line of lines) {
      if (line.includes('mcsunucu') && !line.toLowerCase().includes('dead')) {
        hasLiveScreen = true;
        break;
      }
    }
    
    if (hasLiveScreen) {
      if (serverStatus === 'stopped' || serverStatus === 'starting') {
        serverStatus = 'running';
        broadcast('status_change', { status: serverStatus });
      }
      if (isSimulatorMode) {
        isSimulatorMode = false;
        loadRealData();
        startTailLog();
      }
    } else {
      if (serverStatus !== 'starting') {
        serverStatus = 'stopped';
        broadcast('status_change', { status: serverStatus });
      }
    }
    callback(serverStatus);
  });
}

// Get real process CPU and RAM metrics (normalized across all CPU cores)
function getRealProcessMetrics(callback) {
  if (isSimulatorMode || serverStatus === 'stopped') {
    return callback(0, 0);
  }
  exec('ps -C java -o %cpu,rss --no-headers', (err, stdout) => {
    if (err || !stdout.trim()) {
      return callback(0, 0);
    }
    const lines = stdout.trim().split('\n');
    let totalCpu = 0;
    let totalRssKb = 0;
    lines.forEach(l => {
      const parts = l.trim().split(/\s+/);
      totalCpu += parseFloat(parts[0]) || 0;
      totalRssKb += parseInt(parts[1]) || 0;
    });
    const cores = os.cpus().length || 1;
    const normalizedCpu = Math.min(100, Math.round(totalCpu / cores));
    const ramGb = (totalRssKb / (1024 * 1024)).toFixed(2);
    callback(normalizedCpu, ramGb);
  });
}

// Clean raw log lines so newlines/carriages don't break SSE framing
function sanitizeLogLine(line) {
  if (typeof line !== 'string') return '';
  return line.replace(/[\r\n]+/g, ' ').trim();
}

// Real server: Preload initial log lines
function startTailLog() {
  if (isSimulatorMode) return;
  try {
    if (fs.existsSync(LOG_FILE)) {
      const stats = fs.statSync(LOG_FILE);
      lastLogSize = Math.max(0, stats.size - 20000);
    }
  } catch (e) {}
}

function parseLogLineForPlayers(line) {
  const reserved = ['UUID', 'Server', 'Geyser', 'Paper', 'ViaVersion', 'Floodgate', 'System', 'INFO', 'WARN', 'ERROR', 'ThreadedAnvilChunkStorage', 'ChunkHolderManager'];
  
  if (line.includes('joined the game')) {
    const match = line.match(/([A-Za-z0-9_*]{2,16})(?:\[\/[\d\.:]+\])?\s+joined the game/);
    if (match && match[1] && !reserved.includes(match[1])) {
      activePlayers.add(match[1]);
      broadcast('status_update', { activePlayers: Array.from(activePlayers) });
    }
  } else if (line.includes('left the game') || line.includes('lost connection')) {
    const match = line.match(/([A-Za-z0-9_*]{2,16})\s+(?:left the game|lost connection)/);
    if (match && match[1]) {
      activePlayers.delete(match[1]);
      broadcast('status_update', { activePlayers: Array.from(activePlayers) });
    }
  }
}

// SIMULATOR CONTROLS
function startSimulator() {
  if (serverStatus !== 'stopped') return;
  serverStatus = 'starting';
  broadcast('status_change', { status: serverStatus });

  addLog('[Server thread/INFO]: Starting minecraft server version 1.21');
  addLog('[Server thread/INFO]: Loading properties');
  addLog('[Server thread/INFO]: Default game type: SURVIVAL');
  addLog('[Server thread/INFO]: Generating keypair');
  
  let bootStep = 0;
  const bootInterval = setInterval(() => {
    bootStep++;
    if (bootStep === 1) {
      addLog('[Server thread/INFO]: [Geyser-Spigot] Loading Geyser-Spigot v2.4.2-b663');
      addLog('[Server thread/INFO]: [Floodgate] Loading floodgate v2.2.3-b108');
      addLog('[Server thread/INFO]: [ViaVersion] Loading ViaVersion v5.0.1');
    } else if (bootStep === 2) {
      addLog('[Server thread/INFO]: Preparing level "world"');
      addLog('[Server thread/INFO]: Preparing start region for dimension minecraft:overworld');
    } else if (bootStep === 3) {
      addLog('[Server thread/INFO]: [Geyser-Spigot] Started Geyser on 0.0.0.0:19132');
      addLog('[Server thread/INFO]: [Geyser-Spigot] Bedrock cross-play translation bridge is READY.');
    } else if (bootStep === 4) {
      addLog('[Server thread/INFO]: Time elapsed: 4850 ms');
      addLog('[Server thread/INFO]: Done (5.21s)! For help, type "help"');
      
      serverStatus = 'running';
      broadcast('status_change', { status: serverStatus });
      clearInterval(bootInterval);

      // Start mock players joining and CPU ticks
      startSimulatorLifecycle();
    }
  }, 1500);

  simulatorIntervals.push(bootInterval);
}

function startSimulatorLifecycle() {
  // Tick stats
  const statsInterval = setInterval(() => {
    if (serverStatus !== 'running') return;
    simCpu = Math.floor(5 + Math.random() * 25 + (activePlayers.size * 8));
    simRam = (1.8 + (activePlayers.size * 0.15) + Math.random() * 0.05).toFixed(2);
    broadcast('stats', { cpu: simCpu, ram: simRam });
  }, 2000);
  simulatorIntervals.push(statsInterval);

  // Random players join/leave
  const playerList = ['Steve', 'Alex', 'Dinnerbone', 'Grumm', 'jeb_', 'Notch'];
  const playerInterval = setInterval(() => {
    if (serverStatus !== 'running') return;
    const r = Math.random();
    if (r < 0.4 && activePlayers.size < 5) {
      // Player joins
      const available = playerList.filter(p => !activePlayers.has(p));
      if (available.length > 0) {
        const joiner = available[Math.floor(Math.random() * available.length)];
        activePlayers.add(joiner);
        addLog(`[Server thread/INFO]: ${joiner}[/127.0.0.1:54321] joined the game`);
        addLog(`[Server thread/INFO]: ${joiner} authenticated with UUID ${Math.random().toString(36).substring(2, 15)}`);
        broadcast('status_update', { activePlayers: Array.from(activePlayers) });
      }
    } else if (r > 0.7 && activePlayers.size > 0) {
      // Player leaves
      const arr = Array.from(activePlayers);
      const leaver = arr[Math.floor(Math.random() * arr.length)];
      activePlayers.delete(leaver);
      addLog(`[Server thread/INFO]: ${leaver} left the game`);
      broadcast('status_update', { activePlayers: Array.from(activePlayers) });
    }
  }, 12000);
  simulatorIntervals.push(playerInterval);
}

function stopSimulator() {
  if (serverStatus !== 'running' && serverStatus !== 'starting') return;
  serverStatus = 'stopping';
  broadcast('status_change', { status: serverStatus });

  // Clear intervals
  simulatorIntervals.forEach(clearInterval);
  simulatorIntervals = [];

  addLog('[Server thread/INFO]: Stopping the server');
  addLog('[Server thread/INFO]: Saving players');
  activePlayers.forEach(p => {
    addLog(`[Server thread/INFO]: Saving ${p}'s data`);
  });
  activePlayers.clear();
  broadcast('status_update', { activePlayers: [] });

  setTimeout(() => {
    addLog('[Server thread/INFO]: Saving worlds');
    addLog('[Server thread/INFO]: Closing Geyser translation layer');
  }, 1000);

  setTimeout(() => {
    addLog('[Server thread/INFO]: Thread-3 shutting down screen mcsunucu');
    serverStatus = 'stopped';
    simCpu = 0;
    simRam = 0;
    broadcast('status_change', { status: serverStatus });
    broadcast('stats', { cpu: 0, ram: 0 });
  }, 2500);
}

function killSimulator() {
  serverStatus = 'stopping';
  broadcast('status_change', { status: serverStatus });
  
  simulatorIntervals.forEach(clearInterval);
  simulatorIntervals = [];
  activePlayers.clear();
  broadcast('status_update', { activePlayers: [] });

  addLog('[System/WARNING]: Force kill invoked. java process terminated.');
  addLog('[System/INFO]: screen -wipe executed. Session cleaned.');

  setTimeout(() => {
    serverStatus = 'stopped';
    simCpu = 0;
    simRam = 0;
    broadcast('status_change', { status: serverStatus });
    broadcast('stats', { cpu: 0, ram: 0 });
  }, 1000);
}

// API Route router
function handleApiRequest(req, res) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // Set default JSON header
  res.setHeader('Content-Type', 'application/json');

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

// System CPU usage - User's exact LC_ALL=C top command formula
let cachedCpuPercent = 1;

function updateExactTopCpu() {
  const cmd = `LC_ALL=C top -b -n 2 -d 0.2 | grep "Cpu(s)" | tail -n 1 | awk '{print 100 - $8}'`;
  exec(cmd, (err, stdout) => {
    if (!err && stdout && stdout.trim()) {
      const val = parseFloat(stdout.trim());
      if (!isNaN(val)) {
        cachedCpuPercent = Math.max(1, Math.min(100, Math.round(val)));
      }
    }
  });
}

setInterval(updateExactTopCpu, 1000);
updateExactTopCpu();

// Broadcast stats over SSE every 500ms (fast live updates)
setInterval(() => {
  const sysMem = getSystemMemory();
  broadcast('stats', {
    cpu: cachedCpuPercent,
    ram: sysMem.usedGb,
    totalRam: sysMem.totalGb
  });
}, 500);

// Native Node.js real-time log file poller (250ms stream interval)
let lastLogSize = -1;

function pollLogFile() {
  if (!fs.existsSync(LOG_FILE)) return;
  try {
    const stats = fs.statSync(LOG_FILE);
    if (lastLogSize === -1) {
      // First run: set offset to start reading current file tail
      lastLogSize = Math.max(0, stats.size - 20000);
    }
    if (stats.size > lastLogSize) {
      const startPos = lastLogSize;
      const endPos = stats.size - 1;
      lastLogSize = stats.size;

      const readStream = fs.createReadStream(LOG_FILE, {
        start: startPos,
        end: endPos,
        encoding: 'utf8'
      });

      let buffer = '';
      readStream.on('data', chunk => {
        buffer += chunk;
      });

      readStream.on('end', () => {
        try {
          const lines = buffer.split('\n');
          lines.forEach(line => {
            const clean = sanitizeLogLine(line);
            if (clean) {
              if (Array.isArray(realLogHistory)) {
                realLogHistory.push(clean);
                if (realLogHistory.length > 400) realLogHistory.shift();
              }
              broadcast('log', clean);
              parseLogLineForPlayers(clean);
            }
          });
        } catch (err) {}
      });
    } else if (stats.size < lastLogSize) {
      lastLogSize = stats.size;
    }
  } catch (e) {}
}

setInterval(pollLogFile, 250);

// Continuous live stats broadcast over SSE (CPU, RAM, Total RAM)
// Broadcast stats over SSE every 1.5s (reads cached value only)
setInterval(() => {
  const sysMem = getSystemMemory();
  broadcast('stats', {
    cpu: cachedCpuPercent,
    ram: sysMem.usedGb,
    totalRam: sysMem.totalGb
  });
}, 1500);

// Calculate total and used system memory dynamically
function getSystemMemory() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  const totalGb = (totalBytes / (1024 * 1024 * 1024)).toFixed(1);
  const usedGb = (usedBytes / (1024 * 1024 * 1024)).toFixed(2);
  return { usedGb: parseFloat(usedGb), totalGb: parseFloat(totalGb) };
}

// Dynamically optimize Java RAM flags based on system total memory
function getMemoryFlags() {
  const totalGb = os.totalmem() / (1024 * 1024 * 1024);
  if (totalGb <= 4.5) {
    return '-Xms1G -Xmx2G -XX:+UseG1GC -XX:+UnlockExperimentalVMOptions -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20 -XX:MaxGCPauseMillis=50';
  } else if (totalGb <= 8.5) {
    return '-Xms2G -Xmx3G -XX:+UseG1GC';
  } else {
    return '-Xms2G -Xmx4G -XX:+UseG1GC';
  }
}

// API Route: Server Status
  if (pathname === '/api/server/status' && req.method === 'GET') {
    getTailscaleIP(tailscaleIp => {
      checkRealServerStatus(status => {
        const cpu = cachedCpuPercent;
        const sysMem = getSystemMemory();
        const ram = sysMem.usedGb;
        const totalRam = sysMem.totalGb;

        res.writeHead(200);
        res.end(JSON.stringify({
          status,
          simulatorMode: isSimulatorMode,
          localIp: getLocalIP(),
          tailscaleIp,
          port: 19132,
          cpu,
          ram,
          totalRam,
          activePlayers: Array.from(activePlayers)
        }));
      });
    });
  }

  // API Route: Logs History
  else if (pathname === '/api/logs/history' && req.method === 'GET') {
    let logs = [];
    if (isSimulatorMode) {
      logs = simLogHistory;
    } else if (fs.existsSync(LOG_FILE)) {
      try {
        const content = fs.readFileSync(LOG_FILE, 'utf8');
        logs = content.split('\n').filter(Boolean).slice(-80).map(sanitizeLogLine);
      } catch (e) {}
    }
    res.writeHead(200);
    res.end(JSON.stringify({ logs }));
  }

  // API Route: Start Server
  else if (pathname === '/api/server/start' && req.method === 'POST') {
    if (isSimulatorMode) {
      startSimulator();
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, message: 'Simulator server starting.' }));
    } else {
      checkRealServerStatus(status => {
        if (status !== 'stopped') {
          res.writeHead(400);
          return res.end(JSON.stringify({ success: false, message: 'Server is already running or starting.' }));
        }
        serverStatus = 'starting';
        broadcast('status_change', { status: serverStatus });
        
        const jarName = getJarFilename();
        const homeDir = os.homedir();
        // screen needs HOME and TERM env vars to work under systemd
        const envSetup = `HOME=${homeDir} TERM=xterm`;
        const wipeCmd = `${envSetup} screen -wipe > /dev/null 2>&1; true`;
        const startCmd = `${envSetup} screen -dmS mcsunucu java -Xms1G -Xmx2G -jar ${jarName} nogui`;
        
        addLog(`[System/INFO]: Executing: cd ${SERVER_DIR} && ${startCmd}`);
        
        // Wipe dead sessions first, then start
        exec(wipeCmd, { cwd: SERVER_DIR }, () => {
          exec(startCmd, { cwd: SERVER_DIR, env: { ...process.env, HOME: homeDir, TERM: 'xterm' } }, (err, stdout, stderr) => {
            if (err) {
              addLog(`[System/ERROR]: Start failed: ${err.message}`);
              if (stderr) addLog(`[System/ERROR]: stderr: ${stderr}`);
              serverStatus = 'stopped';
              broadcast('status_change', { status: serverStatus });
              res.writeHead(500);
              return res.end(JSON.stringify({ success: false, error: err.message }));
            }
            addLog('[System/INFO]: Screen session started. Waiting for Java to initialize...');
            startTailLog();
            
            // Give Java 3 seconds to boot, then re-check status
            setTimeout(() => {
              checkRealServerStatus(newStatus => {
                serverStatus = newStatus;
                broadcast('status_change', { status: serverStatus });
              });
            }, 3000);
            
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, message: 'Server start command initiated.' }));
          });
        });
      });
    }
  }

  // API Route: Stop Server
  else if (pathname === '/api/server/stop' && req.method === 'POST') {
    if (isSimulatorMode) {
      stopSimulator();
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, message: 'Simulator server stopping.' }));
    } else {
      serverStatus = 'stopping';
      broadcast('status_change', { status: serverStatus });
      
      // Send graceful stop command via screen stuff, then fallback to pkill SIGINT/SIGTERM
      exec('screen -S mcsunucu -X stuff "stop\n" || screen -X stuff "stop\n" || pkill -SIGINT -f java || pkill -SIGTERM -f java', () => {
        addLog('[System/INFO]: Sent graceful stop signal to Minecraft server.');
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: 'Server stop signal sent.' }));
      });
    }
  }

  // API Route: Force Kill
  else if (pathname === '/api/server/kill' && req.method === 'POST') {
    if (isSimulatorMode) {
      killSimulator();
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, message: 'Simulator server killed.' }));
    } else {
      serverStatus = 'stopping';
      broadcast('status_change', { status: serverStatus });
      
      const homeDir = os.homedir();
      const userName = os.userInfo().username || 'enis27';
      const envSetup = `HOME=${homeDir} TERM=xterm`;
      const killCmd = `${envSetup} screen -X -S mcsunucu quit > /dev/null 2>&1 || true; pkill -9 -f java || killall -9 java || true; pkill -9 -f "mcsunucu" || true; rm -rf /run/screen/S-${userName}/*mcsunucu* /tmp/uscreens/*mcsunucu* ${homeDir}/.screen/*mcsunucu* > /dev/null 2>&1 || true; ${envSetup} screen -wipe > /dev/null 2>&1 || true`;
      exec(killCmd, { env: { ...process.env, HOME: homeDir, TERM: 'xterm' } }, () => {
        serverStatus = 'stopped';
        broadcast('status_change', { status: serverStatus });
        if (activeTailProcess) {
          try { activeTailProcess.kill(); } catch (e) {}
          activeTailProcess = null;
        }
        activePlayers.clear();
        broadcast('status_update', { activePlayers: [] });

        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: 'Process force-killed and screen wiped.' }));
      });
    }
  }

  // API Route: Clear Lock
  else if (pathname === '/api/server/clearlock' && req.method === 'POST') {
    if (isSimulatorMode) {
      addLog('[System/INFO]: Cleared session.lock (Simulated)');
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, message: 'Lock cleared.' }));
    } else {
      if (fs.existsSync(LOCK_FILE)) {
        fs.unlink(LOCK_FILE, (err) => {
          if (err) {
            res.writeHead(500);
            return res.end(JSON.stringify({ success: false, error: err.message }));
          }
          addLog('[System/INFO]: Cleared world session.lock file successfully.');
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, message: 'Lock file removed.' }));
        });
      } else {
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: 'Lock file does not exist.' }));
      }
    }
  }

  // API Route: Execute custom command
  else if (pathname === '/api/server/command' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { command } = JSON.parse(body);
        if (!command || !command.trim()) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Command cannot be empty' }));
        }

        const cmdText = command.trim().startsWith('/') ? command.trim().substring(1) : command.trim();
        addLog(`[Console/Command]: Executing: /${cmdText}`);

        if (isSimulatorMode) {
          // Mock command interpretation
          handleSimulatedCommand(cmdText);
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, message: 'Simulated command run.' }));
        } else {
          // Send command via screen
          exec(`screen -S mcsunucu -X stuff "${cmdText}\n"`, (err) => {
            if (err) {
              res.writeHead(500);
              return res.end(JSON.stringify({ success: false, error: err.message }));
            }
            res.writeHead(200);
            res.end(JSON.stringify({ success: true }));
          });
        }
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }

  // API Route: Get Player Info
  else if (pathname === '/api/server/players' && req.method === 'GET') {
    if (!isSimulatorMode) {
      loadRealData();
    }
    res.writeHead(200);
    res.end(JSON.stringify({
      active: Array.from(activePlayers),
      operators: operatorList,
      whitelist: whitelist,
      banned: bannedPlayers
    }));
  }

  // Player Operations: OP / DEOP / WHITELIST / KICK / BAN
  else if (pathname.startsWith('/api/server/players/') && req.method === 'POST') {
    const action = pathname.split('/').pop(); // op, deop, whitelist_add, whitelist_remove, ban, pardon, kick
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { username } = JSON.parse(body);
        if (!username) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Username is required' }));
        }

        let gameCmd = '';
        if (action === 'op') gameCmd = `op ${username}`;
        else if (action === 'deop') gameCmd = `deop ${username}`;
        else if (action === 'whitelist_add') gameCmd = `whitelist add ${username}`;
        else if (action === 'whitelist_remove') gameCmd = `whitelist remove ${username}`;
        else if (action === 'ban') gameCmd = `ban ${username}`;
        else if (action === 'pardon') gameCmd = `pardon ${username}`;
        else if (action === 'kick') gameCmd = `kick ${username} Kicked via Server Controller Web Panel`;

        addLog(`[Console/Action]: Sending command: /${gameCmd}`);

        if (isSimulatorMode) {
          handleSimulatedCommand(gameCmd);
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } else {
          exec(`screen -S mcsunucu -X stuff "${gameCmd}\n"`, (err) => {
            if (err) {
              res.writeHead(500);
              return res.end(JSON.stringify({ success: false, error: err.message }));
            }
            // Update local state directly for speedy feedback (it will reload next refresh anyway)
            setTimeout(() => loadRealData(), 500);
            res.writeHead(200);
            res.end(JSON.stringify({ success: true }));
          });
        }
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }

  // Endpoint not found
  else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
}

// Simulate console responses for common game commands
function handleSimulatedCommand(command) {
  const parts = command.split(' ');
  const cmd = parts[0].toLowerCase();
  const arg1 = parts[1];

  setTimeout(() => {
    if (cmd === 'op') {
      if (!arg1) return addLog('[Server thread/INFO]: Usage: op <player>');
      if (!operatorList.some(o => o.name.toLowerCase() === arg1.toLowerCase())) {
        operatorList.push({ name: arg1, level: 4 });
      }
      addLog(`[Server thread/INFO]: Made ${arg1} a server operator`);
      broadcast('status_update', {});
    } else if (cmd === 'deop') {
      if (!arg1) return addLog('[Server thread/INFO]: Usage: deop <player>');
      operatorList = operatorList.filter(o => o.name.toLowerCase() !== arg1.toLowerCase());
      addLog(`[Server thread/INFO]: Made ${arg1} no longer a server operator`);
      broadcast('status_update', {});
    } else if (cmd === 'whitelist') {
      const sub = parts[1]?.toLowerCase();
      const name = parts[2];
      if (sub === 'add') {
        if (!whitelist.some(w => w.toLowerCase() === name.toLowerCase())) {
          whitelist.push(name);
        }
        addLog(`[Server thread/INFO]: Added ${name} to the whitelist`);
      } else if (sub === 'remove') {
        whitelist = whitelist.filter(w => w.toLowerCase() !== name.toLowerCase());
        addLog(`[Server thread/INFO]: Removed ${name} from the whitelist`);
      } else {
        addLog('[Server thread/INFO]: Usage: whitelist <add|remove|list|on|off>');
      }
      broadcast('status_update', {});
    } else if (cmd === 'ban') {
      if (!arg1) return addLog('[Server thread/INFO]: Usage: ban <player> [reason]');
      if (!bannedPlayers.some(b => b.toLowerCase() === arg1.toLowerCase())) {
        bannedPlayers.push(arg1);
      }
      activePlayers.delete(arg1); // Kick if online
      addLog(`[Server thread/INFO]: Banned player ${arg1}`);
      broadcast('status_update', { activePlayers: Array.from(activePlayers) });
    } else if (cmd === 'pardon') {
      if (!arg1) return addLog('[Server thread/INFO]: Usage: pardon <player>');
      bannedPlayers = bannedPlayers.filter(b => b.toLowerCase() !== arg1.toLowerCase());
      addLog(`[Server thread/INFO]: Unbanned player ${arg1}`);
      broadcast('status_update', {});
    } else if (cmd === 'kick') {
      if (!arg1) return addLog('[Server thread/INFO]: Usage: kick <player> [reason]');
      if (activePlayers.has(arg1)) {
        activePlayers.delete(arg1);
        addLog(`[Server thread/INFO]: Kicked player ${arg1}`);
        broadcast('status_update', { activePlayers: Array.from(activePlayers) });
      } else {
        addLog(`[Server thread/INFO]: Player ${arg1} is not online`);
      }
    } else if (cmd === 'list') {
      addLog(`[Server thread/INFO]: There are ${activePlayers.size} of a max 20 players online: ${Array.from(activePlayers).join(', ')}`);
    } else if (cmd === 'help') {
      addLog('[Server thread/INFO]: Help commands: /op, /deop, /whitelist, /ban, /pardon, /kick, /list, /time');
    } else if (cmd === 'time') {
      addLog(`[Server thread/INFO]: Set time to ${parts[2] || 'day'}`);
    } else {
      addLog(`[Server thread/INFO]: Unknown command. Try /help for a list of commands.`);
    }
  }, 200);
}

// HTTP Server serving Static Files + APIs
const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // Route APIs
  if (pathname.startsWith('/api/')) {
    return handleApiRequest(req, res);
  }

  // SSE (Server-Sent Events) endpoint
  if (pathname === '/api/logs') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*'
    });
    if (res.flushHeaders) res.flushHeaders();
    if (res.socket) res.socket.setNoDelay(true);

    // Write initial connection success with proper SSE event format
    res.write('retry: 3000\n');
    res.write(`event: connected\ndata: ${JSON.stringify({ mode: isSimulatorMode ? 'Simulator' : 'Production' })}\n\n`);

    // Stream recent logs to the newly connected browser immediately
    if (isSimulatorMode && simLogHistory.length > 0) {
      simLogHistory.forEach(log => {
        const clean = sanitizeLogLine(log);
        if (clean) res.write(`event: log\ndata: ${clean}\n\n`);
      });
    } else if (fs.existsSync(LOG_FILE)) {
      try {
        const logContent = fs.readFileSync(LOG_FILE, 'utf8');
        const lines = logContent.split('\n').filter(Boolean);
        const recentLines = lines.slice(-60);
        recentLines.forEach(line => {
          const clean = sanitizeLogLine(line);
          if (clean) res.write(`event: log\ndata: ${clean}\n\n`);
        });
      } catch (e) {}
    }

    const onMessage = (msg) => {
      try {
        res.write(`event: ${msg.event}\ndata: ${typeof msg.data === 'object' ? JSON.stringify(msg.data) : msg.data}\n\n`);
      } catch (e) {}
    };

    // Keep-alive ping interval every 5s to prevent SSE disconnects
    const pingInterval = setInterval(() => {
      try {
        res.write(':keepalive-ping\n\n');
      } catch (e) {}
    }, 5000);

    // Listen to logs
    sseBroadcaster.on('message', onMessage);

    req.on('close', () => {
      clearInterval(pingInterval);
      sseBroadcaster.off('message', onMessage);
      try { res.end(); } catch (e) {}
    });
    return;
  }

  // Static File Server
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);

  // Security: prevent directory traversal
  const relative = path.relative(__dirname, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403);
    res.end('Access Forbidden');
    return;
  }

  // Extension content types
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404);
      res.end('File Not Found');
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

// Initialization
initEnvironment();
if (!isSimulatorMode) {
  startTailLog();
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`==================================================`);
  console.log(`  Minecraft Cross-Play Server Controller is LIVE  `);
  console.log(`  URL: http://0.0.0.0:${PORT} (LAN & VPN)          `);
  console.log(`  Mode: ${isSimulatorMode ? 'SIMULATOR (Demo)' : 'PRODUCTION'}   `);
  console.log(`==================================================`);
});

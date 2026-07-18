const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const os = require('os');
const { EventEmitter } = require('events');

const PORT = 8080;
let SERVER_DIR = path.join(os.homedir(), 'mc_server');
let LOG_FILE = path.join(SERVER_DIR, 'logs', 'latest.log');
let JAR_FILE = path.join(SERVER_DIR, 'server.jar');
let LOCK_FILE = path.join(SERVER_DIR, 'world', 'session.lock');

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

// Simulator variables
let simulatorIntervals = [];
let simLogHistory = [];
let simCpu = 0;
let simRam = 0;

// Verify server environment and choose mode
function initEnvironment() {
  console.log(`Checking Minecraft server directory: ${SERVER_DIR}`);
  try {
    if (!fs.existsSync(SERVER_DIR)) {
      console.log(`Server directory not found. Creating placeholder directory: ${SERVER_DIR}`);
      fs.mkdirSync(SERVER_DIR, { recursive: true });
    }
  } catch (e) {
    console.warn(`[!] Failed to access/create ${SERVER_DIR}: ${e.message}`);
    SERVER_DIR = path.join(__dirname, 'mc_server');
    console.log(`[!] Falling back to local workspace directory: ${SERVER_DIR}`);
    if (!fs.existsSync(SERVER_DIR)) {
      fs.mkdirSync(SERVER_DIR, { recursive: true });
    }
  }

  // Recalculate paths based on final SERVER_DIR
  LOG_FILE = path.join(SERVER_DIR, 'logs', 'latest.log');
  JAR_FILE = path.join(SERVER_DIR, 'server.jar');
  LOCK_FILE = path.join(SERVER_DIR, 'world', 'session.lock');

  // Create logs directory
  const logsDir = path.join(SERVER_DIR, 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  // Create latest.log if not exists
  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, '');
  }

  // Check if real PaperMC server jar exists
  if (!fs.existsSync(JAR_FILE)) {
    isSimulatorMode = true;
    console.warn(`\n[!] server.jar not found at ${JAR_FILE}.\n[!] Running in SIMULATOR MODE for demonstration.\n`);
    loadMockData();
  } else {
    isSimulatorMode = false;
    console.log(`[+] server.jar found. Running in PRODUCTION mode.`);
    loadRealData();
  }
}

// Helper: Get local LAN IP
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// Helper: Get Tailscale IP
function getTailscaleIP(callback) {
  if (isSimulatorMode) {
    return callback('100.82.140.45'); // Simulated Tailscale IP
  }
  exec('tailscale ip -4', (err, stdout) => {
    if (err || !stdout.trim()) {
      return callback('VPN Offline');
    }
    callback(stdout.trim());
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

// Append log helper
function addLog(message) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const formattedLog = `[${timestamp}] ${message}`;
  if (isSimulatorMode) {
    simLogHistory.push(formattedLog);
    if (simLogHistory.length > 500) simLogHistory.shift();
  } else {
    try {
      fs.appendFileSync(LOG_FILE, formattedLog + '\n');
    } catch (e) {
      console.error('Failed writing to real log file:', e.message);
    }
  }
  broadcast('log', formattedLog);
}

// Check real screen process status
function checkRealServerStatus(callback) {
  if (isSimulatorMode) {
    return callback(serverStatus);
  }
  exec('screen -ls | grep mcsunucu', (err, stdout) => {
    if (stdout && stdout.includes('mcsunucu')) {
      if (serverStatus === 'stopped' || serverStatus === 'stopping') {
        serverStatus = 'running';
      }
    } else {
      if (serverStatus === 'running' || serverStatus === 'starting') {
        serverStatus = 'stopped';
      }
    }
    callback(serverStatus);
  });
}

// Real server: Tail latest.log and stream it
function startTailLog() {
  if (isSimulatorMode) return;
  if (activeTailProcess) {
    activeTailProcess.kill();
  }

  // Load last 50 lines first
  try {
    const logData = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = logData.split('\n').filter(Boolean);
    const lastLines = lines.slice(-50);
    lastLines.forEach(line => broadcast('log', line));
  } catch (e) {
    console.error('Could not preload logs:', e.message);
  }

  // Spawn tail
  activeTailProcess = spawn('tail', ['-f', LOG_FILE]);
  activeTailProcess.stdout.on('data', (data) => {
    const chunk = data.toString();
    const lines = chunk.split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        broadcast('log', line);
        // Track joins/leaves dynamically from real logs
        parseLogLineForPlayers(line);
      }
    });
  });

  activeTailProcess.on('close', () => {
    activeTailProcess = null;
  });
}

function parseLogLineForPlayers(line) {
  // Minecraft log join pattern: [Server thread/INFO]: PlayerName[/IP:port] joined the game
  // Minecraft log leave pattern: [Server thread/INFO]: PlayerName left the game
  if (line.includes('joined the game')) {
    const match = line.match(/INFO\]:\s+([A-Za-z0-9_*]+)(?:\[\/[\d\.:]+\])?\s+joined/);
    if (match && match[1]) {
      activePlayers.add(match[1]);
      broadcast('status_update', { activePlayers: Array.from(activePlayers) });
    }
  } else if (line.includes('left the game')) {
    const match = line.match(/INFO\]:\s+([A-Za-z0-9_*]+)\s+left/);
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

  // API Route: Server Status
  if (pathname === '/api/server/status' && req.method === 'GET') {
    getTailscaleIP(tailscaleIp => {
      checkRealServerStatus(status => {
        let cpu = 0;
        let ram = 0;
        
        if (isSimulatorMode) {
          cpu = simCpu;
          ram = simRam;
        } else {
          // In real mode, run ps command if running
          // (Mock CPU/RAM calculations based on real java process)
          // Just to make it quick, if running let's get actual CPU/RAM of Java if possible
        }

        res.writeHead(200);
        res.end(JSON.stringify({
          status,
          simulatorMode: isSimulatorMode,
          localIp: getLocalIP(),
          tailscaleIp,
          port: 19132,
          cpu,
          ram,
          activePlayers: Array.from(activePlayers)
        }));
      });
    });
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
        
        // Command to start paperMC in screen
        const startCmd = `cd ${SERVER_DIR} && screen -dmS mcsunucu java -Xmx4G -Xms4G -jar server.jar nogui`;
        exec(startCmd, (err) => {
          if (err) {
            serverStatus = 'stopped';
            broadcast('status_change', { status: serverStatus });
            res.writeHead(500);
            return res.end(JSON.stringify({ success: false, error: err.message }));
          }
          startTailLog();
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, message: 'Server start command initiated.' }));
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
      
      // Send stop command
      exec(`screen -S mcsunucu -X stuff "stop\n"`, (err) => {
        if (err) {
          res.writeHead(500);
          return res.end(JSON.stringify({ success: false, error: err.message }));
        }
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: 'Server stop command sent.' }));
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
      
      exec('killall -9 java && screen -wipe', (err) => {
        serverStatus = 'stopped';
        broadcast('status_change', { status: serverStatus });
        if (activeTailProcess) {
          activeTailProcess.kill();
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
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    // Write initial connection success
    res.write('retry: 5000\n');
    res.write(`data: ${JSON.stringify({ event: 'connected', mode: isSimulatorMode ? 'Simulator' : 'Production' })}\n\n`);

    // Stream past mock log logs if simulator
    if (isSimulatorMode && simLogHistory.length > 0) {
      simLogHistory.forEach(log => {
        res.write(`event: log\ndata: ${log}\n\n`);
      });
    }

    const onMessage = (msg) => {
      res.write(`event: ${msg.event}\ndata: ${typeof msg.data === 'object' ? JSON.stringify(msg.data) : msg.data}\n\n`);
    };

    // Listen to logs
    sseBroadcaster.on('message', onMessage);

    req.on('close', () => {
      sseBroadcaster.off('message', onMessage);
      res.end();
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

server.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`  Minecraft Cross-Play Server Controller is LIVE  `);
  console.log(`  URL: http://localhost:${PORT}                    `);
  console.log(`  Mode: ${isSimulatorMode ? 'SIMULATOR (Demo)' : 'PRODUCTION'}   `);
  console.log(`==================================================`);
});

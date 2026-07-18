# Minecraft Cross-Play Server Controller

A lightweight, modern, and high-performance web controller application for managing a cross-play Minecraft server (Java & Bedrock) running on CachyOS (Arch Linux).

---

## 1. Project Development Rules & Tech Stack

### Technology Stack
* **No Frameworks:** Modern frameworks or libraries (React, Vue, Angular, Svelte, TailwindCSS, etc.) are **strictly prohibited**.
* **Vanilla Stack:** Only pure **HTML5**, **CSS3**, and **Modern JavaScript (Vanilla JS)** shall be used.

### File Structure & Architecture
The project must maintain a clean, modular, and logical directory structure:
```text
├── index.html
├── css/
│   └── style.css
├── js/
│   └── main.js
└── assets/
    └── images/
```

### UI/UX Design Principles
* **Rich Aesthetics:** The user interface must be visually stunning, modern, and highly interactive.
* **Premium Theme:** Use premium dark mode styles, custom HSL color palettes, elegant typography (e.g., Google Fonts like Inter/Outfit), subtle gradients, and smooth micro-animations.
* **Responsive Design:** All buttons, panels, and layout elements must be fully responsive across mobile, tablet, and desktop viewports.

### Git Version Control
* Maintain developer discipline. Always create a **Git commit** after every meaningful change, feature addition, or file modification.
* Commit messages must be clear, concise, and descriptive.

---

## 2. Server Technical Architecture

The backend controller interacts with a pre-configured Minecraft server environment:

* **Host OS:** CachyOS (Arch Linux derivative)
* **Shell Environment:** `fish` (commands are executed within a fish shell context, though standard commands are bash-compatible)
* **Server Root Directory:** `~/mc_server`
* **Core JAR File:** `server.jar` (PaperMC server core)
* **RAM Allocation:** 3GB to 4GB (`-Xmx4G -Xms4G`)
* **Terminal Multiplexer:** `screen` (Session Name: `mcsunucu`)
* **Network & VPN:** Tailscale VPN (`tailscaled` service active)
* **Core Plugins:**
  1. **Geyser-Spigot:** Bridge allowing Bedrock (Mobile/Console) players to join the Java server (Default Port: `19132`).
  2. **Floodgate:** Bypasses Java license verification for Bedrock players.
  3. **ViaVersion:** Handles version compatibility between clients and the server.

---

## 3. Core Shell Commands (Backend Operations)

The controller interface interacts with the server process strictly from outside the `screen` session. Do **NOT** attach to the screen session interactively; instead, use `screen -X` or file reads.

### A. Start Server
Run the server in a detached screen session:
```bash
cd ~/mc_server && screen -dmS mcsunucu java -Xmx4G -Xms4G -jar server.jar nogui
```

### B. Send Commands / Graceful Stop
Send commands directly into the running server console using `screen -X stuff`:
```bash
# Gracefully stop the server
screen -S mcsunucu -X stuff "stop\n"

# Send generic commands (e.g., set time to day)
screen -S mcsunucu -X stuff "time set day\n"
```

### C. Check Server Status
Verify if the screen session is active:
```bash
screen -ls | grep mcsunucu
```
*If output is returned, the server is running. If empty, the server is offline.*

### D. Log Streaming (Live Console)
Read the log file directly to display the live console inside the UI:
```bash
# Fetch last 50 lines
tail -n 50 ~/mc_server/logs/latest.log

# Stream updates (for Web UI log terminal / WebSocket integration)
tail -f ~/mc_server/logs/latest.log
```

---

## 4. Error Handling & Edge Cases

The web panel should feature a **Force Kill / Recovery** button to handle server hangs:

### A. Hard Terminate & Screen Cleanup
Forcefully terminate Java processes and wipe stale screen sessions:
```bash
killall -9 java && screen -wipe
```
*Note: Stale screen instances can also be cleaned up using `screen -X -S <id>.mcsunucu quit`.*

### B. Resolving Map Lockups (session.lock)
An abrupt shutdown may lock the world database. If start fails, clear the lock:
```bash
rm -f ~/mc_server/world/session.lock
```

---

## 5. Network & Systemd Integration

### Dual-IP Binding
* The controller and the server listen on all network interfaces (`0.0.0.0`) to allow connections via both the **Local Area Network (LAN IP)** and the **Tailscale VPN IP**.
* Geyser port is fixed at `19132`.

### Network UI Panel
The web interface must display a clean connectivity panel showing:
* **Local IP:** LAN address of the host.
* **Tailscale IP:** VPN address of the host.
* **Active Port:** Server port (`19132`).

To dynamically retrieve the Tailscale IP:
```bash
tailscale ip -4
```

### Systemd Service Configuration
* The controller application will be configured as a systemd service (`.service` file).
* It will enable auto-start on boot, delaying execution until network interfaces are fully ready (`network.target`).

### Integrated Web Logcat UI
* A terminal-themed logging panel (monospaced font, dark theme, severity-colored output) will display real-time application logs, server actions, and system events.

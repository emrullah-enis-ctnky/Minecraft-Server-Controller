#!/usr/bin/env bash

# Minecraft Cross-Play Server Controller - Installer Script
# Works on CachyOS / Arch Linux and other systemd-based distributions.

echo "=================================================="
echo "   Minecraft Web Controller Auto-Installer        "
echo "=================================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "[!] Node.js is not installed. Please install Node.js first."
    echo "[*] Run: sudo pacman -S nodejs npm (on Arch/CachyOS)"
    exit 1
fi

CURRENT_USER=$(whoami)
USER_HOME=$HOME
TARGET_DIR="$USER_HOME/mc_server/controller"

echo "[*] Detected User: $CURRENT_USER"
echo "[*] Detected Home Directory: $USER_HOME"
echo "[*] Expected Minecraft Directory: $USER_HOME/mc_server"
echo "[*] Controller Installation Directory: $TARGET_DIR"

# Check if Minecraft server directory exists
if [ ! -d "$USER_HOME/mc_server" ]; then
    echo "[*] Creating Minecraft server folder at $USER_HOME/mc_server..."
    mkdir -p "$USER_HOME/mc_server"
fi

if [ ! -d "$TARGET_DIR" ]; then
    echo "[*] Creating controller folder at $TARGET_DIR..."
    mkdir -p "$TARGET_DIR"
fi

# Copying files to target directory if not already there
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
if [ "$SCRIPT_DIR" != "$TARGET_DIR" ]; then
    echo "[*] Copying controller files to $TARGET_DIR..."
    mkdir -p "$TARGET_DIR/css" "$TARGET_DIR/js"
    cp "$SCRIPT_DIR/server.js" "$TARGET_DIR/"
    cp "$SCRIPT_DIR/index.html" "$TARGET_DIR/"
    cp "$SCRIPT_DIR/css/style.css" "$TARGET_DIR/css/"
    cp "$SCRIPT_DIR/js/main.js" "$TARGET_DIR/js/"
    cp "$SCRIPT_DIR/mcs-controller.service" "$TARGET_DIR/" 2>/dev/null || true
fi

# Generating the customized systemd service file dynamically
SERVICE_FILE="/etc/systemd/system/mcs-controller.service"

echo "[*] Generating systemd service at $SERVICE_FILE..."

sudo bash -c "cat > $SERVICE_FILE" <<EOF
[Unit]
Description=Minecraft Server Web Controller
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$TARGET_DIR
ExecStart=/usr/bin/node $TARGET_DIR/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# Reloading and starting systemd service
echo "[*] Reloading systemd daemon..."
sudo systemctl daemon-reload

echo "[*] Enabling mcs-controller service..."
sudo systemctl enable mcs-controller.service

echo "[*] Killing leftover orphan top processes..."
pkill -9 top 2>/dev/null || true
killall -9 top 2>/dev/null || true

echo "[*] Starting/Restarting mcs-controller service..."
sudo systemctl restart mcs-controller.service

echo "=================================================="
echo "[+] INSTALLATION SUCCESSFUL!"
echo "[+] Controller is now running as a background service."
echo "[+] Access the Web Panel at: http://localhost:8080"
echo "=================================================="

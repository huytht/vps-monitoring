#!/usr/bin/env bash
# ==============================================================================
# VPS Monitor Agent - one-line installer
#
# Usage (on the target VPS):
#   curl -fsSL <DASHBOARD_URL>/api/install | sudo bash
#
# This installer:
#   - Installs deps (curl, jq) if missing
#   - Drops the agent script into /opt/vps-monitor-agent/
#   - Registers with the dashboard (auto-generates agentId + token)
#   - Installs and starts a systemd service that survives reboots
# ==============================================================================
set -euo pipefail

SERVER_URL="__SERVER_URL__"
INTERVAL="__INTERVAL__"
INSTALL_DIR="/opt/vps-monitor-agent"
CONFIG_FILE="$INSTALL_DIR/agent.conf"
AGENT_SCRIPT="$INSTALL_DIR/agent.sh"
UNINSTALL_SCRIPT="$INSTALL_DIR/uninstall.sh"
SERVICE_FILE="/etc/systemd/system/vps-monitor-agent.service"

c_blue=$'\e[1;34m'; c_green=$'\e[1;32m'; c_yellow=$'\e[1;33m'; c_red=$'\e[1;31m'; c_reset=$'\e[0m'
log()  { printf '%s==>%s %s\n' "$c_blue"   "$c_reset" "$*"; }
ok()   { printf '%s✓%s   %s\n' "$c_green"  "$c_reset" "$*"; }
warn() { printf '%s!%s   %s\n' "$c_yellow" "$c_reset" "$*"; }
die()  { printf '%s✗%s   %s\n' "$c_red"    "$c_reset" "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Please run as root (or with sudo)."

# ---- Detect package manager and install deps -------------------------------
log "Installing dependencies (curl, jq)…"
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y >/dev/null
  apt-get install -y curl jq ca-certificates >/dev/null
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y curl jq ca-certificates >/dev/null
elif command -v yum >/dev/null 2>&1; then
  yum install -y curl jq ca-certificates >/dev/null
elif command -v apk >/dev/null 2>&1; then
  apk add --no-cache curl jq ca-certificates bash procps coreutils >/dev/null
elif command -v pacman >/dev/null 2>&1; then
  pacman -Sy --noconfirm curl jq ca-certificates >/dev/null
else
  warn "No supported package manager found. Assuming curl/jq already installed."
fi
ok "Dependencies ready."

# ---- Collect system info ----------------------------------------------------
log "Detecting system…"

HOSTNAME_VAL="$(hostname 2>/dev/null || echo unknown)"
ARCH="$(uname -m 2>/dev/null || echo unknown)"
KERNEL="$(uname -r 2>/dev/null || echo unknown)"

OS_ID="linux"; OS_VER=""
if [ -r /etc/os-release ]; then
  . /etc/os-release
  OS_ID="${ID:-linux}"
  OS_VER="${VERSION_ID:-}"
fi

CPU_MODEL="$(awk -F: '/model name/{gsub(/^ +/,"",$2); print $2; exit}' /proc/cpuinfo 2>/dev/null || true)"
[ -z "$CPU_MODEL" ] && CPU_MODEL="$(uname -p 2>/dev/null || echo unknown)"
CPU_CORES="$(nproc 2>/dev/null || echo 1)"

MEM_TOTAL_KB="$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null || echo 0)"
MEM_TOTAL_BYTES=$(( MEM_TOTAL_KB * 1024 ))

DISK_TOTAL_BYTES="$(df -B1 --output=size / 2>/dev/null | tail -1 | tr -d ' ' || echo 0)"
[ -z "$DISK_TOTAL_BYTES" ] && DISK_TOTAL_BYTES=0

PRIVATE_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
PUBLIC_IP="$(curl -fsS --max-time 4 https://api.ipify.org 2>/dev/null || true)"
[ -z "$PUBLIC_IP" ] && PUBLIC_IP="$(curl -fsS --max-time 4 https://ifconfig.me 2>/dev/null || true)"

# ---- Generate or reuse agent id --------------------------------------------
mkdir -p "$INSTALL_DIR"

if [ -f "$CONFIG_FILE" ]; then
  log "Existing config detected — re-registering with same agentId."
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
fi

if [ -z "${AGENT_ID:-}" ]; then
  AGENT_ID="vps_$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi

# ---- Register with dashboard ------------------------------------------------
log "Registering with $SERVER_URL …"

REG_PAYLOAD=$(jq -n \
  --arg agentId "$AGENT_ID" \
  --arg hostname "$HOSTNAME_VAL" \
  --arg os "$OS_ID" \
  --arg osVersion "$OS_VER" \
  --arg kernel "$KERNEL" \
  --arg arch "$ARCH" \
  --arg cpuModel "$CPU_MODEL" \
  --argjson cpuCores "${CPU_CORES:-1}" \
  --argjson totalMemoryBytes "${MEM_TOTAL_BYTES:-0}" \
  --argjson totalDiskBytes "${DISK_TOTAL_BYTES:-0}" \
  --arg publicIp "${PUBLIC_IP:-}" \
  --arg privateIp "${PRIVATE_IP:-}" \
  '{agentId:$agentId, hostname:$hostname, os:$os, osVersion:$osVersion, kernel:$kernel, arch:$arch, cpuModel:$cpuModel, cpuCores:$cpuCores, totalMemoryBytes:$totalMemoryBytes, totalDiskBytes:$totalDiskBytes, publicIp:$publicIp, privateIp:$privateIp}')

REG_RESPONSE="$(curl -fsS -X POST "$SERVER_URL/api/agents/register" \
  -H 'Content-Type: application/json' \
  -d "$REG_PAYLOAD" || true)"

if [ -z "$REG_RESPONSE" ]; then
  die "Failed to contact dashboard at $SERVER_URL. Check connectivity / firewall."
fi

NEW_AGENT_ID=$(echo "$REG_RESPONSE" | jq -r '.agentId // empty')
NEW_TOKEN=$(echo "$REG_RESPONSE" | jq -r '.token // empty')

if [ -z "$NEW_AGENT_ID" ] || [ -z "$NEW_TOKEN" ]; then
  die "Registration failed. Server response: $REG_RESPONSE"
fi

AGENT_ID="$NEW_AGENT_ID"
AGENT_TOKEN="$NEW_TOKEN"
ok "Registered as $AGENT_ID."

# ---- Write config -----------------------------------------------------------
umask 077
cat > "$CONFIG_FILE" <<EOF
SERVER_URL="$SERVER_URL"
AGENT_ID="$AGENT_ID"
AGENT_TOKEN="$AGENT_TOKEN"
INTERVAL="$INTERVAL"
EOF
chmod 600 "$CONFIG_FILE"

# ---- Write agent script -----------------------------------------------------
cat > "$AGENT_SCRIPT" <<'AGENT_EOF'
#!/usr/bin/env bash
# vps-monitor-agent: collects metrics and POSTs to the dashboard.
set -u

CONFIG_FILE="/opt/vps-monitor-agent/agent.conf"
# shellcheck disable=SC1090
. "$CONFIG_FILE"

PREV_RX=0; PREV_TX=0; PREV_TS=0
PREV_CPU_TOTAL=0; PREV_CPU_IDLE=0
LOG_UPLOAD_LOCK="/tmp/vps-monitor-log-upload.lock"
LOG_UPLOAD_MAX_CONTAINERS=4
LOG_UPLOAD_TAIL_LINES=5000
LOG_UPLOAD_MAX_BYTES=1000000

read_cpu() {
  read -r _ user nice system idle iowait irq softirq steal _ < /proc/stat
  local idle_all=$((idle + iowait))
  local non_idle=$((user + nice + system + irq + softirq + steal))
  local total=$((idle_all + non_idle))
  echo "$total $idle_all"
}

read_net() {
  local rx=0 tx=0
  while IFS= read -r line; do
    case "$line" in
      *:*)
        local iface="${line%%:*}"
        iface="${iface// /}"
        case "$iface" in
          lo|docker*|veth*|br-*|virbr*|tun*|tap*|wg*|cni*|flannel*|cali*) continue ;;
        esac
        local rest="${line#*:}"
        # shellcheck disable=SC2086
        set -- $rest
        rx=$(( rx + ${1:-0} ))
        tx=$(( tx + ${9:-0} ))
        ;;
    esac
  done < /proc/net/dev
  echo "$rx $tx"
}

get_disk() {
  df -B1 --output=used,size / 2>/dev/null | tail -1
}

# Prime CPU + net counters once
read PREV_CPU_TOTAL PREV_CPU_IDLE <<<"$(read_cpu)"
read PREV_RX PREV_TX <<<"$(read_net)"
PREV_TS=$(date +%s)
sleep 1

while true; do
  NOW=$(date +%s)
  ELAPSED=$((NOW - PREV_TS))
  [ "$ELAPSED" -le 0 ] && ELAPSED=1

  # CPU
  read CPU_TOTAL CPU_IDLE <<<"$(read_cpu)"
  DT=$((CPU_TOTAL - PREV_CPU_TOTAL))
  DI=$((CPU_IDLE - PREV_CPU_IDLE))
  if [ "$DT" -gt 0 ]; then
    CPU_PERCENT=$(awk -v d="$DT" -v i="$DI" 'BEGIN { printf "%.2f", (1 - i/d) * 100 }')
  else
    CPU_PERCENT="0"
  fi
  PREV_CPU_TOTAL=$CPU_TOTAL
  PREV_CPU_IDLE=$CPU_IDLE

  # Load
  read L1 L5 L15 _ < /proc/loadavg

  # Memory
  MEM_TOTAL_KB=$(awk '/MemTotal/{print $2}' /proc/meminfo)
  MEM_AVAIL_KB=$(awk '/MemAvailable/{print $2}' /proc/meminfo)
  SWAP_TOTAL_KB=$(awk '/SwapTotal/{print $2}' /proc/meminfo)
  SWAP_FREE_KB=$(awk '/SwapFree/{print $2}' /proc/meminfo)
  MEM_TOTAL=$(( MEM_TOTAL_KB * 1024 ))
  MEM_USED=$(( (MEM_TOTAL_KB - MEM_AVAIL_KB) * 1024 ))
  SWAP_TOTAL=$(( SWAP_TOTAL_KB * 1024 ))
  SWAP_USED=$(( (SWAP_TOTAL_KB - SWAP_FREE_KB) * 1024 ))

  # Disk on /
  read DISK_USED DISK_TOTAL <<<"$(get_disk)"

  # Network
  read RX TX <<<"$(read_net)"
  RX_DELTA=$(( RX - PREV_RX ))
  TX_DELTA=$(( TX - PREV_TX ))
  [ "$RX_DELTA" -lt 0 ] && RX_DELTA=0
  [ "$TX_DELTA" -lt 0 ] && TX_DELTA=0
  RX_BPS=$(( RX_DELTA / ELAPSED ))
  TX_BPS=$(( TX_DELTA / ELAPSED ))
  PREV_RX=$RX; PREV_TX=$TX; PREV_TS=$NOW

  # Uptime
  UPTIME=$(awk '{print int($1)}' /proc/uptime)

  # Process count
  PROC_COUNT=$(ls -1 /proc 2>/dev/null | grep -c '^[0-9][0-9]*$')

  DOCKER_AVAILABLE=false
  DOCKER_CONTAINERS='[]'
  if command -v docker >/dev/null 2>&1; then
    if docker info >/dev/null 2>&1; then
      DOCKER_AVAILABLE=true
      DOCKER_CONTAINERS='[]'
      while IFS='|' read -r CID CNAME CIMAGE CSTATE CSTATUS; do
        [ -z "$CID" ] && continue
        STATS_JSON="$(docker stats --no-stream --format '{{json .}}' "$CID" 2>/dev/null || true)"

        C_CPU_PERCENT=""
        MEM_USAGE=""
        C_MEM_PERCENT=""
        NET_IO=""
        BLOCK_IO=""
        C_PIDS=""

        if [ -n "$STATS_JSON" ]; then
          C_CPU_PERCENT="$(echo "$STATS_JSON" | jq -r '.CPUPerc // ""' | tr -d '%')"
          MEM_USAGE="$(echo "$STATS_JSON" | jq -r '.MemUsage // ""')"
          C_MEM_PERCENT="$(echo "$STATS_JSON" | jq -r '.MemPerc // ""' | tr -d '%')"
          NET_IO="$(echo "$STATS_JSON" | jq -r '.NetIO // ""')"
          BLOCK_IO="$(echo "$STATS_JSON" | jq -r '.BlockIO // ""')"
          C_PIDS="$(echo "$STATS_JSON" | jq -r '.PIDs // ""')"
        fi

        ITEM="$(jq -n \
          --arg containerId "$CID" \
          --arg name "$CNAME" \
          --arg image "$CIMAGE" \
          --arg state "$CSTATE" \
          --arg status "$CSTATUS" \
          --arg memUsage "$MEM_USAGE" \
          --arg netIO "$NET_IO" \
          --arg blockIO "$BLOCK_IO" \
          --arg cpuPercent "$C_CPU_PERCENT" \
          --arg memPercent "$C_MEM_PERCENT" \
          --arg pids "$C_PIDS" \
          '{containerId:$containerId,name:$name,image:$image,state:$state,status:$status,memUsage:$memUsage,netIO:$netIO,blockIO:$blockIO}
           + (if ($cpuPercent|length)>0 then {cpuPercent:($cpuPercent|tonumber)} else {} end)
           + (if ($memPercent|length)>0 then {memPercent:($memPercent|tonumber)} else {} end)
           + (if ($pids|length)>0 then {pids:($pids|tonumber)} else {} end)')"
        DOCKER_CONTAINERS="$(jq -c --argjson item "$ITEM" '. + [$item]' <<< "$DOCKER_CONTAINERS")"

      done < <(docker ps -a --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.State}}|{{.Status}}')
    fi
  fi

  PAYLOAD=$(jq -n \
    --arg agentId "$AGENT_ID" \
    --arg token   "$AGENT_TOKEN" \
    --argjson cpuPercent "$CPU_PERCENT" \
    --argjson loadAvg1   "$L1" \
    --argjson loadAvg5   "$L5" \
    --argjson loadAvg15  "$L15" \
    --argjson memUsedBytes   "$MEM_USED" \
    --argjson memTotalBytes  "$MEM_TOTAL" \
    --argjson swapUsedBytes  "$SWAP_USED" \
    --argjson swapTotalBytes "$SWAP_TOTAL" \
    --argjson diskUsedBytes  "$DISK_USED" \
    --argjson diskTotalBytes "$DISK_TOTAL" \
    --argjson netRxBytes "$RX" \
    --argjson netTxBytes "$TX" \
    --argjson netRxBps   "$RX_BPS" \
    --argjson netTxBps   "$TX_BPS" \
    --argjson uptimeSeconds "$UPTIME" \
    --argjson processCount  "$PROC_COUNT" \
    --argjson dockerAvailable "$DOCKER_AVAILABLE" \
    --argjson dockerContainers "$DOCKER_CONTAINERS" \
    '{agentId:$agentId, token:$token, cpuPercent:$cpuPercent, loadAvg1:$loadAvg1, loadAvg5:$loadAvg5, loadAvg15:$loadAvg15, memUsedBytes:$memUsedBytes, memTotalBytes:$memTotalBytes, swapUsedBytes:$swapUsedBytes, swapTotalBytes:$swapTotalBytes, diskUsedBytes:$diskUsedBytes, diskTotalBytes:$diskTotalBytes, netRxBytes:$netRxBytes, netTxBytes:$netTxBytes, netRxBps:$netRxBps, netTxBps:$netTxBps, uptimeSeconds:$uptimeSeconds, processCount:$processCount, dockerAvailable:$dockerAvailable, dockerContainers:$dockerContainers}')

  curl -fsS --max-time 12 -X POST "$SERVER_URL/api/agents/heartbeat" \
    -H 'Content-Type: application/json' \
    -d "$PAYLOAD" >/dev/null 2>&1 || true

  # Upload logs in background so heartbeat timing is not blocked by heavy containers.
  if [ "$DOCKER_AVAILABLE" = "true" ]; then
    (
      exec 9>"$LOG_UPLOAD_LOCK"
      flock -n 9 || exit 0
      count=0
      while IFS='|' read -r CID CNAME; do
        [ -z "$CID" ] && continue
        [ "$count" -ge "$LOG_UPLOAD_MAX_CONTAINERS" ] && break
        LOG_TMP="$(mktemp)"
        docker logs --tail "$LOG_UPLOAD_TAIL_LINES" "$CID" 2>&1 | head -c "$LOG_UPLOAD_MAX_BYTES" | tr -d '\000' > "$LOG_TMP" 2>/dev/null || true
        jq -n \
          --arg agentId "$AGENT_ID" \
          --arg token "$AGENT_TOKEN" \
          --arg containerId "$CID" \
          --arg name "$CNAME" \
          --rawfile logTail "$LOG_TMP" \
          '{agentId:$agentId, token:$token, containerId:$containerId, name:$name, logTail:$logTail}' \
          | curl -fsS --max-time 6 -X POST "$SERVER_URL/api/agents/container-log" \
            -H 'Content-Type: application/json' \
            --data-binary @- >/dev/null 2>&1 || true
        rm -f "$LOG_TMP"
        count=$((count + 1))
      done < <(docker ps -a --format '{{.ID}}|{{.Names}}')
    ) >/dev/null 2>&1 &
  fi

  sleep "$INTERVAL"
done
AGENT_EOF

chmod +x "$AGENT_SCRIPT"

# ---- Write uninstall script -------------------------------------------------
cat > "$UNINSTALL_SCRIPT" <<'UNI_EOF'
#!/usr/bin/env bash
set -e
[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }
systemctl stop vps-monitor-agent 2>/dev/null || true
systemctl disable vps-monitor-agent 2>/dev/null || true
rm -f /etc/systemd/system/vps-monitor-agent.service
systemctl daemon-reload || true
rm -rf /opt/vps-monitor-agent
echo "vps-monitor-agent removed."
UNI_EOF
chmod +x "$UNINSTALL_SCRIPT"

# ---- systemd service --------------------------------------------------------
log "Installing systemd service…"
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=VPS Monitor Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/env bash $AGENT_SCRIPT
Restart=always
RestartSec=5
User=root
StandardOutput=journal
StandardError=journal
KillMode=control-group

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable vps-monitor-agent >/dev/null 2>&1
systemctl restart vps-monitor-agent

sleep 2
if systemctl is-active --quiet vps-monitor-agent; then
  ok "Agent is running."
else
  warn "Agent service is not active. Run: journalctl -u vps-monitor-agent -n 50"
fi

echo
echo "${c_green}✔ Installation complete!${c_reset}"
echo "  Agent ID:      $AGENT_ID"
echo "  Dashboard:     $SERVER_URL"
echo "  Status:        sudo systemctl status vps-monitor-agent"
echo "  Logs:          sudo journalctl -u vps-monitor-agent -f"
echo "  Uninstall:     sudo $UNINSTALL_SCRIPT"
echo

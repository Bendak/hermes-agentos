#!/bin/sh
# AgentOS s6 boot script — registers the AgentOS service with s6-svscan
# on container start. This file is PERSISTENT (lives in /opt/data volume).
#
# SETUP (one-time, run as root on the host):
#   sudo ln -sf /opt/data/agentos/boot.sh /etc/cont-init.d/020-agentos
#   sudo chmod +x /opt/data/agentos/boot.sh
#
# If /etc/cont-init.d doesn't survive docker pull (it won't), you have
# two options:
#
# OPTION A (recommended): Add this to docker-compose.yml gateway service:
#   entrypoint: ["/init", "/opt/data/agentos/boot.sh"]
#   command: ["gateway", "run"]
#
# OPTION B: Run this script manually after each container restart:
#   docker exec hermes /opt/data/agentos/boot.sh
#
# The script is idempotent — safe to run multiple times.

set -e

SVC_DIR="/run/service/agentos"
PERSISTENT_DIR="/opt/data/agentos/s6"

# Skip if already registered
if [ -d "$SVC_DIR/supervise" ]; then
    echo "[agentos-boot] Service already registered, skipping"
    exit 0
fi

# Create service dir by copying persistent definition
mkdir -p "$SVC_DIR"
cp "$PERSISTENT_DIR/run" "$SVC_DIR/run"
cp "$PERSISTENT_DIR/type" "$SVC_DIR/type"
cp "$PERSISTENT_DIR/finish" "$SVC_DIR/finish"
chmod +x "$SVC_DIR/run" "$SVC_DIR/finish"

# Notify s6-svscan to scan for new services
if command -v s6-svscanctl >/dev/null 2>&1; then
    s6-svscanctl -a /run/service 2>/dev/null || true
elif [ -x /command/s6-svscanctl ]; then
    /command/s6-svscanctl -a /run/service 2>/dev/null || true
fi

echo "[agentos-boot] Service registered in /run/service/agentos"
echo "[agentos-boot] s6-svscan will start it within ~5 seconds"
#!/bin/bash
set -euo pipefail

# NovaCart temporary deployment worker.
# Maximum operating-system runtime: approximately 45 minutes.

cat > /etc/systemd/system/novacart-worker-expiry.service <<'SERVICE'
[Unit]
Description=Shut down expired NovaCart deployment worker

[Service]
Type=oneshot
ExecStart=/usr/sbin/shutdown -h now
SERVICE

cat > /etc/systemd/system/novacart-worker-expiry.timer <<'TIMER'
[Unit]
Description=NovaCart deployment worker 45-minute expiry

[Timer]
OnBootSec=45min
Unit=novacart-worker-expiry.service

[Install]
WantedBy=timers.target
TIMER

systemctl daemon-reload
systemctl enable --now novacart-worker-expiry.timer

# SSM Agent should already be installed in Amazon Linux 2023.
if systemctl list-unit-files amazon-ssm-agent.service \
  --no-legend | grep -q amazon-ssm-agent; then
  systemctl enable --now amazon-ssm-agent
fi

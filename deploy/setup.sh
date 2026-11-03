#!/usr/bin/env bash
set -e

echo "=========================================="
echo "    Concord Server - Automated Setup     "
echo "=========================================="

# 1. Update system packages
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y curl git ufw

# 1.1 Setup Swap (Crucial for 1GB/2GB VMs to prevent OOM)
if [ ! -f /swapfile ]; then
    echo "-> Creating 2GB swap file..."
    sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

# 2. Install Docker & Docker Compose Plugin if not installed
if ! command -v docker &> /dev/null; then
    echo "-> Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
fi

# 2.1 Remove Oracle default iptables REJECT rules
echo "-> Adjusting Oracle default iptables rules..."
sudo iptables -D INPUT -j REJECT --reject-with icmp-host-prohibited 2>/dev/null || true
sudo iptables -D FORWARD -j REJECT --reject-with icmp-host-prohibited 2>/dev/null || true

# 3. Configure Ubuntu UFW Firewall
echo "-> Configuring UFW Firewall..."
sudo ufw allow 22/tcp comment 'SSH'
sudo ufw allow 80/tcp comment 'HTTP'
sudo ufw allow 443/tcp comment 'HTTPS'
sudo ufw allow 7880/tcp comment 'LiveKit HTTP'
sudo ufw allow 7881/tcp comment 'LiveKit TCP fallback'
sudo ufw allow 50000:60000/udp comment 'LiveKit WebRTC Media'
sudo ufw --force enable

# 4. Oracle Keep-Alive Cron (Prevents idle VM reclaim)
echo "-> Setting up Oracle Cloud keep-alive cron..."
echo "0 */6 * * * root curl -s http://localhost:8080/health > /dev/null" | sudo tee /etc/cron.d/oracle-keepalive > /dev/null

echo "=========================================="
echo "Setup complete! Now configure your .env:"
echo "cp .env.example .env"
echo "nano .env"
echo "docker compose up -d"
echo "=========================================="

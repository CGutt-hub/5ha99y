#!/bin/bash
# Cloudflare Zero Trust Client Setup Script
# Downloads and configures cloudflared for browser-based SSH access

set -e

echo "========================================"
echo " Cloudflare Zero Trust Client Installer"
echo "========================================"
echo ""

# Detect OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
    x86_64)  ARCH="amd64" ;;
    aarch64) ARCH="arm64" ;;
    armv7l)  ARCH="arm" ;;
    *)       echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

echo "[*] Detected: $OS ($ARCH)"

# Install cloudflared
install_cloudflared() {
    if command -v cloudflared &> /dev/null; then
        echo "[✓] cloudflared is already installed"
        cloudflared --version
        return
    fi

    echo "[*] Installing cloudflared..."

    case "$OS" in
        linux)
            if command -v apt-get &> /dev/null; then
                # Debian/Ubuntu
                curl -L --output /tmp/cloudflared.deb "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb"
                sudo dpkg -i /tmp/cloudflared.deb
                rm /tmp/cloudflared.deb
            elif command -v yum &> /dev/null; then
                # RHEL/CentOS
                curl -L --output /tmp/cloudflared.rpm "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.rpm"
                sudo yum localinstall -y /tmp/cloudflared.rpm
                rm /tmp/cloudflared.rpm
            elif command -v pacman &> /dev/null; then
                # Arch
                sudo pacman -S cloudflared --noconfirm
            else
                # Generic binary install
                curl -L --output /tmp/cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}"
                sudo install -m 755 /tmp/cloudflared /usr/local/bin/cloudflared
                rm /tmp/cloudflared
            fi
            ;;
        darwin)
            if command -v brew &> /dev/null; then
                brew install cloudflare/cloudflare/cloudflared
            else
                echo "[!] Please install Homebrew first: https://brew.sh"
                exit 1
            fi
            ;;
        *)
            echo "[!] Unsupported OS: $OS"
            exit 1
            ;;
    esac

    echo "[✓] cloudflared installed successfully"
    cloudflared --version
}

# Main
install_cloudflared

echo ""
echo "========================================"
echo " Installation Complete!"
echo "========================================"
echo ""
echo "You can now access SSH via browser at your Cloudflare Access URL."
echo ""
echo "For direct SSH access (optional), run:"
echo "  cloudflared access ssh --hostname ssh.yourdomain.com"
echo ""

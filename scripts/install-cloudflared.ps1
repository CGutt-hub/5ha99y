# Cloudflare Zero Trust Client Setup Script for Windows
# Downloads and configures cloudflared for browser-based SSH access

Write-Host "========================================"
Write-Host " Cloudflare Zero Trust Client Installer"
Write-Host "========================================" 
Write-Host ""

# Check if running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "[!] Please run this script as Administrator" -ForegroundColor Yellow
    Write-Host "    Right-click PowerShell and select 'Run as Administrator'"
    exit 1
}

# Check if cloudflared is already installed
$cloudflaredPath = Get-Command cloudflared -ErrorAction SilentlyContinue

if ($cloudflaredPath) {
    Write-Host "[OK] cloudflared is already installed" -ForegroundColor Green
    cloudflared --version
} else {
    Write-Host "[*] Downloading cloudflared..." -ForegroundColor Cyan
    
    $arch = if ([Environment]::Is64BitOperatingSystem) { "amd64" } else { "386" }
    $url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-$arch.msi"
    $installerPath = "$env:TEMP\cloudflared.msi"
    
    try {
        Invoke-WebRequest -Uri $url -OutFile $installerPath -UseBasicParsing
        Write-Host "[*] Installing cloudflared..." -ForegroundColor Cyan
        
        Start-Process msiexec.exe -ArgumentList "/i", $installerPath, "/quiet", "/norestart" -Wait
        
        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
        
        Remove-Item $installerPath -Force
        
        Write-Host "[OK] cloudflared installed successfully" -ForegroundColor Green
        cloudflared --version
    } catch {
        Write-Host "[!] Installation failed: $_" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "========================================"
Write-Host " Installation Complete!"
Write-Host "========================================"
Write-Host ""
Write-Host "You can now access SSH via browser at your Cloudflare Access URL."
Write-Host ""
Write-Host "For direct SSH access (optional), run:"
Write-Host "  cloudflared access ssh --hostname ssh.yourdomain.com"
Write-Host ""

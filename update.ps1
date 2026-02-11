# Run this script to manually update content from your platforms
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

Write-Host "Installing Python dependencies..." -ForegroundColor Cyan
python -m pip install -r scripts\requirements.txt --quiet

Write-Host "Fetching data from GitHub, OSF, and ORCID..." -ForegroundColor Cyan
python scripts\fetch_data.py

Write-Host "Building site..." -ForegroundColor Cyan
zola build

Write-Host "`nDone! Your site has been updated with the latest data." -ForegroundColor Green
Write-Host "Run 'zola serve' to preview locally." -ForegroundColor Yellow

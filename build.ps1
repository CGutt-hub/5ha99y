Set-Location $PSScriptRoot
& zola build
if ($LASTEXITCODE -eq 0) {
    Write-Host "Build successful! Site generated in ./public" -ForegroundColor Green
} else {
    Write-Host "Build failed" -ForegroundColor Red
}

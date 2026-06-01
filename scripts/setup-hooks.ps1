# Setup git hooks for the project in Windows PowerShell

$hooksDir = ".git/hooks"
if (-not (Test-Path $hooksDir)) {
    Write-Host "❌ Error: .git directory not found. Please run this from the project root." -ForegroundColor Red
    Exit 1
}

Write-Host "Installing pre-commit hook..."
Copy-Item -Path "scripts/pre-commit" -Destination "$hooksDir/pre-commit" -Force
Write-Host "✅ Pre-commit hook installed successfully!" -ForegroundColor Green

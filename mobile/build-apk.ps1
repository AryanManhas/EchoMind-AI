# EchoMind AI - Native Android Build Helper
# This script verifies the environment and attempts to build a Debug APK.

$ErrorActionPreference = "Stop"

Write-Host "--- EchoMind AI: Android Native Build ---" -ForegroundColor Cyan

# 1. Environment Verification
if (-not $env:JAVA_HOME) {
    Write-Host "[!] JAVA_HOME not set. Trying Android Studio path..." -ForegroundColor Yellow
    $asPath = "C:\Program Files\Android\Android Studio\jbr"
    if (Test-Path $asPath) {
        $env:JAVA_HOME = $asPath
        $env:Path = "$asPath\bin;$env:Path"
    } else {
        Write-Host "[ERROR] JAVA_HOME is missing. Please set it to JDK 17." -ForegroundColor Red
        exit 1
    }
}

if (-not $env:ANDROID_HOME) {
    $sdkPath = "$env:LOCALAPPDATA\Android\Sdk"
    if (Test-Path $sdkPath) {
        $env:ANDROID_HOME = $sdkPath
    } else {
        Write-Host "[ERROR] ANDROID_HOME is missing." -ForegroundColor Red
        exit 1
    }
}

# 2. Cleanup
Write-Host "[1/3] Cleaning Gradle cache..." -ForegroundColor Gray
cd android
./gradlew clean

# 3. Assemble APK
Write-Host "[2/3] Assembling Debug APK..." -ForegroundColor Gray
./gradlew assembleDebug

# 4. Success Check
$apkFile = "app\build\outputs\apk\debug\app-debug.apk"
if (Test-Path $apkFile) {
    Write-Host "`n[SUCCESS] Build Complete!" -ForegroundColor Green
    Write-Host "APK Location: $(Resolve-Path $apkFile)" -ForegroundColor White
    cd ..
} else {
    Write-Host "`n[ERROR] Build finished but APK was not found." -ForegroundColor Red
    cd ..
    exit 1
}

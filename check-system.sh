#!/bin/bash

# Pre-Flight Demo Readiness Smoke Test
# Checks DB, Server Health, and external Gemini reachability.

echo -e "\n🚀 Starting EchoMind Pre-Flight Checks..."

FAIL=0

check_endpoint() {
    local label=$1
    local url=$2
    local expected=${3:-200}
    
    echo -n "Checking $label ($url)... "
    
    # Supress curl output and grab http code
    status=$(curl -s -o /dev/null -w "%{http_code}" "$url")
    
    if [ "$status" = "$expected" ]; then
        echo -e "\033[32m[PASS] \033[0m"
    else
        echo -e "\033[31m[FAIL]\033[0m (Got $status, expected $expected)"
        FAIL=1
    fi
}

# 1. Database Liveness (Assuming Neon via HTTP or Local Node Health mapping)
# Since the server hits Prisma locally, we check the global health endpoint which ensures DB is active.
check_endpoint "Local Node API" "http://localhost:8080/health" 200

# 2. External Gemini API
# If GEMINI_API_KEY is available in the environment, test it.
# We test by asking for a model list.
GEMINI_KEY=$(grep GOOGLE_API_KEY server/.env | cut -d '=' -f2)
if [ -z "$GEMINI_KEY" ]; then
    echo -e "\033[33m[SKIP]\033[0m Gemini Check: No GOOGLE_API_KEY found in server/.env"
else
    echo -n "Checking Gemini Connectivity... "
    status=$(curl -s -o /dev/null -w "%{http_code}" "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_KEY")
    if [ "$status" = "200" ]; then
        echo -e "\033[32m[PASS] \033[0m"
    else
        echo -e "\033[31m[FAIL]\033[0m (HTTP $status. Key invalid or blocked network)"
        FAIL=1
    fi
fi

# 3. Whisper Transcriber Proxy
# Ensure the Whisper proxy is up (if local)
check_endpoint "Whisper Local API" "http://localhost:8000/docs" 200

if [ $FAIL -eq 1 ]; then
    echo -e "\n\033[31m❌ PRE-FLIGHT SMOKE TEST FAILED.\033[0m Resolve issues before demo."
    exit 1
else
    echo -e "\n\033[32m✅ SYSTEM NOMINAL. Green light for demo.\033[0m"
    exit 0
fi

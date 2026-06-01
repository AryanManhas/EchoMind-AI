# EchoMind Android Release Notes

## Build Profiles

- APK: `npm run build:android:apk`
- AAB: `npm run build:android:aab`
- Preflight only: `npm run release-check`
- Expo/EAS config check: `npm run doctor`

## Required Environment

- `EXPO_PUBLIC_API_URL`
- `EXPO_PUBLIC_WS_URL`
- `EXPO_PUBLIC_GEMINI_API_KEY` for mobile runtime bundling, or `GEMINI_API_KEY` in CI before mapping it to the Expo public key
- `JAVA_HOME`
- `ANDROID_HOME` or `ANDROID_SDK_ROOT`

Optional production signing:

- `ECHOMIND_UPLOAD_STORE_FILE`
- `ECHOMIND_UPLOAD_STORE_PASSWORD`
- `ECHOMIND_UPLOAD_KEY_ALIAS`
- `ECHOMIND_UPLOAD_KEY_PASSWORD`

## Release Validation Checklist

- Fresh install opens onboarding.
- Upgrade install preserves vault and reminder storage.
- Microphone permission denial and recovery return to the listener without a blank screen.
- Listener survives background and foreground transitions.
- Wake-word and STT cycles do not duplicate timers or retain microphone ownership.
- Reminder tasks restore, transition overdue state once, and do not duplicate notification identifiers.
- Vault browsing and contextual recall reuse persisted local memory.
- Gemini stream times out or cancels without blocking local runtime.
- Backend reconnect replays the queue without reconnect storms.
- Long listener sessions keep local capture responsive while offline.

## Build Notes

- Hermes remains enabled.
- New Architecture remains disabled.
- Reanimated Babel plugin remains last.
- Minify and resource shrink remain disabled until native-module shrink coverage is verified.
- Local APK builds use debug signing when upload-keystore variables are absent. Store releases should use EAS signing or the `ECHOMIND_UPLOAD_*` variables above.

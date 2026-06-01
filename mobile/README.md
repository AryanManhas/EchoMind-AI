# EchoMind Mobile

## Local Expo Runtime

EchoMind local development is configured to load JavaScript from Metro, not
from Expo OTA updates. `app.json` disables Expo updates so Expo Go and local
development sessions do not try to fetch a stale remote manifest before the app
runtime loads.

Start the local app from this directory:

```bash
cd mobile
npx expo start --clear
```

Use the LAN QR code in Expo Go. The listener screen should open from the local
Metro bundle without `Failed to download remote update`.

## Cache Recovery

If a device still opens an old update or fails before Metro connects, clear the
cached state in this order:

1. Stop Expo/Metro.
2. Start Expo with a clean cache:

   ```bash
   cd mobile
   npx expo start --clear
   ```

3. On Android, clear Expo Go app storage:
   Settings > Apps > Expo Go > Storage & cache > Clear storage.
4. Reopen Expo Go and scan the LAN QR code again.
5. If the same remote-update error persists, uninstall and reinstall Expo Go,
   then repeat `npx expo start --clear`.

Development builds should also prefer Metro for local work. Do not add an
`updates.url` or `runtimeVersion` for local development unless OTA updates are
being intentionally re-enabled for a separate release profile.

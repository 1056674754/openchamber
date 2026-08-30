# Shared Runtime Modules

## Settings lock

`src/settings-lock.js` provides the cross-process exclusive lock used for the shared OpenChamber `settings.json` read-modify-write boundary.

- Acquisition writes a complete owner payload to a same-directory temp file and installs it with an atomic hard link.
- A live owner PID is never considered stale based on age alone.
- Dead or malformed stale locks are reclaimed behind a separate cleanup guard, with an owner-token recheck before removal.
- Contention waits are bounded and fail with `SETTINGS_LOCK_TIMEOUT`; callers retain the original failure rather than treating it as an empty settings file.
- Release removes only the lock carrying the caller's owner token.

`defaultSettingsLockPath(settingsFilePath)` places the lock beside the settings file so all runtimes coordinate on the same filesystem.

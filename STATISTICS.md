# Lux Client Analytics & Telemetry

## Overview

Lux Client collects various metrics to improve the user experience and understand usage patterns. This document explains what data is collected, how it's processed, and how users can control it.

## Data Collection Categories

### 1. Usage Analytics

**What we track:**
- Page views and navigation patterns
- Feature usage frequency
- Session duration and frequency
- Active user counts by time of day

**Why:** Helps us understand which features are most popular and where to focus development effort.

### 2. Game Launch Metrics

**What we track:**
- Instance launch frequency
- Launch success/failure rates
- Time to launch (from click to game window focus)
- Java version usage
- Modloader distribution
- Game version popularity

**Why:** Critical for identifying issues with specific game versions, modloaders, or configurations.

### 3. Error & Crash Reports

**What we track:**
- Uncaught exceptions
- Stack traces (anonymized)
- System information at time of crash
- Game logs (optional, for debugging)

**Why:** Essential for reproducing and fixing bugs. Stack traces are stripped of personal information.

### 4. Installation Metrics

**What we track:**
- Mod/modpack install success rates
- Download sources (Modrinth/CurseForge/other)
- Installation time
- Dependency resolution failures

**Why:** Helps identify problematic mods or network issues.

### 5. Performance Metrics

**What we track:**
- Application startup time
- UI responsiveness (frame timing)
- Memory usage peaks
- WebGL context availability

**Why:** Data-driven performance optimization.

## Data Handling

### Local Processing

All analytics are processed client-side before transmission:
- IP addresses are truncated to /24 network (e.g., `192.168.1.xxx` → `192.168.1.0`)
- Usernames are hashed with rotating salts
- UUIDs replace account identifiers
- Stack traces are sanitized of file paths

### ServerEndpoint

Data is sent to our analytics endpoint:
```
POST https://analytics.luxclient.dev/v1/track
```

### Data Retention

- Raw data: 30 days
- Aggregated statistics: 1 year
- Crash reports: 90 days

## User Controls

### Settings

Users can disable analytics in Settings → Privacy:
- `enableSmartLogAnalytics` - Controls detailed usage tracking
- `sendCrashReports` - Controls automatic crash reporting
- `shareErrorLogs` - Controls log sharing with error reports

### GDPR Compliance

- Users can request their data deletion via Settings → Privacy → "Request My Data"
- Data export available in JSON format
- Opt-out available during first launch

## Example Tracking Call

```json
{
  "event": "instance_launch",
  "client_version": "1.7.0",
  "timestamp": "2024-01-15T10:30:00Z",
  "instance": {
    "name": "Forge 1.20.1",
    "loader": "forge",
    "version": "47.1.0"
  },
  "duration_ms": 5234,
  "success": true,
  "client_id": "a1b2c3d4e5f6"
}
```

## Security Measures

- All requests use HTTPS with TLS 1.3
- Request signing with rotating API keys
- Client ID regeneration on factory reset
- No tracking of unauthenticated Minecraft sessions
- No integration with Mojang accounts outside explicit user actions

## Questions?

Contact: privacy@luxclient.dev
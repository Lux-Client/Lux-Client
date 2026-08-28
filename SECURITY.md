# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |
| < Latest | :x:               |

Only the latest release of Lux receives security updates. Please always update to the most recent version.

## Reporting a Vulnerability

If you discover a security vulnerability in Lux, please report it responsibly:

1. **Do NOT open a public GitHub issue** for security vulnerabilities.
2. **Email** security reports to: **security@pluginhub.de**
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Acknowledgement** within 48 hours of your report
- **Assessment** within 1 week — we will confirm whether the issue is valid and its severity
- **Fix timeline** — critical vulnerabilities will be patched as soon as possible; other issues will be scheduled for the next release
- **Credit** — we will credit you in the release notes unless you prefer to remain anonymous

### Scope

The following are in scope:
- The Lux launcher application (Electron, React frontend, backend handlers)
- Extension system and extension loading
- Authentication flows (Microsoft account login)
- Auto-update mechanism
- IPC communication between main and renderer processes

The following are out of scope:
- Vulnerabilities in third-party dependencies (report these to the upstream maintainer)
- Issues requiring physical access to the user's machine
- Social engineering attacks

## Security Measures

Lux implements the following security measures:
- **Context isolation** enabled in all BrowserWindows
- **Node integration** disabled in renderer processes
- **Sandbox** mode enabled for renderer processes
- **CSP headers** applied to all web content
- **Extension path validation** — all extension filesystem operations use centralized path-safety checks to prevent directory traversal
- **Input validation** on all IPC handlers
- **VirusTotal scanning** of release artifacts via CI/CD

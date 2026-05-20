# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Lithium, **please do not open a public GitHub issue**. Public disclosure before a fix is in place puts users at risk.

### Preferred reporting channel

Open a private [GitHub Security Advisory](https://github.com/fank040118/Lithium/security/advisories/new). Reports stay confidential until the issue is fixed and disclosure is coordinated.

### Alternative

Contact the author via [GitHub Profile](https://github.com/fank040118).

### What to include

- A clear description of the vulnerability
- Step-by-step reproduction (smallest viable repro is ideal)
- Potential impact (data exposure, privilege escalation, etc.)
- Any suggested mitigations (optional)

### Response timeline

This is a personal project with no SLA, but I will make a best effort to:

- Acknowledge receipt within **7 days**
- Provide an initial assessment within **14 days**
- Coordinate disclosure timing once a fix is ready

---

## Supported Versions

Only the **latest released version** receives security fixes.

| Version | Supported |
|---------|-----------|
| Latest release | ✅ |
| Older releases | ❌ |

---

## Scope

Security reports are welcome for issues such as:

- **Firestore Rules bypass** / unauthorized data access
- **Authentication bypass** (e.g., circumventing email verification, account takeover)
- **XSS / injection** in the extension UI
- **Sensitive data leakage** (credentials, tokens, other users' data)
- **CSRF / clickjacking** affecting the extension

### Out of scope

- Issues that require the user to install a malicious extension first
- Social engineering attacks against the author or users
- Vulnerabilities in upstream dependencies (Firebase, browser engines) — please report those upstream
- Self-XSS or issues only exploitable by the user against themselves
- Rate-limiting / quota exhaustion (mitigated via Cloud Quotas — non-critical)

---

## Acknowledgments

This project does not offer monetary bug bounties (personal/showcase project). Acknowledged security reporters may be credited in the release notes upon request.

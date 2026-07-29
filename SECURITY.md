# Security policy

## Supported versions

Security fixes target the latest published Vifito Desktop release. Older prerelease builds may be
asked to upgrade before a report is investigated.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/ludekvodicka/VifitoDesktop/security/advisories/new).
Do not include workout logs, device addresses, or exploit details in a public issue. Include the
Vifito Desktop version, operating system, package type, impact, and a minimal reproduction.

The app is read-only against the treadmill: it never writes to the FTMS Control Point (0x2AD9), so it
cannot start the belt or change the incline. A report showing that some code path can write to a
connected machine is treated as a security issue, not a feature request. Reports about the update
feed, the renderer sandbox and context isolation, the preload API surface, or the on-disk workout log
are also relevant.

Releases are unsigned. Verify a download against the `SHA256SUMS.txt` published with the release
before running it.

The project does not offer a bug bounty or a guaranteed response deadline.

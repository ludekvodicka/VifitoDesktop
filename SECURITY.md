# Security policy

## Supported versions

Security fixes target the latest published Vifito Desktop release. Older prerelease builds may be
asked to upgrade before a report is investigated.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/ludekvodicka/VifitoDesktop/security/advisories/new).
Do not include workout logs, device addresses, or exploit details in a public issue. Include the
Vifito Desktop version, operating system, package type, impact, and a minimal reproduction.

The app writes to the FTMS Control Point (0x2AD9) and can therefore start the belt, change its speed,
and change the incline. Every command is triggered by a click; nothing is sent automatically, on
connect, on reconnect, or at startup. A report showing that a command can reach the treadmill without
a deliberate user action, that Stop can be delayed or swallowed, or that a speed higher than the one
displayed can be sent, is a security issue rather than a bug. Reports about the update feed, the
renderer sandbox and context isolation, the preload API surface, or the on-disk workout log are also
relevant.

Releases are unsigned. Verify a download against the `SHA256SUMS.txt` published with the release
before running it.

The project does not offer a bug bounty or a guaranteed response deadline.

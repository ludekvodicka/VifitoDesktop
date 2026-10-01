# Security policy

## Supported versions

Security fixes target the latest published Vifito Desktop release. Older prerelease builds may be
asked to upgrade before a report is investigated.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/ludekvodicka/VifitoDesktop/security/advisories/new).
Do not include workout logs, device addresses, or exploit details in a public issue. Include the
Vifito Desktop version, operating system, package type, impact, and a minimal reproduction.

The app writes to the FTMS Control Point (0x2AD9) and can therefore start the belt, change its speed,
and change the incline. Every command is triggered by a click, or belongs to a training plan run
started with Play. Play authorizes the speed and incline commands of that one run and the Stop at
its end, and nothing else. A stopped belt goes through the same lowest-speed-first Start sequence
when Play is clicked. Nothing is sent on connect, on reconnect, or at startup, and a run never
survives STOP, End plan, a disconnect, a stopped belt or an app restart.

The following are security issues:

- A command reaching the treadmill without either a deliberate user action or authorization from
  Play for the current run.
- A plan command sent after its run ended, after STOP, across a reconnect or after a restart.
- Start sent after STOP cancelled a pending start.
- Stop delayed or swallowed, including by a running plan.
- A speed higher than the one displayed being sent.
- An incline above the maximum set in Settings being sent.

Reports about the update feed, the renderer sandbox and context isolation, the preload API surface,
or the on-disk workout log are also relevant.

Releases are unsigned. Verify a download against the `SHA256SUMS.txt` published with the release
before running it.

The project does not offer a bug bounty or a guaranteed response deadline.

# Runtime certificate trust

Vifito 0.7.3 pins Electron 43.8.1 to reject the compromised eMudhra intermediate
certificate keys in both Node TLS and Chromium. The same-major update preserves the
Web Bluetooth and updater integration. The lockfile fixes the runtime package and integrity.

## Trust paths

| Client | Application use | Verification owner |
| --- | --- | --- |
| Node HTTPS and built-in fetch | Available in the main process; no direct application network caller currently | Electron's embedded Node and BoringSSL |
| Chromium renderer and `net.request` | Web contents and Electron networking | Chromium certificate verifier |
| electron-updater 6.8.9 | Release metadata and downloads | `ElectronHttpExecutor`, using `net.request` in the `electron-updater` session |
| Browser opened by `shell.openExternal` | GitHub release page | The user's external browser |

`src/main/index.ts` creates the shared `AutoUpdateMain`. Its existing startup,
periodic check, portable-mode and install behavior remain unchanged. The renderer
uses Web Bluetooth for FTMS; this repair adds no treadmill commands or connections.

## Why root inventories are insufficient

Electron's [upstream fix](https://github.com/electron/electron/pull/55126),
[backported to 43.x](https://github.com/electron/electron/pull/55130), checks a
compiled list of blocked certificate public keys. Node applies this check to every
TLS secure context and reports `CERT_REVOKED`. Chromium has its corresponding
compiled blocklist. A trusted root can remain in `tls.rootCertificates` while a
chain containing a compromised intermediate is rejected.

Exporting the root bundle and testing it with external OpenSSL does not exercise
Electron's compiled policy. Neither an unchanged root fingerprint nor a successful
OpenSSL chain verification establishes that the patched application accepts it.
No application CA override, verification bypass, operating-system trust change or
unsupported `--use-openssl-ca` option is required.

Vifito 0.7.4 advances to Electron 43.8.3 while retaining this compiled policy.
Its separate [October runtime assessment](runtime-security-updates.md) records
the available browser-engine backports and the still-missing Node/V8 fixes.
Passing the certificate tests does not establish that those other fixes shipped.

## Release validation

Validate the actual packaged executable and its `app.asar`, with a fresh user-data
directory, independently through Node HTTPS, Node fetch, Chromium networking,
renderer navigation and the installed updater's HTTP executor. For each client,
require certificate errors for all twelve [incident test hosts](https://emudhra.we-have-a-problem.com/)
and successful connections to valid controls such as example.com and github.com.
An `EACCES`, network-access-denied error or timeout is inconclusive, including when
it happens only on the first launch of a new executable.

Run `pnpm run check`, Windows packaging and `pnpm run release:smoke -- win <output>`.
Verify update-feed hashes and compare the installer/portable payload with the
tested unpacked application. A diagnostic run must use isolated data, prevent
update installation, send no FTMS commands and stop only its own processes.

The 2026-10-21 Windows x64 candidate passed all twelve negative cases and two
positive controls for each of the five clients. It used Electron 43.8.1, Node
24.22.0 and Chromium 150.0.7871.250. All 344 application tests passed. These results
cover that candidate; other platforms and subsequent builds need their own
packaged validation. Publication and installation are separate release steps.

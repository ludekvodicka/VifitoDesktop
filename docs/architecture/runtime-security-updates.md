# October 2026 runtime security update

## Decision and boundary

Vifito 0.7.4 pins Electron 43.8.3 to receive its published ANGLE, Chromium,
PDFium, Skia and V8 backports. CI source checks and release builds pin standalone
Node 24.22.1. These are separate runtimes: rebuilding with a patched Node does
not replace or repair Electron's embedded Node.

**The October Node security update is not complete in Electron 43.8.3.** Keep
this dependency open until an official Electron release contains the missing
fixes and its packaged behavior is verified. Do not replace embedded Node or
patch application built-ins as a substitute for an upstream runtime release.

## Upstream evidence, 2026-10-21

[Node 24.22.1](https://github.com/nodejs/node/releases/tag/v24.22.1),
[22.23.4](https://github.com/nodejs/node/releases/tag/v22.23.4) and
[26.12.1](https://github.com/nodejs/node/releases/tag/v26.12.1) were published
as security releases. The [October announcement](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
rates the highest issue HIGH on all three lines. The announcement still had
pre-release wording when the release tags and binaries were already available.

[Electron 43.8.3](https://github.com/electron/electron/releases/tag/v43.8.3)
was published earlier that day at commit
`1c0ee213f150fc4a0d06304dcedabd9b2e8ce0f7`.
Its [DEPS](https://github.com/electron/electron/blob/v43.8.3/DEPS) selects
`nodejs/node` tag `v24.22.0`. All 66 entries in its
[Node patch series](https://github.com/electron/electron/blob/v43.8.3/patches/node/.patches)
were inspected. None modifies the Node HTTP guard, DNS validation, TLS identity,
random-cache or realpath files changed by the October fixes.
The [43.8.1 to 43.8.3 comparison](https://github.com/electron/electron/compare/v43.8.1...v43.8.3)
contains two commits, no Node patch or DEPS changes. The new browser-engine
backports are [PR 55147](https://github.com/electron/electron/pull/55147).

| Change in Node 24.22.1 | Electron 43.8.3 assessment | Vifito exposure |
| --- | --- | --- |
| CVE-2026-105481, HTTP free-socket data guard, `96c3ccb1fc` | Missing `hasPendingRead` guard in the executable's embedded source | No direct application Node HTTP client or server. Updater uses Chromium `net.request`. |
| CVE-2026-105482, DNS NUL validation, `843a1627dc` | Missing. `Resolver.setLocalAddress` accepts a NUL-suffixed address; standalone 24.22.1 throws `ERR_INVALID_ARG_VALUE`. | No application DNS resolver or attacker-supplied hostname setting. |
| CVE-2026-105483 and CVE-2026-106069, TLS IP identity, `de49c913f2` and `935918e342` | Both changes absent from the selected Node source and patch series | No direct application Node TLS client. This is distinct from the compiled CA blocklist. |
| CVE-2026-106073, realpath permission check, `8dc18a6218` | Missing upfront permission check in embedded `realpathSync` | Vifito does not enable Node's permission model. Electron renderer sandboxing is a different mechanism. |
| CVE-2026-106074, random caches across snapshots, `4d6990b33c` | Missing cache reset in embedded source | No application-authored V8 startup snapshot or authentication token generator. Plan IDs use UUIDs; this does not demonstrate snapshot exploitation. |
| CVE-2026-111497, Brotli decoder fix, `49dff6f57a` | Decoder fix already present in Chromium's linked Brotli. Node's new error constant export is absent. | Renderer/network decoding can use Brotli. Missing constant alone does not imply a vulnerable decoder. |
| V8 escaped-key JSON parsing, `fca511adc5`, upstream `93cd21e8254b` | Upstream regression reproduces in both Electron 43.8.1 and 43.8.3. Standalone Node 24.22.1 passes all six cases. | App parses JSON settings, plans, history and updater metadata. Reproduction proves affected parsing, not an end-to-end exploit of Vifito. |

Electron's [GN patch](https://github.com/electron/electron/blob/v43.8.3/patches/node/build_add_gn_build_files.patch)
links Chromium's Brotli decoder. The selected
[Chromium decoder](https://github.com/chromium/chromium/blob/150.0.7871.250/third_party/brotli/dec/decode.c)
already returns `BROTLI_DECODER_ERROR_FORMAT_BLOCK_SWITCH` for invalid block switches
and propagates that status. Its recorded Brotli revision is
`cfa184a997ac19454d5a3ae97f6d600aac2445a6`.

The [V8 regression](https://github.com/nodejs/node/blob/v24.22.1/deps/v8/test/mjsunit/regress/regress-json-escaped-key-transition.js)
fails on the first case in both actual packaged Electron executables: a later
JSON parse changes an escaped form-feed key into a backslash key after a prior
parse. The test uses isolated processes and synthetic data, without opening app
profiles or network connections.

Electron uses BoringSSL (`process.versions.openssl` is `0.0.0`), so the standalone
Node OpenSSL 3.5.9 upgrade is not an Electron OpenSSL replacement. Embedded c-ares
1.34.8 and Undici 7.29.1 also differ from standalone Node 24.22.1's 1.34.9 and
7.30.1. A version difference alone is not an applicability verdict.

## Runtime ownership and entry points

- `package.json` and `pnpm-lock.yaml` select Electron. `pnpm-workspace.yaml`
  admits this exact newly published Electron version through pnpm's release-age
  policy after official-source inspection.
- `.github/workflows/ci.yml` and `.github/workflows/release.yml` select Node
  24.22.1 for dependency installation, tests and packaging. Pnpm remains 11.15.1.
  GitHub actions themselves use their own runner-provided JavaScript runtime;
  `setup-node` does not replace that runtime.
- Local build commands use the Node on their process PATH. Use patched Node 24
  tooling before building; this change does not modify machine-wide defaults.
- `src/main/index.ts` and `shared/electron/autoUpdate` use the existing updater
  integration. There is no app-owned Node sidecar or child Node server in source
  or the Windows package. `resources/elevate.exe` is the updater elevation helper.
- No shared updater source, BLE behavior or application data format changes.

## Validation and remaining dependency

The Windows x64 0.7.4 candidate passed all 344 tests, types, version and
third-party checks, production build, packaging and updater-feed validation.
Its actual executable reports Electron 43.8.3, Node 24.22.0, Chromium
150.0.7871.250 and V8 15.0.245.31-electron.0.

The final isolated packaged CA run on 2026-10-21 at 12:17:44 UTC passed all
twelve affected chains and both valid controls through Node HTTPS, Node fetch,
Chromium networking, renderer navigation and the real updater HTTP executor:
60 certificate rejections and 10 successful controls. An earlier attempt had
Node `EACCES` results, including controls; those results remain inconclusive.
No firewall or trust setting was changed. See
[runtime certificate trust](runtime-certificate-trust.md) for the compiled
policy and test requirements. The earlier 0.7.3 validation remains valid for
that earlier payload.

Application tests and CA checks do not pass the missing October Node/V8 fixes.
The failed upstream JSON regression and missing Node fixes remain a release
dependency for completing the October runtime remediation. A subsequent
official Electron candidate needs its own version, source assessment, regression
results, packaging, client/CA checks and rollout proof. macOS/Linux live runtime
checks and physical Bluetooth behavior are not covered by the Windows tests.

# Contributing to Vifito Desktop

Bug reports and focused pull requests are welcome. For security issues, follow
[SECURITY.md](SECURITY.md) instead of opening a public issue.

## Development setup

Use Node.js 24 and pnpm 11:

```sh
pnpm install
pnpm dev
```

Before submitting a change, run:

```sh
pnpm run check
```

That covers the release version, the third-party inventory, type checking, unit tests, and the build.
Bluetooth behavior cannot be tested in CI, so a change that touches the connection or the FTMS parser
should say which treadmill console it was exercised against, and paste the raw hex frames from the
Diagnostics tab.

## Pull requests

- Keep each pull request focused and explain the user-visible behavior.
- Add or update parser tests when you change frame decoding, using captured hex frames.
- Never commit workout logs, device identifiers, or local machine paths.
- Do not add a write path to the FTMS Control Point (0x2AD9). Reading is the whole scope of this app;
  starting a belt from software is a safety decision, not a feature toggle.

The maintainer's internal source of truth is SVN and GitHub is a reviewed public projection. After a
PR merges, the maintainer backports it into the internal tree before the next public sync.
Contributors do not need SVN access or any private tooling.

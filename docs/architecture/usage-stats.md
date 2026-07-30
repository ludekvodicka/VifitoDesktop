# Usage statistics

## Decision

Each use of the treadmill is stored as a record, and the records are a **derived cache** rather than
a second source of truth. The raw per-day JSONL sample log stays authoritative; `data/stats/<day>.json`
holds what was computed from it, tagged with `STATS_SCHEMA_VERSION`.

A stats file that is missing, carries a different version, or fails to parse is rebuilt from the log
and rewritten. That single mechanism covers three things at once: the history recorded before this
feature existed appears without any migration step, a new field never needs a file migration, and a
corrupted cache repairs itself.

## What a record is

**A record is a block of presence: a run of samples with no gap longer than 30 seconds.** This was
the user's decision. The alternative, splitting on the console's counter reset, was proposed and
declined; on 2026-07-30 the gap rule produced four records where the counters had reset nine times.

The consequence is that one record can contain several counter resets, so the counters must sum
across them. They do, because the counters are chained **per day**, not per record: `accumulate()`
credits every increment to whichever record is open at the time.

Two properties follow, and both are pinned by tests:

- `Σ records = day totals = summarizeDay(...)`. A record and the header can never disagree.
- A workout that survives a dropped connection credits the next record with the increment alone, not
  the absolute counter value. Its `durationSec` can therefore exceed `endedAt - startedAt`: the time
  is counted by the console, not by the wall clock.

`startedAt` is backdated when the first elapsed credit of a record was added whole, which is what
happens when the app joins a workout the console had already been counting. It is clamped to local
midnight and to the previous record's end. Without it a record read "8 minutes, 49 minutes walked".

A block with no console time and no distance is counted as a session but is not emitted as a record:
the app sitting connected next to a still belt is not a use of the machine.

## Counters standing on the console at connect time

The console counts with no computer attached. A connection can therefore start in the middle of a
workout, and the first frame arrives with the counters already well above zero: on 2026-07-30 it read
2623 seconds and 2960 metres while the belt was running at 5.1 km/h.

Crediting that whole is right when it was your own walk and wrong when it was somebody else's, and
the data cannot tell the difference. So the app asks. Until the question is answered the samples are
buffered and nothing is written; after a minute the safe answer is assumed.

The answer is stored **in the raw log**, as `counterBaseline: true` on the first sample of the
connection, rather than by adjusting numbers. The log stays a faithful record of what the console
said plus what the user decided, and rebuilding the cache reaches the same records every time.

This is the isolation mechanism for a shared machine. Two people on separate Windows accounts already
have separate histories; this is what stops one of them inheriting the other's kilometres through the
console.

## Calories

A record stores `kcalPerKg`, the ACSM walking or running equation integrated over the samples, and
`kcalConsole`, the increments the console reported. The displayed number is `kcalPerKg × weight` from
the profile, falling back to the console value when no weight is filled in, and to a dash when
neither exists. The origin is labelled in the UI.

Storing the estimate per kilogram is what lets a weight change in Settings reprice the whole history
without invalidating a single cache file, because the equation is exactly linear in weight.

The profile holds age, sex, weight and height. **Only weight enters the number**, together with the
speed, incline and time the console reports; the rest is stored because the user asked for it and may
matter for a resting-metabolism figure later. The Settings hint says so plainly rather than implying
a precision the estimate does not have.

## Targets

Samples carry optional `targetSpeedKmh` and `targetInclinePercent`: what the app last sent to the
treadmill. History logged before this feature has neither, which is accepted. They answer "with what
settings" as far as the data allows; a change made on the console's own buttons is invisible to the
app, so the record also carries the observed average and maximum speed and incline.

## Reversal: the three-tab criterion

The plan `.aidocs/completed/plans/2026-07-30-diagnostics-layout-setting.md` accepted "navigation
contains at most three tabs" as a criterion, and this change **deliberately retires it**. Navigation
is now Live data, Stats, Settings, with the optional Diagnostics right-aligned. The criterion was an
acceptance condition of that change, not a standing rule, and the user confirmed the reversal. With
diagnostics switched off, three tabs are still what is visible.

## Isolation between people

A user is a Windows account. Installed builds write under `app.getPath('userData')`, which is already
per-account, so no profile layer, person picker or per-user directory exists. A build from source
writes into the project's own `data/`, which is a developer exception.

## Console history import: investigation

Standard FTMS carries live telemetry only; it has no characteristic for stored workouts. The one
remaining possibility is a vendor service (`0xFFF0`, `0xFFE0`, `0xFEE7` are already in the Web
Bluetooth whitelist). Diagnostics has a **Save dump** button that writes the current GATT dump to
`data/diagnostics/gatt-dump-<timestamp>.json` so the question can be answered from evidence.

**Status: not yet investigated.** It needs the treadmill connected. The decision point has exactly
three outcomes: a vendor service that looks like a history carrier, in which case a follow-up plan is
written; nothing of the sort, in which case the import is closed as impossible; or unclear, in which
case what further work would cost is written down.

Whatever the outcome, an import may never run automatically. One machine is shared by two people, so
each stored workout would have to be offered with an explicit "this was me, download it" choice.

## Entry points

- `src/shared/stats.ts` owns every stats type, including `Sample` and `DaySummary`, which used to be
  hand-duplicated between the main process and the preload.
- `src/shared/calories.ts` holds the pure calorie functions.
- `src/main/summary.ts` builds the records (`createDayStatsBuilder`, `buildDayStats`); `summarizeDay`
  is a thin map over the same pass.
- `src/main/stats-store.ts` owns the cache, the rebuild and today's in-memory accumulator.
- `src/main/session-log.ts` takes its base directory as a parameter, which keeps it testable without
  electron.
- `src/main/index.ts` appends to the log first and ingests into the cache second; an ingest failure is
  logged and never blocks the raw data.
- `src/renderer/Stats.tsx` renders the record list and the 14-day chart, both hand-written.

## Trade-offs

- `stats:get` returns the whole history in one call and the renderer refreshes it after every flush.
  At the current scale that is kilobytes; if the history grows to years, the refresh should be
  limited to the visible tab.
- The first `overview()` after an upgrade parses every JSONL file once. Later runs read the cache.
- Today's stats file is rewritten on every 5 s flush. It is about 2 kB.

export type Sample = {
  t: number
  speedKmh?: number
  distanceM?: number
  inclinePercent?: number
  elapsedSec?: number
  energyTotalKcal?: number
  heartRateBpm?: number
  /** Targets the app sent to the treadmill; absent in history logged before this feature existed. */
  targetSpeedKmh?: number
  targetInclinePercent?: number
  /**
   * Set on the first sample of a connection when the user declined the counters the console was
   * already carrying. The values become the starting point instead of being credited, which is what
   * keeps somebody else's walk out of this history on a shared machine.
   */
  counterBaseline?: true
}

export type DaySummary = {
  samples: number
  /** Metres walked over the whole day. */
  distanceM: number
  /** Workout time over the whole day, as counted by the console. */
  movingSec: number
  sessions: number
}

/** One use of the machine: a run of samples with no gap longer than MAX_GAP_SEC between them. */
export type UseRecord = {
  /** Backdated when the app joined a workout the console had already been counting. */
  startedAt: number
  endedAt: number
  /** Console-counted time, summed across counter resets inside the record. */
  durationSec: number
  distanceM: number
  /** From distance over duration, not the mean of samples: most samples read zero speed. */
  avgSpeedKmh: number
  maxSpeedKmh?: number
  /** Time-weighted over the samples that carry an incline. */
  avgInclinePercent?: number
  maxInclinePercent?: number
  kcalConsole: number
  /** Weight-independent, so a weight change in the profile reprices history without a rebuild. */
  kcalPerKg: number
  /** Mean of the non-zero readings; the console reports 0 rather than omitting the field. */
  avgHeartRateBpm?: number
  /** Last target seen inside the record, if the app set one. */
  targetSpeedKmh?: number
  targetInclinePercent?: number
  samples: number
}

export type DayTotals = {
  samples: number
  distanceM: number
  movingSec: number
  /** Gap-separated groups including the ones too empty to become a record, so summarizeDay agrees. */
  sessions: number
  kcalConsole: number
  kcalPerKg: number
}

export type DayStats = {
  /** Local YYYY-MM-DD, the same key the sample log uses for its file names. */
  day: string
  totals: DayTotals
  records: UseRecord[]
}

/** Newest day first; today is included and updated as samples arrive. */
export type StatsOverview = { days: DayStats[] }

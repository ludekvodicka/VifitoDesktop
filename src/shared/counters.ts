export type Counter = { total: number; last?: number }
/** `whole` marks the credit that was added in full, which is how a mid-workout join is detected. */
export type Credit = { delta: number; whole: boolean }

/**
 * Console counters (distance, time, calories) grow during a workout and drop back to zero when a
 * new one starts. Increments are therefore taken against the last SEEN value, not against the
 * previous sample: the console does not send every field in every frame, so an absolute value
 * would otherwise be counted again and again. The first value seen on a given day is added whole,
 * because the workout was already running before the app connected; a drop counts as a new workout.
 *
 * The counters are kept per DAY, not per record, so a workout that survives a dropped connection
 * credits the next record with the increment alone. That is what keeps the sum of the records equal
 * to the day totals.
 */
export function accumulate(counter: Counter, value: number | undefined): Credit {
  if (value === undefined) return { delta: 0, whole: false }
  const previous = counter.last
  counter.last = value
  if (previous === undefined || value < previous) {
    counter.total += value
    return { delta: value, whole: true }
  }
  const delta = value - previous
  counter.total += delta
  return { delta, whole: false }
}

/** Takes the value as the new starting point without crediting it to anybody. */
export function seed(counter: Counter, value: number | undefined): Credit {
  if (value !== undefined) counter.last = value
  return { delta: 0, whole: false }
}

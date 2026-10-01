import { useEffect, useState } from 'react'

export function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    if (!ticking) return
    setNow(performance.now())
    const timer = setInterval(() => setNow(performance.now()), 250)
    return () => clearInterval(timer)
  }, [ticking])
  return now
}

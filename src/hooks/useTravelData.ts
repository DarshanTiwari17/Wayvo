import { useCallback, useEffect, useState } from 'react'
import { fetchOpenDisruptions, fetchRecoveryPlans, fetchTrips, TravelDataError } from '../services/travelService'

/**
 * Loads real rows from Supabase and reports three distinct outcomes:
 *
 *   'ready'    -> the query succeeded; `rows` is exactly what the database holds
 *                 (possibly an empty array, which is not an error)
 *   'error'    -> the query failed; `error` explains why
 *   'missing'  -> the table does not exist yet, i.e. the migration has not been
 *                 run. Reported plainly instead of being disguised as "no data".
 *
 * Nothing here fabricates a row.
 */

type Query<T> = {
  rows: T[]
  status: 'loading' | 'ready' | 'error' | 'missing'
  error: string | null
  reload: () => void
}

/** `T` is the row type, e.g. `Trip`. The loader returns a list of them. */
function useQuery<T>(load: () => Promise<T[]>): Query<T> {
  const [rows, setRows] = useState<T[]>([])
  const [status, setStatus] = useState<Query<T>['status']>('loading')
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let active = true
    setStatus('loading')
    setError(null)

    void load()
      .then((next) => {
        if (!active) return
        setRows(next)
        setStatus('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setRows([])
        if (cause instanceof TravelDataError && cause.isMissingTable) {
          setStatus('missing')
          setError(null)
          return
        }
        setStatus('error')
        setError(cause instanceof Error ? cause.message : 'Something went wrong loading this.')
      })

    return () => {
      active = false
    }
  }, [load, nonce])

  return { rows, status, error, reload }
}

export function useJourneys(userId: string | undefined) {
  // The loader must be referentially stable: `useQuery` keys its effect on it,
  // so an inline arrow would re-run the effect on every render and never settle.
  const load = useCallback(() => fetchTrips(userId as string), [userId])
  return useQuery(load)
}

export function useOpenDisruptions(userId: string | undefined) {
  const load = useCallback(() => fetchOpenDisruptions(userId as string), [userId])
  return useQuery(load)
}

export function useRecoveryPlans(userId: string | undefined) {
  const load = useCallback(() => fetchRecoveryPlans(userId as string), [userId])
  return useQuery(load)
}

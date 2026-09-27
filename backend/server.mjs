import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateRoute, geocodePlace } from './navigationService.mjs'
import { fetchSocialSignals, fetchSocialSignalsSummary } from './socialSignalsService.mjs'
import { fetchWeather } from './weatherService.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envFile = resolve(root, 'backend/.env')

function loadEnvFile() {
  if (!existsSync(envFile)) return
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
}

loadEnvFile()

const port = Number(process.env.PORT || 8787)
const allowedOrigins = (process.env.ALLOWED_REDIRECT_ORIGINS || 'http://localhost:5173,http://localhost:5180')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

function headers(request) {
  const origin = request.headers.origin
  return {
    'access-control-allow-origin': origin && allowedOrigins.includes(origin) ? origin : 'null',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'content-type': 'application/json; charset=utf-8',
    vary: 'Origin',
  }
}

function send(response, request, status, body) {
  response.writeHead(status, headers(request))
  response.end(JSON.stringify(body))
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 1024 * 1024) throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 })
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function requireUser(request) {
  const supabaseUrl = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  const authorization = request.headers.authorization
  if (!supabaseUrl || !anonKey || !authorization) throw Object.assign(new Error('Navigation backend is not configured or the user is unauthorised.'), { statusCode: 401 })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { authorization, apikey: anonKey }, signal: controller.signal })
    if (!response.ok) throw Object.assign(new Error('Unauthorised.'), { statusCode: 401 })
  } finally {
    clearTimeout(timeout)
  }
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, headers(request))
    response.end()
    return
  }

  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
  const path = url.pathname

  /* ------------------------------------------------------------------
   * Social Signals (GET)
   * ---------------------------------------------------------------- */

  if (request.method === 'GET' && path === '/api/social-signals') {
    try {
      await requireUser(request)

      const location = url.searchParams.get('location')?.trim() || ''
      const keyword = url.searchParams.get('keyword')?.trim() || ''
      const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
      const limit = Math.min(30, Math.max(1, Number(url.searchParams.get('limit')) || 10))

      if (!location && !keyword) {
        send(response, request, 400, { error: 'Provide at least a location or keyword.' })
        return
      }

      console.log(`[social-signals] location="${location}" keyword="${keyword}" page=${page} limit=${limit}`)
      const result = await fetchSocialSignals({ location, keyword, page, limit })
      send(response, request, 200, result)
    } catch (error) {
      console.error('[social-signals] error:', error.message)
      send(response, request, Number(error.statusCode) || 502, { error: error instanceof Error ? error.message : 'Social signals request failed.' })
    }
    return
  }

  if (request.method === 'GET' && path === '/api/social-signals/summary') {
    try {
      await requireUser(request)

      const location = url.searchParams.get('location')?.trim() || ''
      if (!location) {
        send(response, request, 400, { error: 'A location is required.' })
        return
      }

      console.log(`[social-signals] summary location="${location}"`)
      const result = await fetchSocialSignalsSummary({ location })
      send(response, request, 200, result)
    } catch (error) {
      console.error('[social-signals] summary error:', error.message)
      send(response, request, Number(error.statusCode) || 502, { error: error instanceof Error ? error.message : 'Social signals summary request failed.' })
    }
    return
  }

  /* ------------------------------------------------------------------
   * Weather (GET)
   * ---------------------------------------------------------------- */

  if (request.method === 'GET' && path === '/api/weather') {
    try {
      await requireUser(request)

      const lat = Number(url.searchParams.get('lat')) || undefined
      const lng = Number(url.searchParams.get('lng')) || undefined
      const place = url.searchParams.get('place')?.trim() || undefined

      if ((!lat || !lng) && !place) {
        send(response, request, 400, { error: 'Provide lat/lng or place.' })
        return
      }

      console.log(`[weather] lat=${lat} lng=${lng} place="${place}"`)
      const result = await fetchWeather({ lat, lng, place })
      send(response, request, 200, result)
    } catch (error) {
      console.error('[weather] error:', error.message)
      send(response, request, Number(error.statusCode) || 502, { error: error instanceof Error ? error.message : 'Weather request failed.' })
    }
    return
  }

  /* ------------------------------------------------------------------
   * Navigation (POST) — existing endpoints, unchanged
   * ---------------------------------------------------------------- */

  if (request.method !== 'POST' || !path.startsWith('/api/navigation/')) {
    send(response, request, 404, { error: 'Not found.' })
    return
  }

  try {
    await requireUser(request)
    const body = await readJson(request)

    if (path === '/api/navigation/geocode') {
      if (typeof body.query !== 'string' || !body.query.trim()) throw Object.assign(new Error('A place is required.'), { statusCode: 400 })
      send(response, request, 200, { coordinates: await geocodePlace(body.query.trim()) })
      return
    }
    if (path === '/api/navigation/route') {
      send(response, request, 200, await calculateRoute(body))
      return
    }
    send(response, request, 404, { error: 'Not found.' })
  } catch (error) {
    send(response, request, Number(error.statusCode) || 502, { error: error instanceof Error ? error.message : 'Navigation request failed.' })
  }
})

server.listen(port, () => console.log(`Wayvo backend listening on http://localhost:${port}`))

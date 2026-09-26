# Wayvo Navigation Backend

This small Node backend keeps the OpenRouteService key out of browser code.
It validates the caller's Supabase access token, geocodes journey destinations,
and returns ORS GeoJSON route data for the Navigate page.

## Run locally

```powershell
copy backend\.env.example backend\.env
# Fill backend\.env with real values.
npm run backend:dev
```

The frontend proxies `/api/navigation/*` to `http://localhost:8787`.

Endpoints:

- `POST /api/navigation/geocode` with `{ "query": "Paris" }`
- `POST /api/navigation/route` with current/destination latitude and longitude plus `profile`

Both endpoints require `Authorization: Bearer <Supabase access token>`.
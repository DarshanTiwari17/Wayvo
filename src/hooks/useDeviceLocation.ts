import { useEffect, useState } from 'react'
import type { DeviceLocation } from '../types/recoveryNavigation'

export type DeviceLocationStatus = 'idle' | 'watching' | 'denied' | 'unavailable' | 'timeout' | 'error'

export function useDeviceLocation(enabled: boolean) {
  const [location, setLocation] = useState<DeviceLocation | null>(null)
  const [status, setStatus] = useState<DeviceLocationStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      setStatus('idle')
      return
    }
    if (!navigator.geolocation) {
      setStatus('unavailable')
      setMessage('This browser does not provide device location.')
      return
    }

    setStatus('watching')
    setMessage(null)
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          timestamp: position.timestamp,
        })
        setStatus('watching')
        setMessage(null)
      },
      (error) => {
        const nextStatus = error.code === error.PERMISSION_DENIED ? 'denied' : error.code === error.TIMEOUT ? 'timeout' : 'error'
        setStatus(nextStatus)
        setMessage(error.message || 'The device location could not be read.')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
    )

    return () => navigator.geolocation.clearWatch(watchId)
  }, [enabled])

  return { location, status, message }
}
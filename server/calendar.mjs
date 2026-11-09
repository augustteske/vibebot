export async function refreshGoogleAccessToken({
  refreshToken,
  clientId,
  clientSecret,
  fetchImpl = globalThis.fetch,
}) {
  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error('refreshToken, clientId and clientSecret are required')
  }
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`Failed to refresh Google token (${res.status}): ${errorText}`)
  }
  return await res.json()
}

export async function createGoogleCalendarEvent({
  accessToken,
  refreshToken,
  clientId,
  clientSecret,
  title,
  description,
  startDateTime,
  endDateTime,
  timeZone = 'UTC',
  fetchImpl = globalThis.fetch,
  onTokenRefreshed,
}) {
  if (!accessToken && !refreshToken) {
    throw new Error('Google access token or refresh token is required')
  }
  if (!title) {
    throw new Error('Calendar event title is required')
  }

  const payload = {
    summary: title.startsWith('[Vibee]') ? title : `[Vibee] ${title}`,
    description: description ? `${description}\n\nСоздано автоматически в Vibee` : 'Создано автоматически в Vibee',
    start: {
      dateTime: startDateTime || new Date(Date.now() + 86400000).toISOString(),
      timeZone,
    },
    end: {
      dateTime: endDateTime || new Date(Date.now() + 86400000 + 3600000).toISOString(),
      timeZone,
    },
  }

  let activeToken = accessToken
  if (!activeToken && refreshToken && clientId && clientSecret) {
    const refreshed = await refreshGoogleAccessToken({ refreshToken, clientId, clientSecret, fetchImpl })
    activeToken = refreshed.access_token
    if (onTokenRefreshed) await onTokenRefreshed(refreshed)
  }

  let res = await fetchImpl('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${activeToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  // If unauthorized and we have refreshToken, attempt one refresh and retry
  if (res.status === 401 && refreshToken && clientId && clientSecret) {
    const refreshed = await refreshGoogleAccessToken({ refreshToken, clientId, clientSecret, fetchImpl })
    activeToken = refreshed.access_token
    if (onTokenRefreshed) await onTokenRefreshed(refreshed)

    res = await fetchImpl('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${activeToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  }

  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`Failed to create Google Calendar event (${res.status}): ${errorText}`)
  }

  return await res.json()
}

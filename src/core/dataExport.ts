export async function downloadUserData(): Promise<void> {
  const response = await fetch('/api/export-my-data', {
    headers: {
      'x-vibee': '1',
    },
  })
  if (!response.ok) {
    let message = 'Не удалось экспортировать данные'
    try {
      const err = await response.json()
      if (err?.error?.message) message = err.error.message
    } catch {}
    throw new Error(message)
  }
  const data = await response.json()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json; charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `vibee-my-data-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

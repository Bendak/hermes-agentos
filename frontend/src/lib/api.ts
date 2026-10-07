// WI-8 batch 2 (F-WI2-UI-04): erro amigável — o corpo bruto (JSON cru
// {"detail":"..."}) nunca vira mensagem de UI.
export async function apiErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  try {
    const data = JSON.parse(text)
    return data?.detail || data?.message || text || `Request failed (${res.status})`
  } catch {
    return text || `Request failed (${res.status})`
  }
}

// QR на наклейке — ссылка на карточку оборудования: её открывает обычная камера телефона.
export const qrLink = (code: string) =>
  `${window.location.origin}/equipment?qr=${encodeURIComponent(code)}`

// Сканер внутри приложения понимает и ссылку, и «голый» код вида EQ-1001.
export function qrFromScan(text: string) {
  try {
    return new URL(text).searchParams.get('qr') ?? text
  } catch {
    return text
  }
}

export async function exportExcel(rows: Record<string, unknown>[]) {
  const XLSX = await import('xlsx')
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(rows),
    'Наряды',
  )
  XLSX.writeFile(workbook, 'НарядAI-отчёт.xlsx')
}
export async function exportPdf(lines: string[]) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF()
  const canvas = document.createElement('canvas')
  canvas.width = 1240
  canvas.height = 1754
  const ctx = canvas.getContext('2d')!
  let y = 90,
    pages = 0
  function clear() {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 1240, 1754)
    ctx.fillStyle = '#18322f'
    ctx.font = '28px Arial'
    y = 90
  }
  function page() {
    if (pages++) pdf.addPage()
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 210, 297)
  }
  clear()
  for (const text of lines) {
    let line = ''
    for (const word of text.split(/\s+/)) {
      if (ctx.measureText(line + word).width > 1080 && line) {
        ctx.fillText(line, 80, y)
        y += 42
        line = ''
        if (y > 1650) {
          page()
          clear()
        }
      }
      line += `${word} `
    }
    ctx.fillText(line, 80, y)
    y += 52
    if (y > 1650) {
      page()
      clear()
    }
  }
  page()
  pdf.save('НарядAI-отчёт.pdf')
}

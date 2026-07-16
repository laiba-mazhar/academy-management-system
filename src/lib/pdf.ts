// jsPDF + autotable are only needed when actually exporting a PDF, and pull in
// a sizeable dependency (html2canvas et al.) — dynamic import keeps them out of
// the main bundle until this function is actually called. The logo is also
// imported dynamically alongside them so its base64 payload never lands in
// the main bundle either.
const LOGO_WIDTH_MM = 16
const LOGO_ASPECT = 512 / 461 // width / height of the source logo asset

export async function downloadAttendanceSheetPdf(params: {
  className: string
  date: string
  rows: { name: string; status: string }[]
}) {
  const { className, date, rows } = params
  const [{ default: jsPDF }, { default: autoTable }, { MAKTAB_LOGO_BASE64 }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('@/assets/maktabLogoBase64'),
  ])
  const doc = new jsPDF()

  const logoHeight = LOGO_WIDTH_MM / LOGO_ASPECT
  doc.addImage(MAKTAB_LOGO_BASE64, 'PNG', 105 - LOGO_WIDTH_MM / 2, 8, LOGO_WIDTH_MM, logoHeight)

  const textStartY = 8 + logoHeight + 6
  doc.setFontSize(14)
  doc.text('Maktab Educational Institute', 105, textStartY, { align: 'center' })
  doc.setFontSize(11)
  doc.setTextColor(100)
  doc.text('Attendance Sheet', 105, textStartY + 7, { align: 'center' })
  doc.setTextColor(0)
  doc.setFontSize(10)
  const detailsY = textStartY + 18
  doc.text(`Class: ${className}`, 14, detailsY)
  doc.text(`Date: ${date}`, 196, detailsY, { align: 'right' })

  autoTable(doc, {
    startY: detailsY + 6,
    head: [['#', 'Student Name', 'Status']],
    body: rows.map((r, i) => [String(i + 1), r.name, r.status || '—']),
    headStyles: { fillColor: [122, 31, 46] },
    styles: { fontSize: 10 },
  })

  const present = rows.filter((r) => r.status === 'present' || r.status === 'late').length
  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY ?? detailsY + 6
  doc.setFontSize(9)
  doc.setTextColor(100)
  doc.text(`Present/Late: ${present} of ${rows.length}`, 14, finalY + 8)

  doc.save(`attendance-${className.replace(/\s+/g, '_')}-${date}.pdf`)
}

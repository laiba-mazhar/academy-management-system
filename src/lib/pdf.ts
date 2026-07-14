// jsPDF + autotable are only needed when actually exporting a PDF, and pull in
// a sizeable dependency (html2canvas et al.) — dynamic import keeps them out of
// the main bundle until this function is actually called.
export async function downloadAttendanceSheetPdf(params: {
  className: string
  date: string
  rows: { name: string; status: string }[]
}) {
  const { className, date, rows } = params
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const doc = new jsPDF()

  doc.setFontSize(14)
  doc.text('Al Maktab Educational Institute', 105, 16, { align: 'center' })
  doc.setFontSize(11)
  doc.setTextColor(100)
  doc.text('Attendance Sheet', 105, 23, { align: 'center' })
  doc.setTextColor(0)
  doc.setFontSize(10)
  doc.text(`Class: ${className}`, 14, 34)
  doc.text(`Date: ${date}`, 196, 34, { align: 'right' })

  autoTable(doc, {
    startY: 40,
    head: [['#', 'Student Name', 'Status']],
    body: rows.map((r, i) => [String(i + 1), r.name, r.status || '—']),
    headStyles: { fillColor: [122, 31, 46] },
    styles: { fontSize: 10 },
  })

  const present = rows.filter((r) => r.status === 'present' || r.status === 'late').length
  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY ?? 40
  doc.setFontSize(9)
  doc.setTextColor(100)
  doc.text(`Present/Late: ${present} of ${rows.length}`, 14, finalY + 8)

  doc.save(`attendance-${className.replace(/\s+/g, '_')}-${date}.pdf`)
}

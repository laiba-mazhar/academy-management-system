// One-off dev script: adds a few dummy timetable slots for every class that
// has active subjects with an assigned teacher. Skips slots that would
// conflict with existing bookings for that class or teacher.
//
// Usage:
//   1. Add SUPABASE_SERVICE_ROLE_KEY=... to .env.local (Supabase dashboard ->
//      Project Settings -> API -> service_role key). Never commit this key.
//   2. node --env-file=.env.local scripts/seed-timetable-dummy.mjs

import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.')
  process.exit(1)
}

const supabase = createClient(url, serviceKey)

const DAYS = [1, 2, 3, 4, 5, 6] // Mon-Sat
const PERIODS = [
  { start: '09:00', end: '10:00' },
  { start: '10:00', end: '11:00' },
  { start: '11:15', end: '12:15' },
  { start: '12:15', end: '13:15' },
  { start: '14:00', end: '15:00' },
]

function toMinutes(t) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(aEnd) > toMinutes(bStart)
}

async function main() {
  const [classesRes, subjectsRes, teachersRes, timetableRes] = await Promise.all([
    supabase.from('classes').select('id, name'),
    supabase.from('subjects').select('id, name, class_id, teacher_id, status'),
    supabase.from('teachers').select('id, status'),
    supabase.from('timetable').select('teacher_id, class_id, day_of_week, start_time, end_time'),
  ])

  for (const [label, res] of [
    ['classes', classesRes],
    ['subjects', subjectsRes],
    ['teachers', teachersRes],
    ['timetable', timetableRes],
  ]) {
    if (res.error) {
      console.error(`Failed to load ${label}:`, res.error.message)
      process.exit(1)
    }
  }

  const classes = classesRes.data
  const subjects = subjectsRes.data
  const teacherStatusById = new Map(teachersRes.data.map((t) => [t.id, t.status]))

  // busy[day] -> list of { teacherId, classId, start, end }
  const busy = new Map(DAYS.map((d) => [d, []]))
  for (const s of timetableRes.data) {
    if (!busy.has(s.day_of_week)) busy.set(s.day_of_week, [])
    busy.get(s.day_of_week).push({ teacherId: s.teacher_id, classId: s.class_id, start: s.start_time, end: s.end_time })
  }

  function isFree(day, period, teacherId, classId) {
    const dayBusy = busy.get(day) ?? []
    return !dayBusy.some(
      (b) =>
        overlaps(period.start, period.end, b.start, b.end) &&
        (b.teacherId === teacherId || b.classId === classId)
    )
  }

  const rowsToInsert = []
  let skippedClasses = 0

  for (const cls of classes) {
    const classSubjects = subjects.filter(
      (s) => s.class_id === cls.id && s.status === 'active' && s.teacher_id && teacherStatusById.get(s.teacher_id) !== 'left'
    )
    if (classSubjects.length === 0) {
      console.log(`Skipping "${cls.name}" - no active subjects with an assigned teacher.`)
      skippedClasses++
      continue
    }

    let placed = 0
    for (const [dayIdx, day] of DAYS.entries()) {
      const alreadyHasClassSlotToday = (busy.get(day) ?? []).some((b) => b.classId === cls.id)
      if (alreadyHasClassSlotToday) continue

      // Round-robin through subjects so the same subject doesn't always land on Monday.
      let inserted = false
      for (let i = 0; i < classSubjects.length; i++) {
        const subject = classSubjects[(dayIdx + i) % classSubjects.length]
        const period = PERIODS.find((p) => isFree(day, p, subject.teacher_id, cls.id))
        if (!period) continue
        busy.get(day).push({ teacherId: subject.teacher_id, classId: cls.id, start: period.start, end: period.end })
        rowsToInsert.push({
          teacher_id: subject.teacher_id,
          class_id: cls.id,
          subject_id: subject.id,
          day_of_week: day,
          start_time: period.start,
          end_time: period.end,
        })
        placed++
        inserted = true
        break
      }
      if (!inserted) {
        console.log(`  No free slot on day ${day} for "${cls.name}", skipping that day.`)
      }
    }
    console.log(`"${cls.name}": placed ${placed} slot(s).`)
  }

  if (rowsToInsert.length === 0) {
    console.log('Nothing to insert.')
    return
  }

  const { error } = await supabase.from('timetable').insert(rowsToInsert)
  if (error) {
    console.error('Insert failed:', error.message)
    process.exit(1)
  }
  console.log(`\nInserted ${rowsToInsert.length} dummy timetable slot(s) across ${classes.length - skippedClasses} class(es).`)
}

main()

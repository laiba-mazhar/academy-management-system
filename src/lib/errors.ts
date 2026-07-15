const CONSTRAINT_MESSAGES: Record<string, string> = {
  classes_name_key: 'A class with this name already exists.',
  subjects_name_class_id_key: 'This subject already exists for that class.',
  invoices_student_id_month_key: 'An invoice already exists for this student for that month.',
  salaries_teacher_id_month_key: 'A salary record already exists for this teacher for that month.',
  attendance_student_id_date_key: 'Attendance for this student on this date was already recorded.',
  exam_results_exam_id_student_id_key: 'Marks for this student on this exam were already recorded.',
}

export function friendlyError(message: string): string {
  for (const [constraint, friendly] of Object.entries(CONSTRAINT_MESSAGES)) {
    if (message.includes(constraint)) return friendly
  }
  if (message.includes('row-level security')) {
    return "You don't have permission to change this — it may have been marked or entered by someone else."
  }
  return message
}

// supabase-js's functions.invoke() only gives a generic "Edge Function
// returned a non-2xx status code" on failure — the function's actual JSON
// error body (e.g. what Resend/Postgres actually rejected) is on
// `error.context`, a Response that has to be read separately.
export async function edgeFunctionError(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context
  if (context && typeof (context as Response).json === 'function') {
    try {
      const body = await (context as Response).clone().json()
      if (body?.error) return body.error as string
    } catch {
      // context wasn't JSON — fall through to the generic message below.
    }
  }
  return (error as Error)?.message ?? fallback
}

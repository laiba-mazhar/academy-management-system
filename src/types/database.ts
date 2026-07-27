// Insert shape for a table: every column stays required except the ones
// listed in `Optional` (columns with a DB default, nullable columns, or
// auto-generated ids/timestamps) — catches insert calls missing a genuinely
// required column at compile time instead of only at the Postgres roundtrip.
type InsertOf<Row, Optional extends keyof Row> = Omit<Row, Optional> & Partial<Pick<Row, Optional>>

export type UserRole = 'admin' | 'teacher'
export type EnrollmentStatus = 'enrolled' | 'inactive' | 'graduated' | 'left'
export type TeacherStatus = 'active' | 'left'
export type SubjectStatus = 'active' | 'pending_approval'
export type InvoiceStatus = 'unpaid' | 'paid' | 'overdue'
export type AttendanceStatus = 'present' | 'absent' | 'late'
export type SalaryStatus = 'pending' | 'paid'

export interface Profile {
  id: string
  role: UserRole
  full_name: string
  email: string
  phone: string | null
  must_reset_password: boolean
  created_at: string
}

export interface Teacher {
  id: string
  monthly_salary: number
  status: TeacherStatus
  created_at: string
}

export interface Class {
  id: string
  name: string
  fee_amount: number
  category: string | null
  created_at: string
}

export interface Subject {
  id: string
  name: string
  class_id: string
  teacher_id: string | null
  status: SubjectStatus
  requested_by: string | null
  created_at: string
}

export interface Student {
  id: string
  full_name: string
  class_id: string | null
  contact_phone: string | null
  guardian_name: string | null
  guardian_phone: string | null
  guardian_email: string | null
  enrollment_status: EnrollmentStatus
  fee_override: number | null
  admission_fee_amount: number
  admission_fee_paid: boolean
  security_fee_amount: number
  security_fee_paid: boolean
  created_at: string
}

export interface Invoice {
  id: string
  student_id: string
  class_id: string
  month: string
  amount: number
  discount: number
  status: InvoiceStatus
  payment_date: string | null
  due_date: string | null
  reminder_sent_at: string | null
  created_at: string
}

export interface Attendance {
  id: string
  student_id: string
  class_id: string
  date: string
  status: AttendanceStatus
  marked_by: string | null
  created_at: string
}

export interface AttendanceSettings {
  id: number
  threshold_percent: number
}

export interface Question {
  id: string
  subject_id: string
  class_id: string
  chapter: string | null
  question_text: string
  marks: number
  created_by: string | null
  created_at: string
}

export interface Exam {
  id: string
  name: string
  subject_id: string
  class_id: string
  exam_date: string
  total_marks: number
  created_by: string | null
  created_at: string
}

export interface ExamQuestion {
  exam_id: string
  question_id: string
}

export interface ExamResult {
  id: string
  exam_id: string
  student_id: string
  marks_obtained: number
  entered_by: string | null
  whatsapp_sent_at: string | null
  created_at: string
  whatsapp_sent_at: string | null
}

export interface Timetable {
  id: string
  teacher_id: string
  class_id: string
  subject_id: string
  day_of_week: number
  start_time: string
  end_time: string
  created_at: string
}

export interface Salary {
  id: string
  teacher_id: string
  month: string
  amount: number
  status: SalaryStatus
  paid_date: string | null
  created_at: string
}

export interface TeacherAttendance {
  id: string
  teacher_id: string
  date: string
  status: AttendanceStatus
  marked_by: string | null
  created_at: string
}

export type PlannerType = 'weekly' | 'biweekly' | 'monthly'

export interface CourseBreakdown {
  id: string
  subject_id: string
  planner_type: PlannerType
  total_chapters: number
  start_date: string
  end_date: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface CourseBreakdownSlot {
  id: string
  course_breakdown_id: string
  slot_number: number
  slot_start: string
  slot_end: string
  chapters: string | null
  is_done: boolean
}

// Minimal Supabase Database type map (hand-maintained; expand as phases add tables/queries)
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: InsertOf<Profile, 'phone' | 'must_reset_password' | 'created_at'>
        Update: Partial<Profile>
        Relationships: []
      }
      teachers: {
        Row: Teacher
        Insert: InsertOf<Teacher, 'monthly_salary' | 'status' | 'created_at'>
        Update: Partial<Teacher>
        Relationships: []
      }
      classes: {
        Row: Class
        Insert: InsertOf<Class, 'id' | 'fee_amount' | 'category' | 'created_at'>
        Update: Partial<Class>
        Relationships: []
      }
      subjects: {
        Row: Subject
        Insert: InsertOf<Subject, 'id' | 'teacher_id' | 'status' | 'requested_by' | 'created_at'>
        Update: Partial<Subject>
        Relationships: []
      }
      students: {
        Row: Student
        Insert: InsertOf<
          Student,
          | 'id'
          | 'class_id'
          | 'contact_phone'
          | 'guardian_name'
          | 'guardian_phone'
          | 'guardian_email'
          | 'enrollment_status'
          | 'fee_override'
          | 'admission_fee_amount'
          | 'admission_fee_paid'
          | 'security_fee_amount'
          | 'security_fee_paid'
          | 'created_at'
        >
        Update: Partial<Student>
        Relationships: []
      }
      invoices: {
        Row: Invoice
        Insert: InsertOf<
          Invoice,
          'id' | 'discount' | 'status' | 'payment_date' | 'due_date' | 'reminder_sent_at' | 'created_at'
        >
        Update: Partial<Invoice>
        Relationships: []
      }
      attendance: {
        Row: Attendance
        Insert: InsertOf<Attendance, 'id' | 'marked_by' | 'created_at'>
        Update: Partial<Attendance>
        Relationships: []
      }
      attendance_settings: {
        Row: AttendanceSettings
        Insert: InsertOf<AttendanceSettings, 'id' | 'threshold_percent'>
        Update: Partial<AttendanceSettings>
        Relationships: []
      }
      questions: {
        Row: Question
        Insert: InsertOf<Question, 'id' | 'chapter' | 'created_by' | 'created_at'>
        Update: Partial<Question>
        Relationships: []
      }
      exams: {
        Row: Exam
        Insert: InsertOf<Exam, 'id' | 'created_by' | 'created_at'>
        Update: Partial<Exam>
        Relationships: []
      }
      exam_questions: {
        Row: ExamQuestion
        Insert: ExamQuestion
        Update: Partial<ExamQuestion>
        Relationships: []
      }
      exam_results: {
        Row: ExamResult
        Insert: InsertOf<ExamResult, 'id' | 'entered_by' | 'whatsapp_sent_at' | 'created_at'>
        Update: Partial<ExamResult>
        Relationships: []
      }
      timetable: {
        Row: Timetable
        Insert: InsertOf<Timetable, 'id' | 'created_at'>
        Update: Partial<Timetable>
        Relationships: []
      }
      salaries: {
        Row: Salary
        Insert: InsertOf<Salary, 'id' | 'status' | 'paid_date' | 'created_at'>
        Update: Partial<Salary>
        Relationships: []
      }
      teacher_attendance: {
        Row: TeacherAttendance
        Insert: InsertOf<TeacherAttendance, 'id' | 'marked_by' | 'created_at'>
        Update: Partial<TeacherAttendance>
        Relationships: []
      }
      course_breakdowns: {
        Row: CourseBreakdown
        Insert: InsertOf<CourseBreakdown, 'id' | 'created_by' | 'created_at' | 'updated_at'>
        Update: Partial<CourseBreakdown>
        Relationships: []
      }
      course_breakdown_slots: {
        Row: CourseBreakdownSlot
        Insert: InsertOf<CourseBreakdownSlot, 'id' | 'chapters' | 'is_done'>
        Update: Partial<CourseBreakdownSlot>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

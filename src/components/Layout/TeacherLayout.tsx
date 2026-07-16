import { Outlet } from 'react-router-dom'
import { Sidebar, type NavItem } from './Sidebar'
import { TopBar } from './TopBar'

const navItems: NavItem[] = [
  { label: 'Dashboard', to: '/teacher', end: true },
  { label: 'My Students', to: '/teacher/students' },
  { label: 'Timetable', to: '/teacher/timetable' },
  { label: 'Attendance', to: '/teacher/attendance' },
  { label: 'Question Bank', to: '/teacher/questions' },
  { label: 'Exams & Results', to: '/teacher/exams' },
  { label: 'Course Breakdown', to: '/teacher/course-breakdown' },
]

export function TeacherLayout() {
  return (
    <div className="flex min-h-screen">
      <Sidebar title="Teacher" items={navItems} />
      <div className="flex flex-1 flex-col">
        <TopBar />
        <main className="flex-1 bg-cream-50 p-6 dark:bg-slate-900">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

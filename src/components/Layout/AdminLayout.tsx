import { Outlet } from 'react-router-dom'
import { Sidebar, type NavItem } from './Sidebar'
import { TopBar } from './TopBar'

const navItems: NavItem[] = [
  { label: 'Dashboard', to: '/admin', end: true },
  { label: 'Students', to: '/admin/students' },
  { label: 'Teachers', to: '/admin/teachers' },
  { label: 'Classes & Subjects', to: '/admin/classes' },
  { label: 'Timetable', to: '/admin/timetable' },
  { label: 'Attendance', to: '/admin/attendance' },
  { label: 'Fees', to: '/admin/fees' },
  { label: 'Fee Challans', to: '/admin/fee-challans' },
  { label: 'Salaries', to: '/admin/salaries' },
  { label: 'Course Breakdown', to: '/admin/course-breakdown' },
]

export function AdminLayout() {
  return (
    <div className="flex min-h-screen">
      <Sidebar title="Admin" items={navItems} />
      <div className="flex flex-1 flex-col">
        <TopBar />
        <main className="flex-1 bg-cream-50 p-6 dark:bg-slate-900">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

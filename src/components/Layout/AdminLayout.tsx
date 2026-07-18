import { useEffect, useState } from 'react'
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
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // The mobile drawer overlays the page — lock background scroll while it's open.
  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [sidebarOpen])

  return (
    <div className="flex min-h-dvh">
      <Sidebar title="Admin" items={navItems} isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-x-hidden bg-cream-50 p-4 dark:bg-slate-900 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

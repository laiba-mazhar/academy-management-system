import { useEffect, useState } from 'react'
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
  { label: 'Settings', to: '/teacher/settings' },
]

export function TeacherLayout() {
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
      <Sidebar title="Teacher" items={navItems} isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-x-hidden bg-cream-50 p-4 dark:bg-slate-900 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

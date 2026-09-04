import { useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useApp } from '@/context/AppContext'
import { cn } from '@/lib/utils'
import ThemeToggle from '@/theme/ThemeToggle'
import {
    PlusCircle, FolderOpen, ChevronLeft, LogOut, User,
} from 'lucide-react'

const clientNav = [
    { to: '/client', icon: FolderOpen, label: 'Agreements', end: true },
    { to: '/client/create', icon: PlusCircle, label: 'Author Criteria' },
]

const freelancerNav = [
    { to: '/freelancer', icon: FolderOpen, label: 'Agreements', end: true },
]

export default function Sidebar() {
    const [collapsed, setCollapsed] = useState(false)
    const { state: authState, logout } = useAuth()
    const { state: appState } = useApp()
    const navigate = useNavigate()
    const location = useLocation()

    const isFreelancer = appState.role === 'freelancer' || location.pathname.startsWith('/freelancer')
    const navItems = isFreelancer ? freelancerNav : clientNav
    const roleLabel = isFreelancer ? 'Freelancer' : 'Client'

    const handleLogout = async () => {
        await logout()
        navigate('/auth')
    }

    return (
        <aside
            className={cn(
                'fixed left-0 top-0 bottom-0 z-40 sidebar-surface flex flex-col transition-all duration-300',
                collapsed ? 'w-16' : 'w-[260px]',
            )}
        >
            {/* Logo */}
            <div className="h-16 flex items-center px-5 border-b border-border">
                <NavLink to="/" className="font-display font-bold text-lg tracking-tight text-text-heading">
                    {collapsed ? <span className="text-accent">V</span> : <><span className="text-accent">V</span>eylo</>}
                </NavLink>
            </div>

            {/* Navigation */}
            <nav className="flex-1 py-4 space-y-0.5 px-3">
                {navItems.map((item) => (
                    <NavLink
                        key={item.to + item.label}
                        to={item.to}
                        end={item.end}
                        className={({ isActive }) =>
                            cn(
                                'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all',
                                isActive
                                    ? 'bg-bg-elevated text-text-heading border-l-2 border-accent'
                                    : 'text-text-muted hover:text-text hover:bg-bg-subtle',
                                collapsed && 'justify-center px-2',
                            )
                        }
                    >
                        <item.icon className="w-[18px] h-[18px] flex-shrink-0" />
                        {!collapsed && <span className="font-body">{item.label}</span>}
                    </NavLink>
                ))}
            </nav>

            {/* Bottom section — theme toggle + user info */}
            <div className="p-4 border-t border-border space-y-3">
                <div className={cn('flex items-center', collapsed ? 'justify-center' : 'justify-start')}>
                    <ThemeToggle />
                </div>
                {authState.user && !collapsed && (
                    <div className="space-y-1.5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-accent-bg text-accent border border-accent-border uppercase tracking-wider font-body">
                            {roleLabel}
                        </span>
                        <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-accent-bg flex items-center justify-center">
                                <User className="w-3 h-3 text-accent" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-xs text-text-heading font-body truncate">{authState.user.name || authState.user.email}</p>
                                <p className="text-[10px] text-text-muted font-body truncate">{authState.user.email}</p>
                            </div>
                        </div>
                    </div>
                )}
                {!collapsed && (
                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-2 text-xs text-text-muted hover:text-text transition-colors font-body"
                    >
                        <LogOut className="w-3.5 h-3.5" />
                        Sign Out
                    </button>
                )}
                <button
                    onClick={() => setCollapsed(!collapsed)}
                    className="flex items-center justify-center w-full text-text-muted hover:text-text transition-colors"
                >
                    <ChevronLeft className={cn('w-4 h-4 transition-transform', collapsed && 'rotate-180')} />
                </button>
            </div>
        </aside>
    )
}

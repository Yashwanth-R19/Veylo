import { useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useApp } from '@/context/AppContext'
import { cn } from '@/lib/utils'
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

export default function GlassSidebar() {
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
                'fixed left-0 top-0 bottom-0 z-40 glass-sidebar flex flex-col transition-all duration-300',
                collapsed ? 'w-16' : 'w-[260px]',
            )}
        >
            {/* Logo */}
            <div className="h-16 flex items-center px-5 border-b border-white/[0.06]">
                <NavLink to="/" className="font-display font-bold text-lg tracking-tight text-text-primary">
                    {collapsed ? <span className="text-violet-400">V</span> : <><span className="text-violet-400">V</span>eylo</>}
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
                                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                                isActive
                                    ? 'bg-white/[0.06] text-text-primary border-l-2 border-violet-500 ml-0'
                                    : 'text-text-muted hover:text-text-secondary hover:bg-white/[0.03]',
                                collapsed && 'justify-center px-2',
                            )
                        }
                    >
                        <item.icon className="w-[18px] h-[18px] flex-shrink-0" />
                        {!collapsed && <span className="font-body">{item.label}</span>}
                    </NavLink>
                ))}
            </nav>

            {/* Bottom section — User info */}
            <div className="p-4 border-t border-white/[0.06] space-y-3">
                {authState.user && !collapsed && (
                    <div className="space-y-1.5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-violet-500/15 text-violet-400 border border-violet-500/20 uppercase tracking-wider font-body">
                            {roleLabel}
                        </span>
                        <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-violet-500/20 flex items-center justify-center">
                                <User className="w-3 h-3 text-violet-400" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-xs text-text-primary font-body truncate">{authState.user.name || authState.user.email}</p>
                                <p className="text-[10px] text-text-muted font-body truncate">{authState.user.email}</p>
                            </div>
                        </div>
                    </div>
                )}
                {!collapsed && (
                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-2 text-xs text-text-muted hover:text-text-secondary transition-colors font-body"
                    >
                        <LogOut className="w-3.5 h-3.5" />
                        Sign Out
                    </button>
                )}
                <button
                    onClick={() => setCollapsed(!collapsed)}
                    className="flex items-center justify-center w-full text-text-muted hover:text-text-secondary transition-colors"
                >
                    <ChevronLeft className={cn('w-4 h-4 transition-transform', collapsed && 'rotate-180')} />
                </button>
            </div>
        </aside>
    )
}

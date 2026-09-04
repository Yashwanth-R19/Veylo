import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { ArrowRight } from 'lucide-react'
import ThemeToggle from '@/theme/ThemeToggle'

export default function Navbar() {
    const [scrolled, setScrolled] = useState(false)

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 40)
        window.addEventListener('scroll', onScroll, { passive: true })
        return () => window.removeEventListener('scroll', onScroll)
    }, [])

    return (
        <header
            className={cn(
                'fixed top-0 left-0 right-0 z-50 transition-all duration-300',
                scrolled ? 'nav-surface' : 'bg-transparent',
            )}
        >
            <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                <Link to="/" className="font-display font-bold text-xl tracking-tight text-text-heading">
                    <span className="text-accent">V</span>eylo
                </Link>
                <div className="flex items-center gap-3">
                    <ThemeToggle />
                    <Link
                        to="/auth"
                        className="flex items-center gap-2 px-4 py-2 rounded-md bg-accent hover:bg-accent-strong text-accent-contrast text-sm font-medium transition-colors"
                    >
                        Open App <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                </div>
            </div>
        </header>
    )
}

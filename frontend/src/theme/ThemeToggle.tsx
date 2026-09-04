import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/theme/useTheme'
import { cn } from '@/lib/utils'
import ClickSpark from '@/reactbits/ClickSpark'

export default function ThemeToggle({ className }: { className?: string }) {
    const { theme, toggleTheme } = useTheme()

    return (
        <ClickSpark sparkColor="#D47F4C" sparkRadius={12} sparkSize={7} className="inline-block rounded-md">
            <button
                type="button"
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                className={cn(
                    'inline-flex items-center justify-center w-9 h-9 rounded-md border border-border text-text-muted hover:text-text-heading hover:border-border-strong transition-colors',
                    className,
                )}
            >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
        </ClickSpark>
    )
}

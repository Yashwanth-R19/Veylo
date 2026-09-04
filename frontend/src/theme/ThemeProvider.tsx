import { useEffect, useState, type ReactNode } from 'react'
import { ThemeContext, type Theme } from '@/theme/useTheme'

const STORAGE_KEY = 'veylo-theme'

function readStoredTheme(): Theme {
    if (typeof window === 'undefined') return 'dark'
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === 'light' ? 'light' : 'dark'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setTheme] = useState<Theme>(readStoredTheme)

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme)
        window.localStorage.setItem(STORAGE_KEY, theme)
        // index.html sets an inline background-color/color on <body> as a
        // pre-paint flash guard (before this stylesheet loads). Being inline,
        // it outranks the CSS `body { background: var(--color-bg) }` rule by
        // specificity and would otherwise pin the page to dark forever, even
        // after toggling to light. Clear it once React has taken over.
        document.body.style.removeProperty('background-color')
        document.body.style.removeProperty('color')
    }, [theme])

    const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

    return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

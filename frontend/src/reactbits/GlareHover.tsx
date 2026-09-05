import type { ReactNode } from 'react'
import './GlareHover.css'

// Adapted from react-bits (github.com/DavidHDev/react-bits, Animations/GlareHover).
// Upstream renders its own fixed-size box (width/height/background/border); this
// version is sizeless/transparent so it can wrap an existing button or Card
// without fighting that element's own styling — only the glare sweep is added.

interface GlareHoverProps {
    children: ReactNode
    className?: string
    glareColor?: string
    glareOpacity?: number
    glareAngle?: number
    glareSize?: number
    transitionDuration?: number
}

export default function GlareHover({
    children,
    className = '',
    glareColor = '#ffffff',
    glareOpacity = 0.3,
    glareAngle = -45,
    glareSize = 250,
    transitionDuration = 650,
}: GlareHoverProps) {
    const hex = glareColor.replace('#', '')
    let rgba = glareColor
    if (/^[0-9A-Fa-f]{6}$/.test(hex)) {
        const r = parseInt(hex.slice(0, 2), 16)
        const g = parseInt(hex.slice(2, 4), 16)
        const b = parseInt(hex.slice(4, 6), 16)
        rgba = `rgba(${r}, ${g}, ${b}, ${glareOpacity})`
    }

    const vars = {
        '--gh-angle': `${glareAngle}deg`,
        '--gh-duration': `${transitionDuration}ms`,
        '--gh-size': `${glareSize}%`,
        '--gh-rgba': rgba,
    } as React.CSSProperties

    return (
        <div className={`glare-hover ${className}`} style={vars}>
            {children}
        </div>
    )
}

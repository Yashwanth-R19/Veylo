import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google'
import BlurText from '@/components/ui/BlurText'
import { useAuth } from '@/hooks/useAuth'
import { useApp } from '@/context/AppContext'
import { useTheme } from '@/theme/useTheme'
import { cn } from '@/lib/utils'
import { GOOGLE_CLIENT_ID } from '@/lib/constants'
import { Briefcase, Code2, Mail, Lock, User, ArrowRight, ArrowLeft, AlertCircle } from 'lucide-react'

type AuthMode = 'login' | 'register'

export default function Auth() {
    const { state: authState, login, register, loginWithGoogle } = useAuth()
    const { dispatch } = useApp()
    const navigate = useNavigate()
    const { theme } = useTheme()

    const [mode, setMode] = useState<AuthMode>('login')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [name, setName] = useState('')
    const [role, setRole] = useState<'client' | 'freelancer'>('client')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [step, setStep] = useState<'credentials' | 'role'>('credentials')

    // GoogleLogin's width is a fixed pixel value (Google's own API, no
    // percentage support), so it's measured off the card rather than
    // hardcoded to stay visually full-width like every other button here.
    const googleBtnContainerRef = useRef<HTMLDivElement>(null)
    const [googleBtnWidth, setGoogleBtnWidth] = useState(320)
    useEffect(() => {
        const el = googleBtnContainerRef.current
        if (!el) return
        const observer = new ResizeObserver(([entry]) => setGoogleBtnWidth(Math.round(entry.contentRect.width)))
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    // Redirect if already authenticated (in useEffect to avoid setState-during-render)
    useEffect(() => {
        if (authState.isAuthenticated && authState.user) {
            const userRole = authState.user.role || 'client'
            navigate(userRole === 'freelancer' ? '/freelancer' : '/client', { replace: true })
        }
    }, [authState.isAuthenticated, authState.user, navigate])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setLoading(true)

        if (mode === 'login') {
            const result = await login(email, password)
            if (result.success) {
                // Auth context will have the user, redirect based on role
                const savedRole = localStorage.getItem('veylo_role')
                dispatch({ type: 'SET_ROLE', role: (savedRole as 'client' | 'freelancer') || 'client' })
                navigate(savedRole === 'freelancer' ? '/freelancer' : '/client')
            } else {
                setError(result.error || 'Login failed')
            }
        } else {
            // Register mode — go to role selection first
            if (step === 'credentials') {
                if (!email || !password) {
                    setError('Email and password are required')
                    setLoading(false)
                    return
                }
                if (password.length < 6) {
                    setError('Password must be at least 6 characters')
                    setLoading(false)
                    return
                }
                setStep('role')
                setLoading(false)
                return
            }

            // Step 2: Complete registration with role
            const result = await register(email, password, name || email.split('@')[0], role)
            if (result.success) {
                dispatch({ type: 'SET_ROLE', role })
                navigate(role === 'freelancer' ? '/freelancer' : '/client')
            } else {
                setError(result.error || 'Registration failed')
            }
        }
        setLoading(false)
    }

    const handleGoogleSuccess = async (credentialResponse: CredentialResponse) => {
        setError('')
        if (!credentialResponse.credential) {
            setError('Google did not return a credential')
            return
        }
        setLoading(true)
        const result = await loginWithGoogle(credentialResponse.credential)
        if (result.success) {
            const savedRole = localStorage.getItem('veylo_role')
            dispatch({ type: 'SET_ROLE', role: (savedRole as 'client' | 'freelancer') || 'client' })
            navigate(savedRole === 'freelancer' ? '/freelancer' : '/client')
        } else {
            setError(result.error || 'Google sign-in failed')
        }
        setLoading(false)
    }

    const handleGoogleError = () => setError('Google sign-in failed or was cancelled')

    return (
        <div className="relative min-h-screen bg-bg flex items-center justify-center overflow-hidden">
            <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
                className="relative z-10 w-full max-w-md px-6"
            >
                {/* Logo */}
                <div className="text-center mb-8">
                    <h1 className="font-display font-semibold text-3xl text-text-heading mb-3">
                        <span className="text-accent">V</span>eylo
                    </h1>
                    <p className="text-text font-body text-base">
                        <BlurText text={mode === 'login' ? 'Sign in to your account' : 'Create your account'} stagger={0.03} />
                    </p>
                </div>

                {/* Auth card */}
                <div className="surface-elevated p-7 mb-6">
                    <AnimatePresence mode="wait">
                        {step === 'credentials' ? (
                            <motion.form
                                key="credentials"
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                transition={{ duration: 0.3 }}
                                onSubmit={handleSubmit}
                                className="space-y-4"
                            >
                                {/* Mode tabs */}
                                <div className="flex rounded-md overflow-hidden border border-border mb-2">
                                    {(['login', 'register'] as const).map((m) => (
                                        <button
                                            key={m}
                                            type="button"
                                            onClick={() => { setMode(m); setError('') }}
                                            className={cn(
                                                'flex-1 py-2 text-sm font-medium transition-all',
                                                mode === m ? 'bg-accent text-accent-contrast' : 'text-text-muted hover:text-text hover:bg-bg-subtle'
                                            )}
                                        >
                                            {m === 'login' ? 'Sign In' : 'Sign Up'}
                                        </button>
                                    ))}
                                </div>

                                {/* Name (register only) */}
                                {mode === 'register' && (
                                    <div className="relative">
                                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                                        <input
                                            type="text"
                                            placeholder="Full name"
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            className="input-field w-full pl-10"
                                        />
                                    </div>
                                )}

                                {/* Email */}
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                                    <input
                                        type="email"
                                        placeholder="Email address"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                        className="input-field w-full pl-10"
                                    />
                                </div>

                                {/* Password */}
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                                    <input
                                        type="password"
                                        placeholder={mode === 'register' ? 'Create password (6+ chars)' : 'Password'}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        className="input-field w-full pl-10"
                                    />
                                </div>

                                {/* Error */}
                                {error && (
                                    <div className="flex items-center gap-2 p-3 rounded-md bg-danger-bg border border-danger/30">
                                        <AlertCircle className="w-4 h-4 text-danger flex-shrink-0" />
                                        <p className="text-xs text-danger font-body">{error}</p>
                                    </div>
                                )}

                                {/* Submit */}
                                <button
                                    type="submit"
                                    disabled={loading || authState.isLoading}
                                    className="w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-md bg-accent hover:bg-accent-strong disabled:opacity-50 text-accent-contrast font-medium transition-colors"
                                >
                                    {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Continue'}
                                    <ArrowRight className="w-4 h-4" />
                                </button>

                                {/* Divider */}
                                <div className="relative my-4">
                                    <div className="absolute inset-0 flex items-center">
                                        <div className="w-full border-t border-border" />
                                    </div>
                                    <div className="relative flex justify-center text-xs">
                                        <span className="px-3 bg-bg-elevated text-text-muted font-body">or</span>
                                    </div>
                                </div>

                                {/* Google sign-in — real Google Identity Services button. Its
                                    width is Google's own pixel-based API (no percentage support),
                                    so it's measured off this wrapper to stay visually full-width. */}
                                <div ref={googleBtnContainerRef} className="w-full flex justify-center">
                                    {GOOGLE_CLIENT_ID ? (
                                        <GoogleLogin
                                            onSuccess={handleGoogleSuccess}
                                            onError={handleGoogleError}
                                            theme={theme === 'dark' ? 'filled_black' : 'outline'}
                                            shape="rectangular"
                                            size="large"
                                            width={googleBtnWidth || undefined}
                                        />
                                    ) : (
                                        <p className="text-xs text-text-muted font-body text-center py-2.5">
                                            Google sign-in isn't configured on this deployment yet.
                                        </p>
                                    )}
                                </div>
                            </motion.form>
                        ) : (
                            <motion.div
                                key="role-selection"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                transition={{ duration: 0.3 }}
                                className="space-y-4"
                            >
                                <h2 className="font-display font-semibold text-base text-text-heading text-center">Choose your role</h2>
                                <p className="text-xs text-text-muted text-center font-body">You can change this later</p>

                                <div className="grid grid-cols-2 gap-3">
                                    {[
                                        { value: 'client' as const, icon: Briefcase, title: "I'm Hiring", desc: 'Post jobs, define requirements' },
                                        { value: 'freelancer' as const, icon: Code2, title: "I'm Building", desc: 'Browse jobs, submit work' },
                                    ].map((r) => (
                                        <button
                                            key={r.value}
                                            type="button"
                                            onClick={() => setRole(r.value)}
                                            className={cn(
                                                'p-4 rounded-md text-left transition-all border',
                                                role === r.value
                                                    ? 'border-accent-border bg-accent-bg'
                                                    : 'border-border bg-bg-subtle hover:bg-bg-elevated'
                                            )}
                                        >
                                            <r.icon className={cn('w-5 h-5 mb-2', role === r.value ? 'text-accent' : 'text-text-muted')} />
                                            <h3 className="font-display font-semibold text-sm text-text-heading mb-0.5">{r.title}</h3>
                                            <p className="text-[11px] text-text-muted font-body">{r.desc}</p>
                                        </button>
                                    ))}
                                </div>

                                {error && (
                                    <div className="flex items-center gap-2 p-3 rounded-md bg-danger-bg border border-danger/30">
                                        <AlertCircle className="w-4 h-4 text-danger flex-shrink-0" />
                                        <p className="text-xs text-danger font-body">{error}</p>
                                    </div>
                                )}

                                <div className="flex gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setStep('credentials')}
                                        className="px-4 py-2.5 rounded-md border border-border text-text text-sm font-medium hover:bg-bg-subtle transition-colors"
                                    >
                                        <ArrowLeft className="w-4 h-4 inline mr-1" /> Back
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleSubmit({ preventDefault: () => { } } as React.FormEvent)}
                                        disabled={loading}
                                        className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-md bg-accent hover:bg-accent-strong disabled:opacity-50 text-accent-contrast font-medium transition-colors"
                                    >
                                        {loading ? 'Creating account...' : 'Create Account'}
                                        <ArrowRight className="w-4 h-4" />
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>
        </div>
    )
}

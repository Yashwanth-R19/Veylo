import { createContext, useContext, useReducer, useEffect, useCallback } from 'react'
import type { User, UserRole } from '@/types'
import { authMe, authLogin, authRegister, authLogout, authGoogle } from '@/lib/api'

// ── State & Actions ───────────────────────────
interface AuthState {
    user: User | null
    isLoading: boolean
    isAuthenticated: boolean
}

type AuthAction =
    | { type: 'LOADING' }
    | { type: 'AUTHENTICATED'; user: User }
    | { type: 'UNAUTHENTICATED' }
    | { type: 'UPDATE_ROLE'; role: UserRole }

const initialState: AuthState = {
    user: null,
    isLoading: true,
    isAuthenticated: false,
}

function reducer(state: AuthState, action: AuthAction): AuthState {
    switch (action.type) {
        case 'LOADING':
            return { ...state, isLoading: true }
        case 'AUTHENTICATED':
            return { user: action.user, isLoading: false, isAuthenticated: true }
        case 'UNAUTHENTICATED':
            return { user: null, isLoading: false, isAuthenticated: false }
        case 'UPDATE_ROLE':
            if (!state.user) return state
            return { ...state, user: { ...state.user, role: action.role } }
        default:
            return state
    }
}

// ── Context ───────────────────────────────────
interface AuthContextValue {
    state: AuthState
    login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
    register: (email: string, password: string, name: string, role: UserRole) => Promise<{ success: boolean; error?: string }>
    loginWithGoogle: (idToken: string) => Promise<{ success: boolean; error?: string }>
    logout: () => Promise<void>
    updateRole: (role: UserRole) => void
}

const AuthContext = createContext<AuthContextValue>({
    state: initialState,
    login: async () => ({ success: false }),
    register: async () => ({ success: false }),
    loginWithGoogle: async () => ({ success: false }),
    logout: async () => { },
    updateRole: () => { },
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [state, dispatch] = useReducer(reducer, initialState)

    // Check session on mount
    useEffect(() => {
        checkSession()
    }, [])

    const checkSession = useCallback(async () => {
        try {
            const user = await authMe()
            if (user && user.id) {
                dispatch({ type: 'AUTHENTICATED', user })
                // Persist role in localStorage for AppContext compatibility
                if (user.role) localStorage.setItem('veylo_role', user.role)
            } else {
                dispatch({ type: 'UNAUTHENTICATED' })
            }
        } catch {
            dispatch({ type: 'UNAUTHENTICATED' })
        }
    }, [])

    const login = useCallback(async (email: string, password: string) => {
        dispatch({ type: 'LOADING' })
        try {
            const result = await authLogin(email, password)
            if (result.user) {
                dispatch({ type: 'AUTHENTICATED', user: result.user })
                if (result.user.role) localStorage.setItem('veylo_role', result.user.role)
                return { success: true }
            }
            dispatch({ type: 'UNAUTHENTICATED' })
            return { success: false, error: 'Login failed' }
        } catch (err) {
            dispatch({ type: 'UNAUTHENTICATED' })
            return { success: false, error: err instanceof Error ? err.message : 'Login failed' }
        }
    }, [])

    const register = useCallback(async (email: string, password: string, name: string, role: UserRole) => {
        dispatch({ type: 'LOADING' })
        try {
            const result = await authRegister(email, password, name, role || 'client')
            if (result.user) {
                dispatch({ type: 'AUTHENTICATED', user: result.user })
                if (result.user.role) localStorage.setItem('veylo_role', result.user.role)
                return { success: true }
            }
            dispatch({ type: 'UNAUTHENTICATED' })
            return { success: false, error: 'Registration failed' }
        } catch (err) {
            dispatch({ type: 'UNAUTHENTICATED' })
            return { success: false, error: err instanceof Error ? err.message : 'Registration failed' }
        }
    }, [])

    const loginWithGoogle = useCallback(async (idToken: string) => {
        dispatch({ type: 'LOADING' })
        try {
            const result = await authGoogle(idToken)
            if (result.user) {
                dispatch({ type: 'AUTHENTICATED', user: result.user })
                if (result.user.role) localStorage.setItem('veylo_role', result.user.role)
                return { success: true }
            }
            dispatch({ type: 'UNAUTHENTICATED' })
            return { success: false, error: 'Google login failed' }
        } catch (err) {
            dispatch({ type: 'UNAUTHENTICATED' })
            return { success: false, error: err instanceof Error ? err.message : 'Google login failed' }
        }
    }, [])

    const logout = useCallback(async () => {
        await authLogout()
        localStorage.removeItem('veylo_role')
        dispatch({ type: 'UNAUTHENTICATED' })
    }, [])

    const updateRole = useCallback((role: UserRole) => {
        dispatch({ type: 'UPDATE_ROLE', role })
        if (role) localStorage.setItem('veylo_role', role)
    }, [])

    return (
        <AuthContext.Provider value={{ state, login, register, loginWithGoogle, logout, updateRole }}>
            {children}
        </AuthContext.Provider>
    )
}

export function useAuthContext() {
    return useContext(AuthContext)
}

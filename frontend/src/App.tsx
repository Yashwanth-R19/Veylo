import { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Outlet, useLocation, Navigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AppProvider } from '@/context/AppContext'
import { AuthProvider } from '@/context/AuthContext'
import { useAuth } from '@/hooks/useAuth'
import Sidebar from '@/components/shared/Sidebar'

// Lazy-load all pages
const Landing = lazy(() => import('@/pages/Landing'))
const Auth = lazy(() => import('@/pages/Auth'))
const ClientDashboard = lazy(() => import('@/pages/client/Dashboard'))
const AuthorCriteria = lazy(() => import('@/pages/client/AuthorCriteria'))
const FreelancerDashboard = lazy(() => import('@/pages/freelancer/Dashboard'))
const AgreementDetail = lazy(() => import('@/pages/agreements/AgreementDetail'))
const AcceptAgreement = lazy(() => import('@/pages/agreements/AcceptAgreement'))

/** Protected route — redirects to /auth if not logged in */
function ProtectedRoute() {
  const { state } = useAuth()

  if (state.isLoading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="w-8 h-8 spinner" />
      </div>
    )
  }

  if (!state.isAuthenticated) {
    return <Navigate to="/auth" replace />
  }

  return <Outlet />
}

function DashboardLayout() {
  const location = useLocation()

  return (
    <div className="min-h-screen bg-bg">
      <Sidebar />
      <main className="relative z-10 ml-[260px] px-4 py-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}

const loadingFallback = (
  <div className="min-h-screen bg-bg flex items-center justify-center">
    <div className="w-8 h-8 spinner" />
  </div>
)

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppProvider>
          <Suspense fallback={loadingFallback}>
            <Routes>
              {/* Public */}
              <Route path="/" element={<Landing />} />
              <Route path="/auth" element={<Auth />} />

              {/* Protected — Client */}
              <Route element={<ProtectedRoute />}>
                <Route element={<DashboardLayout />}>
                  <Route path="/client" element={<ClientDashboard />} />
                  <Route path="/client/create" element={<AuthorCriteria />} />
                  <Route path="/client/agreement/:id" element={<AgreementDetail />} />
                </Route>
              </Route>

              {/* Protected — Freelancer (worker) */}
              <Route element={<ProtectedRoute />}>
                <Route element={<DashboardLayout />}>
                  <Route path="/freelancer" element={<FreelancerDashboard />} />
                  <Route path="/freelancer/agreement/:id" element={<AgreementDetail />} />
                </Route>
              </Route>

              {/* Signing is identity-by-wallet-signature, not app role, so it
                  lives outside the /client and /freelancer prefixes. Still
                  behind login so a stranger can't spend the app's session,
                  but reachable by either role. */}
              <Route element={<ProtectedRoute />}>
                <Route element={<DashboardLayout />}>
                  <Route path="/agreements/:id/accept" element={<AcceptAgreement />} />
                </Route>
              </Route>
            </Routes>
          </Suspense>
        </AppProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

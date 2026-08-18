import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import GlassCard from '@/components/shared/GlassCard'
import StatusBadge from '@/components/shared/StatusBadge'
import DeadlineCountdown from '@/components/shared/DeadlineCountdown'
import EmptyState from '@/components/shared/EmptyState'
import AnimatedList from '@/components/ui/AnimatedList'
import CountUp from '@/components/ui/CountUp'
import { getJobs } from '@/lib/api'
import type { Job } from '@/types'
import { PlusCircle, Briefcase, Coins, BarChart3, Shield, FolderOpen } from 'lucide-react'

const container = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } }
const item = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] } } }

export default function ClientDashboard() {
    const [jobs, setJobs] = useState<Job[]>([])
    const navigate = useNavigate()

    useEffect(() => { getJobs().then(setJobs) }, [])

    const activeJobs = jobs.filter(j => j.state !== 'CLOSED')
    const totalEscrowed = 170000
    const avgScore = jobs.filter(j => j.validationReport).reduce((acc, j) => acc + (j.validationReport?.overallScore || 0), 0) / Math.max(jobs.filter(j => j.validationReport).length, 1)

    const stats = [
        { icon: Briefcase, label: 'Active Jobs', value: activeJobs.length, suffix: '' },
        { icon: Coins, label: 'Total Committed', value: totalEscrowed, prefix: '₹', decimals: 0 },
        { icon: BarChart3, label: 'Avg Score', value: avgScore, suffix: '%', decimals: 1 },
        { icon: Shield, label: 'Reputation', value: 79, suffix: '' },
    ]

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="font-display font-bold text-2xl text-text-primary">Dashboard</h1>
                    <p className="text-sm text-text-muted font-body mt-1">Overview of your client activity</p>
                </div>
                <button
                    onClick={() => navigate('/client/create')}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors"
                >
                    <PlusCircle className="w-4 h-4" /> Create New Job
                </button>
            </div>

            {/* Stats */}
            <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-4 gap-4 mb-8">
                {stats.map((s) => (
                    <motion.div key={s.label} variants={item}>
                        <GlassCard className="p-5">
                            <div className="flex items-center gap-2 mb-2">
                                <s.icon className="w-4 h-4 text-text-muted" />
                                <span className="text-xs text-text-muted font-body">{s.label}</span>
                            </div>
                            <p className="text-2xl font-bold font-mono text-text-primary">
                                <CountUp end={s.value} decimals={s.decimals || 0} suffix={s.suffix} />
                            </p>
                        </GlassCard>
                    </motion.div>
                ))}
            </motion.div>

            <div className="grid grid-cols-3 gap-6">
                {/* Jobs list */}
                <div className="col-span-2">
                    <h2 className="font-display font-semibold text-base text-text-primary mb-4">Recent Jobs</h2>
                    {jobs.length === 0 ? (
                        <EmptyState icon={FolderOpen} title="No jobs yet" description="Create your first job to get started." action={{ label: 'Create Job', onClick: () => navigate('/client/create') }} />
                    ) : (
                        <GlassCard className="divide-y divide-white/[0.06]">
                            <AnimatedList stagger={0.05}>
                                {jobs.map((job) => (
                                    <button
                                        key={job.id}
                                        onClick={() => navigate(`/client/job/${job.id}`)}
                                        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors text-left"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-medium text-text-primary truncate">{job.description.slice(0, 60)}...</p>
                                            <p className="text-xs text-text-muted font-body mt-0.5">
                                                {job.freelancerAddress ? `${job.freelancerAddress.slice(0, 10)}...` : 'Awaiting freelancer'}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-4 ml-4">
                                            <DeadlineCountdown deadline={job.deadline} />
                                            <StatusBadge status={job.state} />
                                        </div>
                                    </button>
                                ))}
                            </AnimatedList>
                        </GlassCard>
                    )}
                </div>

                {/* Activity feed — no activity endpoint exists yet; show that
                    honestly rather than a fabricated feed (see Phase 5 for
                    the real implementation). */}
                <div>
                    <h2 className="font-display font-semibold text-base text-text-primary mb-4">Activity</h2>
                    <GlassCard className="p-4">
                        <p className="text-xs text-text-muted font-body py-2">Activity feed not available yet.</p>
                    </GlassCard>
                </div>
            </div>
        </div>
    )
}

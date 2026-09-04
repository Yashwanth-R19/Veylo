import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { PipelineStage } from '@/types'
import { Check, X } from 'lucide-react'

interface PipelineStageRowProps {
    stage: PipelineStage
    isActive: boolean
    isLast: boolean
    index: number
}

export default function PipelineStageRow({ stage, isActive, isLast, index }: PipelineStageRowProps) {
    return (
        <motion.div
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.04, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="flex gap-4"
            style={{ willChange: 'transform' }}
        >
            {/* Status indicator column */}
            <div className="flex flex-col items-center">
                <div
                    className={cn(
                        'w-9 h-9 rounded-full flex items-center justify-center border transition-all duration-500',
                        stage.status === 'complete' && 'bg-emerald-500/20 border-emerald-500/40',
                        stage.status === 'running' && 'bg-violet-500/20 border-violet-500/40',
                        stage.status === 'failed' && 'bg-red-500/20 border-red-500/40',
                        stage.status === 'pending' && 'bg-white/5 border-white/10',
                    )}
                >
                    {stage.status === 'complete' && (
                        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 25 }}>
                            <Check className="w-4 h-4 text-emerald-400" />
                        </motion.div>
                    )}
                    {stage.status === 'running' && (
                        <div className="w-4 h-4 spinner" />
                    )}
                    {stage.status === 'failed' && (
                        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                            <X className="w-4 h-4 text-red-400" />
                        </motion.div>
                    )}
                    {stage.status === 'pending' && (
                        <div className="w-2.5 h-2.5 rounded-full bg-white/20 pulse-dot" />
                    )}
                </div>
                {!isLast && (
                    <div className={cn(
                        'w-0.5 flex-1 min-h-[28px] transition-colors duration-500',
                        stage.status === 'complete' ? 'bg-emerald-500/30' : 'bg-white/[0.07]',
                    )} />
                )}
            </div>

            {/* Content */}
            <div className={cn('pb-5 flex-1', isLast && 'pb-0')}>
                <div className="flex items-center gap-3 mb-1">
                    <h4 className={cn(
                        'font-display font-semibold text-sm transition-colors duration-300',
                        isActive || stage.status === 'complete' ? 'text-text-primary' : 'text-text-muted',
                    )}>
                        {stage.name}
                    </h4>
                </div>
                <p className="text-xs text-text-muted font-body">
                    {stage.status === 'complete' && stage.details ? stage.details : stage.description}
                </p>
                {stage.status === 'running' && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="mt-2 h-1 rounded-full bg-white/5 overflow-hidden w-48"
                    >
                        <motion.div
                            className="h-full bg-violet-500/60 rounded-full"
                            initial={{ width: '0%' }}
                            animate={{ width: '70%' }}
                            transition={{ duration: 1.5, ease: 'easeInOut' }}
                        />
                    </motion.div>
                )}
            </div>
        </motion.div>
    )
}

import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { PipelineStage } from '@/types'
import { Check, X } from 'lucide-react'

interface PipelineStageRowProps {
    stage: PipelineStage
    isActive: boolean
    isLast: boolean
    index: number
}

/**
 * The agreement's state-machine trail — this is Veylo's one deliberate
 * "wow moment" (the equivalent of a hero visualization), since the state
 * machine is the actual product truth. Everywhere else stays restrained;
 * this gets the most craft.
 */
export default function PipelineStageRow({ stage, isActive, isLast, index }: PipelineStageRowProps) {
    const reduceMotion = useReducedMotion()

    return (
        <motion.div
            initial={reduceMotion ? false : { opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: reduceMotion ? 0 : index * 0.05, duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
            className="flex gap-4"
        >
            {/* Status indicator column */}
            <div className="flex flex-col items-center">
                <div
                    className={cn(
                        'w-9 h-9 rounded-full flex items-center justify-center border transition-colors duration-300',
                        stage.status === 'complete' && 'bg-success-bg border-success/40',
                        stage.status === 'running' && 'bg-accent-bg border-accent-border',
                        stage.status === 'failed' && 'bg-danger-bg border-danger/40',
                        stage.status === 'pending' && 'bg-bg-subtle border-border',
                    )}
                >
                    {stage.status === 'complete' && (
                        <motion.div initial={reduceMotion ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 25 }}>
                            <Check className="w-4 h-4 text-success" />
                        </motion.div>
                    )}
                    {stage.status === 'running' && (
                        <div className="w-4 h-4 spinner" />
                    )}
                    {stage.status === 'failed' && (
                        <motion.div initial={reduceMotion ? false : { scale: 0 }} animate={{ scale: 1 }}>
                            <X className="w-4 h-4 text-danger" />
                        </motion.div>
                    )}
                    {stage.status === 'pending' && (
                        <div className="w-2.5 h-2.5 rounded-full bg-text-muted pulse-dot" />
                    )}
                </div>
                {!isLast && (
                    <div className={cn(
                        'w-0.5 flex-1 min-h-[28px] transition-colors duration-500',
                        stage.status === 'complete' ? 'bg-success/30' : 'bg-border',
                    )} />
                )}
            </div>

            {/* Content */}
            <div className={cn('pb-5 flex-1', isLast && 'pb-0')}>
                <div className="flex items-center gap-3 mb-1">
                    <h4 className={cn(
                        'font-display font-semibold text-sm transition-colors duration-300',
                        isActive || stage.status === 'complete' ? 'text-text-heading' : 'text-text-muted',
                    )}>
                        {stage.name}
                    </h4>
                </div>
                <p className="text-xs text-text-muted font-body">
                    {stage.status === 'complete' && stage.details ? stage.details : stage.description}
                </p>
                {stage.status === 'running' && (
                    <div className="mt-2 h-1 rounded-full bg-bg-subtle overflow-hidden w-48">
                        <motion.div
                            className="h-full bg-accent rounded-full"
                            initial={{ width: '0%' }}
                            animate={{ width: '70%' }}
                            transition={{ duration: 1.5, ease: 'easeInOut' }}
                        />
                    </div>
                )}
            </div>
        </motion.div>
    )
}

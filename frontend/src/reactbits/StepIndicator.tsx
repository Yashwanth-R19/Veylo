import { motion } from 'framer-motion'

// Extracted from react-bits' Stepper (github.com/DavidHDev/react-bits,
// Components/Stepper) — just the circle-indicator + connector-line + checkmark-draw
// pieces, restyled with the app's accent color instead of upstream's purple.
//
// Deliberately NOT the full Stepper component: AuthorCriteria.tsx already has its
// own working two-screen build/sign flow (state, validation, EIP-712 signing).
// Swapping that onto react-bits' Stepper would mean handing step navigation and
// completion to a generic wizard container never built for this form's actual
// logic. This component only renders progress — it owns no state transitions.

interface StepIndicatorProps {
    steps: string[]
    currentStep: number
}

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg {...props} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <motion.path
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ delay: 0.1, type: 'tween', ease: 'easeOut', duration: 0.3 }}
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
            />
        </svg>
    )
}

export default function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
    return (
        <div className="flex items-center">
            {steps.map((label, i) => {
                const step = i + 1
                const status = currentStep === step ? 'active' : currentStep < step ? 'inactive' : 'complete'
                const isLast = i === steps.length - 1

                return (
                    <div key={label} className="flex items-center">
                        <div className="flex flex-col items-center gap-1.5">
                            <motion.div
                                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium font-body"
                                animate={status}
                                initial={false}
                                variants={{
                                    inactive: { backgroundColor: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)' },
                                    active: { backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-contrast)' },
                                    complete: { backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-contrast)' },
                                }}
                                transition={{ duration: 0.3 }}
                            >
                                {status === 'complete' ? <CheckIcon className="w-3.5 h-3.5" /> : step}
                            </motion.div>
                            <span className={`text-[11px] font-body ${status === 'inactive' ? 'text-text-muted' : 'text-text'}`}>{label}</span>
                        </div>
                        {!isLast && (
                            <div className="w-12 h-px mx-2 mb-5 bg-border overflow-hidden">
                                <motion.div
                                    className="h-full bg-accent"
                                    initial={false}
                                    animate={{ width: currentStep > step ? '100%' : '0%' }}
                                    transition={{ duration: 0.4 }}
                                />
                            </div>
                        )}
                    </div>
                )
            })}
        </div>
    )
}

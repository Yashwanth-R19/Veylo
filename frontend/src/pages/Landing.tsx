import { Link } from 'react-router-dom'
import Navbar from '@/components/shared/Navbar'
import BlurText from '@/components/ui/BlurText'
import ScrollReveal from '@/components/ui/ScrollReveal'
import SpotlightCard from '@/components/ui/SpotlightCard'
import CountUp from '@/components/ui/CountUp'
import { ArrowRight, ShieldCheck, Link2, GitBranch, ClipboardCheck, PenTool, Upload, CheckCircle2, Scale, Github } from 'lucide-react'

const steps = [
    { num: '01', title: 'Author Criteria', desc: 'Client defines machine-checkable criteria, DETERMINISTIC or SEMANTIC. An AI assistant flags ambiguous ones.', icon: ClipboardCheck },
    { num: '02', title: 'Sign', desc: 'Client and worker each sign the criteria hash with their own wallet key. Neither pays gas.', icon: PenTool },
    { num: '03', title: 'Submit Evidence', desc: 'Worker submits a repo and commit. Nothing about the criteria can change now.', icon: Upload },
    { num: '04', title: 'Verify', desc: 'Deterministic checks run in an isolated sandbox and decide the outcome. An AI layer adds advisory evidence — it cannot vote.', icon: CheckCircle2 },
    { num: '05', title: 'Review Window', desc: 'Either party can dispute within the window. An arbitrator rules if they do.', icon: Scale },
    { num: '06', title: 'Settle', desc: 'The chain authorizes settlement; a payment provider executes it exactly once.', icon: GitBranch },
]

const differentiators = [
    {
        icon: ShieldCheck,
        title: 'Deterministic Outcome',
        text: 'Acceptance is decided by per-criterion checks that produce the same result for the same commit — never a discretionary score.',
    },
    {
        icon: Link2,
        title: 'Tamper-Evident Record',
        text: 'The criteria hash and both signatures are committed on-chain. Retroactive edits are detectable, not prevented from being attempted.',
    },
    {
        icon: GitBranch,
        title: 'AI Bounded to Advisory',
        text: 'A semantic criterion can route an outcome to human review — it can never itself produce ACCEPT or REJECT.',
    },
]

// Real, measured numbers from docs/EVALUATION.md — not marketing copy.
const stats = [
    { value: 100.0, decimals: 1, suffix: '%', label: 'Determinism rate', detail: '20/20 corpus repos, identical hash across 5 runs' },
    { value: 98.8, decimals: 1, suffix: '%', label: 'Deterministic accuracy', detail: '84/85 criteria matched expected outcome' },
    { value: 0.0, decimals: 1, suffix: '%', label: 'Injection outcome-flip rate', detail: '0/25 adversarial trials changed a settlement outcome' },
    { value: 25, decimals: 0, suffix: '', label: 'Fault-injection points', detail: '0 double-settlements, 0 lost settlements' },
]

export default function Landing() {
    return (
        <div className="relative min-h-screen bg-bg overflow-hidden">
            <Navbar />

            {/* Hero */}
            <section className="relative z-10 min-h-screen flex flex-col items-center justify-center text-center px-6 pt-16">
                <h1 className="font-display font-semibold text-5xl md:text-[56px] leading-tight text-text-heading mb-5 max-w-3xl">
                    <BlurText text="Verifiable Acceptance for Software Deliverables" stagger={0.05} />
                </h1>
                <p className="text-lg text-text max-w-xl mb-8 font-body">
                    Criteria signed before work begins. Acceptance decided by reproducible checks, not a discretionary score.
                </p>
                <div className="flex items-center gap-4">
                    <Link
                        to="/auth"
                        className="flex items-center gap-2 px-6 py-3 rounded-md bg-accent hover:bg-accent-strong text-accent-contrast font-medium transition-colors"
                    >
                        Start as Client <ArrowRight className="w-4 h-4" />
                    </Link>
                    <Link
                        to="/auth"
                        className="px-6 py-3 rounded-md border border-border text-text hover:text-text-heading hover:border-border-strong font-medium transition-all"
                    >
                        Start as Worker
                    </Link>
                </div>
            </section>

            {/* Measured, not asserted */}
            <section className="relative z-10 max-w-5xl mx-auto px-6 py-16">
                <ScrollReveal>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
                        {stats.map((stat, i) => (
                            <div key={stat.label} className="surface p-5 text-center" style={{ transitionDelay: `${i * 60}ms` }}>
                                <p className="font-mono text-3xl font-semibold text-text-heading">
                                    <CountUp end={stat.value} decimals={stat.decimals} suffix={stat.suffix} delay={i * 100} />
                                </p>
                                <p className="text-xs font-medium text-text mt-2 font-body">{stat.label}</p>
                                <p className="text-[11px] text-text-muted mt-1 font-body leading-relaxed">{stat.detail}</p>
                            </div>
                        ))}
                    </div>
                    <p className="text-center text-xs text-text-muted mt-4 font-body">
                        Measured against the project's own corpus and fault-injection suite — see docs/EVALUATION.md.
                    </p>
                </ScrollReveal>
            </section>

            {/* How it Works */}
            <section className="relative z-10 max-w-6xl mx-auto px-6 py-24">
                <ScrollReveal>
                    <h2 className="font-display font-semibold text-3xl text-text-heading text-center mb-3">How it Works</h2>
                    <p className="text-text text-center mb-14 font-body">Six steps, end to end.</p>
                </ScrollReveal>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {steps.map((step, i) => (
                        <ScrollReveal key={step.num} staggerIndex={i}>
                            <div className="surface p-6 h-full">
                                <div className="flex items-start gap-4">
                                    <span className="font-mono text-2xl font-semibold text-accent/50">{step.num}</span>
                                    <div>
                                        <div className="flex items-center gap-2 mb-2">
                                            <step.icon className="w-4 h-4 text-accent" />
                                            <h3 className="font-display font-semibold text-[15px] text-text-heading">{step.title}</h3>
                                        </div>
                                        <p className="text-sm text-text font-body leading-relaxed">{step.desc}</p>
                                    </div>
                                </div>
                            </div>
                        </ScrollReveal>
                    ))}
                </div>
            </section>

            {/* Differentiators */}
            <section className="relative z-10 max-w-6xl mx-auto px-6 py-24">
                <ScrollReveal>
                    <h2 className="font-display font-semibold text-3xl text-text-heading text-center mb-3">Why Veylo</h2>
                    <p className="text-text text-center mb-14 font-body">What the architecture actually guarantees — see the README for the full trust model.</p>
                </ScrollReveal>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    {differentiators.map((d, i) => (
                        <ScrollReveal key={d.title} staggerIndex={i}>
                            <SpotlightCard className="p-7 h-full">
                                <d.icon className="w-8 h-8 text-accent mb-4" strokeWidth={1.5} />
                                <h3 className="font-display font-semibold text-base text-text-heading mb-2">{d.title}</h3>
                                <p className="text-sm text-text font-body leading-relaxed">{d.text}</p>
                            </SpotlightCard>
                        </ScrollReveal>
                    ))}
                </div>
            </section>

            {/* Trust model teaser */}
            <section className="relative z-10 max-w-3xl mx-auto px-6 py-24">
                <ScrollReveal>
                    <div className="surface p-7 text-center space-y-3">
                        <h2 className="font-display font-semibold text-2xl text-text-heading">The trust model, plainly</h2>
                        <p className="text-sm text-text font-body leading-relaxed">
                            The client and worker sign with their own keys — those are the parties who actually disagree.
                            The validator key belongs to the operator: it buys non-retroactivity, not honesty at write
                            time. The arbitrator is also the operator. Full detail is in the README, not hidden in a
                            footnote.
                        </p>
                    </div>
                </ScrollReveal>
            </section>

            {/* Footer */}
            <footer className="relative z-10 border-t border-border py-8 px-6">
                <div className="max-w-6xl mx-auto flex items-center justify-between">
                    <p className="text-xs text-text-muted font-body">Veylo — verifiable acceptance for software deliverables.</p>
                    <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="text-text-muted hover:text-text transition-colors">
                        <Github className="w-4 h-4" />
                    </a>
                </div>
            </footer>
        </div>
    )
}

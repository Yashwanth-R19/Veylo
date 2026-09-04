import { Link } from 'react-router-dom'
import GlassNavbar from '@/components/shared/GlassNavbar'
import Aurora from '@/components/ui/Aurora'
import BlurText from '@/components/ui/BlurText'
import ScrollReveal from '@/components/ui/ScrollReveal'
import SpotlightCard from '@/components/ui/SpotlightCard'
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

export default function Landing() {
    return (
        <div className="relative min-h-screen bg-background overflow-hidden">
            <Aurora />
            <GlassNavbar />

            {/* Hero */}
            <section className="relative z-10 min-h-screen flex flex-col items-center justify-center text-center px-6 pt-16">
                <h1 className="font-display font-extrabold text-5xl md:text-[56px] leading-tight text-text-primary mb-5 max-w-3xl">
                    <BlurText text="Verifiable Acceptance for Software Deliverables" stagger={0.05} />
                </h1>
                <p className="text-lg text-text-secondary max-w-xl mb-8 font-body">
                    Criteria signed before work begins. Acceptance decided by reproducible checks, not a discretionary score.
                </p>
                <div className="flex items-center gap-4">
                    <Link
                        to="/auth"
                        className="flex items-center gap-2 px-6 py-3 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium transition-colors"
                    >
                        Start as Client <ArrowRight className="w-4 h-4" />
                    </Link>
                    <Link
                        to="/auth"
                        className="px-6 py-3 rounded-lg border border-white/[0.11] text-text-secondary hover:text-text-primary hover:bg-white/[0.04] font-medium transition-all"
                    >
                        Start as Worker
                    </Link>
                </div>
            </section>

            {/* How it Works */}
            <section className="relative z-10 max-w-6xl mx-auto px-6 py-24">
                <ScrollReveal>
                    <h2 className="font-display font-bold text-3xl text-text-primary text-center mb-3">How it Works</h2>
                    <p className="text-text-secondary text-center mb-14 font-body">Six steps, end to end.</p>
                </ScrollReveal>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {steps.map((step, i) => (
                        <ScrollReveal key={step.num} staggerIndex={i}>
                            <div className="glass p-6 h-full">
                                <div className="flex items-start gap-4">
                                    <span className="font-mono text-2xl font-bold text-violet-500/60">{step.num}</span>
                                    <div>
                                        <div className="flex items-center gap-2 mb-2">
                                            <step.icon className="w-4 h-4 text-violet-400" />
                                            <h3 className="font-display font-semibold text-[15px] text-text-primary">{step.title}</h3>
                                        </div>
                                        <p className="text-sm text-text-secondary font-body leading-relaxed">{step.desc}</p>
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
                    <h2 className="font-display font-bold text-3xl text-text-primary text-center mb-3">Why Veylo</h2>
                    <p className="text-text-secondary text-center mb-14 font-body">What the architecture actually guarantees — see the README for the full trust model.</p>
                </ScrollReveal>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    {differentiators.map((d, i) => (
                        <ScrollReveal key={d.title} staggerIndex={i}>
                            <SpotlightCard className="p-7 h-full">
                                <d.icon className="w-8 h-8 text-violet-400 mb-4" strokeWidth={1.5} />
                                <h3 className="font-display font-semibold text-base text-text-primary mb-2">{d.title}</h3>
                                <p className="text-sm text-text-secondary font-body leading-relaxed">{d.text}</p>
                            </SpotlightCard>
                        </ScrollReveal>
                    ))}
                </div>
            </section>

            {/* Trust model teaser */}
            <section className="relative z-10 max-w-3xl mx-auto px-6 py-24">
                <ScrollReveal>
                    <div className="glass p-7 text-center space-y-3">
                        <h2 className="font-display font-bold text-2xl text-text-primary">The trust model, plainly</h2>
                        <p className="text-sm text-text-secondary font-body leading-relaxed">
                            The client and worker sign with their own keys — those are the parties who actually disagree.
                            The validator key belongs to the operator: it buys non-retroactivity, not honesty at write
                            time. The arbitrator is also the operator. Full detail is in the README, not hidden in a
                            footnote.
                        </p>
                    </div>
                </ScrollReveal>
            </section>

            {/* Footer */}
            <footer className="relative z-10 border-t border-white/[0.06] py-8 px-6">
                <div className="max-w-6xl mx-auto flex items-center justify-between">
                    <p className="text-xs text-text-muted font-body">Veylo — verifiable acceptance for software deliverables.</p>
                    <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="text-text-muted hover:text-text-secondary transition-colors">
                        <Github className="w-4 h-4" />
                    </a>
                </div>
            </footer>
        </div>
    )
}

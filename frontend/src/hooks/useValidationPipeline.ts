import { useState, useEffect, useCallback, useRef } from 'react'
import type { PipelineStage, ValidationPipelineState, ValidationReport } from '@/types'
import { runValidation, getValidation } from '@/lib/api'

const STAGE_DELAY_MS = 1800
const POLL_INTERVAL_MS = 2000

// Stage labels only — no fabricated scores or details. Real per-stage results
// come only from the backend report; a stage shows nothing until it arrives.
const PIPELINE_STAGE_DEFS: Pick<PipelineStage, 'id' | 'name' | 'description'>[] = [
    { id: 'clone', name: 'Repository Clone', description: 'Cloning submission repository' },
    { id: 'deps', name: 'Dependency Installation', description: 'Installing project dependencies' },
    { id: 'repoViability', name: 'Repository Viability', description: 'Checking repository contains source files' },
    { id: 'execution', name: 'Test Execution', description: 'Running test suite in sandbox' },
    { id: 'lint', name: 'Static Analysis', description: 'Running linter and code quality' },
    { id: 'semantic', name: 'Semantic AI Analysis', description: 'Evaluating compliance' },
    { id: 'aggregate', name: 'Score Aggregation', description: 'Computing weighted final score' },
    { id: 'commit', name: 'Blockchain Commit', description: 'Recording report hash on-chain' },
]

/**
 * Validation pipeline hook.
 * 
 * Strategy:
 * 1. Call POST /api/validation/run to kick off backend validation.
 * 2. Animate through pipeline stages visually while polling GET /api/validation/:jobId.
 * 3. When the backend returns a report, jump to completion with the real report.
 * 4. If the backend never returns a report, finalReport stays null — the UI
 *    must render that as a real pending/unavailable state, never a fabricated
 *    PASS/FAIL (see docs/CURRENT_STATE.md §7 for the bug this replaced).
 */
export function useValidationPipeline(jobId: number | null, autoStart = false) {
    const [pipelineState, setPipelineState] = useState<ValidationPipelineState>({
        stages: PIPELINE_STAGE_DEFS.map(s => ({ ...s, status: 'pending' as const, score: null, details: null })),
        currentStage: -1,
        isComplete: false,
        finalReport: null,
    })
    const [isRunning, setIsRunning] = useState(false)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const realReportRef = useRef<ValidationReport | null>(null)

    /** Stop all timers */
    const cleanup = useCallback(() => {
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }, [])

    /** Complete with the real backend report. Never invents a score/details for a stage. */
    const completeWithReport = useCallback((report: ValidationReport) => {
        cleanup()
        setPipelineState(prev => ({
            stages: prev.stages.map(s => ({ ...s, status: 'complete' as const })),
            currentStage: PIPELINE_STAGE_DEFS.length - 1,
            isComplete: true,
            finalReport: report,
        }))
        setIsRunning(false)
    }, [cleanup])

    /** Advance through stage LABELS visually. No stage carries a fabricated score. */
    const advanceStage = useCallback((stageIndex: number) => {
        // If we got a real report from polling, finish immediately
        if (realReportRef.current) {
            completeWithReport(realReportRef.current)
            return
        }

        setPipelineState(prev => {
            const stages: PipelineStage[] = prev.stages.map((s, i) => {
                if (i < stageIndex) return { ...s, status: 'complete' as const }
                if (i === stageIndex) return { ...s, status: 'running' as const }
                return s
            })
            return { ...prev, stages, currentStage: stageIndex }
        })

        timerRef.current = setTimeout(() => {
            // Check again if real report arrived during this stage
            if (realReportRef.current) {
                completeWithReport(realReportRef.current)
                return
            }

            setPipelineState(prev => {
                const stages = prev.stages.map((s, i) => (i === stageIndex ? { ...s, status: 'complete' as const } : s))
                const isLast = stageIndex === PIPELINE_STAGE_DEFS.length - 1

                return {
                    stages,
                    currentStage: stageIndex,
                    // No mock fallback: if the real report hasn't arrived yet,
                    // finalReport stays null — the UI must show a real pending
                    // state, never a fabricated PASS/FAIL.
                    isComplete: isLast,
                    finalReport: isLast ? realReportRef.current : null,
                }
            })

            if (stageIndex < PIPELINE_STAGE_DEFS.length - 1) {
                timerRef.current = setTimeout(() => advanceStage(stageIndex + 1), 400)
            } else {
                setIsRunning(false)
                cleanup()
            }
        }, STAGE_DELAY_MS)
    }, [completeWithReport, cleanup])

    /** Start the pipeline: call backend + animate stages */
    const startPipeline = useCallback(async () => {
        cleanup()
        realReportRef.current = null
        setIsRunning(true)
        setPipelineState({
            stages: PIPELINE_STAGE_DEFS.map(s => ({ ...s, status: 'pending' as const, score: null, details: null })),
            currentStage: -1,
            isComplete: false,
            finalReport: null,
        })

        // Kick off backend validation (fire-and-forget)
        if (jobId !== null) {
            runValidation(jobId).catch(err => {
                console.warn('[Pipeline] Backend validation start failed:', err)
            })

            // Start polling for the real report
            pollRef.current = setInterval(async () => {
                try {
                    const report = await getValidation(jobId)
                    if (report && report.overallScore !== undefined) {
                        realReportRef.current = report
                        // If we're still animating, the advanceStage will pick this up
                        // If animation finished, force complete now
                        setPipelineState(prev => {
                            if (prev.isComplete && !prev.finalReport) {
                                return { ...prev, finalReport: report }
                            }
                            return prev
                        })
                    }
                } catch {
                    // Report not ready yet, keep polling
                }
            }, POLL_INTERVAL_MS)
        }

        // Start stage animation
        setTimeout(() => advanceStage(0), 500)
    }, [jobId, advanceStage, cleanup])

    useEffect(() => {
        if (autoStart && jobId !== null) {
            startPipeline()
        }
        return cleanup
    }, [autoStart, jobId, startPipeline, cleanup])

    return { pipelineState, isRunning, startPipeline }
}

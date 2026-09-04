import type { CriterionDraft, CriteriaDocument } from '@/types'

/**
 * Strips AI-assistant-only metadata (ambiguity flags, downgrade flags) and
 * re-indexes by array position, producing exactly the §6 criteria document
 * shape the backend hashes. This must match what gets POSTed to
 * POST /agreements verbatim — the backend hashes whatever `criteria` array
 * it receives, so any extra field left in here would silently become part
 * of the on-chain criteriaHash.
 */
export function toCriteriaDocument(criteria: CriterionDraft[]): CriteriaDocument {
    return {
        version: 1,
        criteria: criteria.map((c, i) => {
            const clean: CriterionDraft = { index: i, method: c.method, text: c.text }
            if (c.method === 'DETERMINISTIC' && c.check) clean.check = c.check
            return clean
        }),
    }
}

export function isCriterionValid(c: CriterionDraft): boolean {
    if (!c.text || !c.text.trim()) return false
    if (c.method === 'DETERMINISTIC') {
        if (!c.check || !c.check.kind) return false
        switch (c.check.kind) {
            case 'file_exists':
                return typeof c.check.path === 'string' && c.check.path.trim().length > 0
            case 'test_passes':
                return typeof c.check.testId === 'string' && c.check.testId.trim().length > 0
            case 'test_suite_passes':
                return true
            case 'http_route':
                return (
                    typeof c.check.method === 'string' && c.check.method.trim().length > 0 &&
                    typeof c.check.route === 'string' && c.check.route.trim().length > 0 &&
                    typeof c.check.expectStatus === 'number'
                )
            case 'lint_clean':
                return typeof c.check.maxErrors === 'number'
            default:
                return false
        }
    }
    return true
}

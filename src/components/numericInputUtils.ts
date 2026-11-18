export function resolveNumericCommit(
  draft: string,
  fallbackValue: number,
  min: number,
  max: number,
): number {
  const trimmed = draft.trim()
  if (trimmed === '') return Math.min(max, Math.max(min, fallbackValue))
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return Math.min(max, Math.max(min, fallbackValue))
  return Math.min(max, Math.max(min, parsed))
}

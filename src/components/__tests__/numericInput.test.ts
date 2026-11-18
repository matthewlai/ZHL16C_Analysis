import { describe, expect, it } from 'vitest'
import { resolveNumericCommit } from '../numericInputUtils'

describe('resolveNumericCommit', () => {
  it('returns parsed value unchanged when within [min, max]', () => {
    expect(resolveNumericCommit('32', 21, 21, 100)).toBe(32)
    expect(resolveNumericCommit(' 45.5 ', 30, 1, 150)).toBe(45.5)
    expect(resolveNumericCommit('21', 32, 21, 100)).toBe(21)
    expect(resolveNumericCommit('100', 32, 21, 100)).toBe(100)
  })

  it('clamps below min and above max on commit', () => {
    expect(resolveNumericCommit('3', 32, 21, 100)).toBe(21)
    expect(resolveNumericCommit('-10', 30, 1, 150)).toBe(1)
    expect(resolveNumericCommit('150', 32, 21, 100)).toBe(100)
    expect(resolveNumericCommit('0.1', 3, 0.5, 30)).toBe(0.5)
  })

  it('reverts to clamped fallback when draft is empty or non-numeric', () => {
    expect(resolveNumericCommit('', 32, 21, 100)).toBe(32)
    expect(resolveNumericCommit('   ', 32, 21, 100)).toBe(32)
    expect(resolveNumericCommit('abc', 32, 21, 100)).toBe(32)
    expect(resolveNumericCommit('NaN', 32, 21, 100)).toBe(32)
    expect(resolveNumericCommit('Infinity', 32, 21, 100)).toBe(32)
    expect(resolveNumericCommit('', 5, 21, 100)).toBe(21)
  })
})

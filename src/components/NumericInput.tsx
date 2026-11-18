import { useRef, useState } from 'react'
import { resolveNumericCommit } from './numericInputUtils'

interface NumericInputProps {
  readonly id: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly step?: number
  readonly className?: string
  readonly onChange: (value: number) => void
}

export function NumericInput({
  id,
  value,
  min,
  max,
  step = 1,
  className = 'number-input',
  onChange,
}: NumericInputProps) {
  const [isFocused, setIsFocused] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const skipCommitOnBlurRef = useRef(false)

  const displayValue = isFocused ? draft : String(value)

  const handleFocus = () => {
    skipCommitOnBlurRef.current = false
    setDraft(String(value))
    setIsFocused(true)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setDraft(raw)

    const trimmed = raw.trim()
    if (trimmed === '') return
    const parsed = Number(trimmed)
    if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
      onChange(parsed)
    }
  }

  const handleBlur = () => {
    if (skipCommitOnBlurRef.current) {
      skipCommitOnBlurRef.current = false
      setIsFocused(false)
      setDraft(String(value))
      return
    }
    const committed = resolveNumericCommit(draft, value, min, max)
    setIsFocused(false)
    setDraft(String(committed))
    if (committed !== value) {
      onChange(committed)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      skipCommitOnBlurRef.current = true
      setDraft(String(value))
      setIsFocused(false)
      e.currentTarget.blur()
    }
  }

  return (
    <input
      id={id}
      className={className}
      type="number"
      min={min}
      max={max}
      step={step}
      value={displayValue}
      onFocus={handleFocus}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    />
  )
}

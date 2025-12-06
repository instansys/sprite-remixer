import { useEffect, useState } from 'react'

interface NumberInputProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  placeholder,
  className,
  disabled
}: NumberInputProps) {
  const [inputValue, setInputValue] = useState(value.toString())

  useEffect(() => {
    setInputValue(value.toString())
  }, [value])

  const handleBlur = () => {
    const trimmed = inputValue.trim()
    if (trimmed === '') {
      // Reset to current value if empty
      setInputValue(value.toString())
      return
    }

    const parsed = parseInt(trimmed, 10)
    if (isNaN(parsed)) {
      // Reset to current value if invalid
      setInputValue(value.toString())
      return
    }

    // Apply min/max constraints
    let finalValue = parsed
    if (min !== undefined && parsed < min) {
      finalValue = min
    }
    if (max !== undefined && parsed > max) {
      finalValue = max
    }

    onChange(finalValue)
    setInputValue(finalValue.toString())
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    }
  }

  return (
    <input
      type="text"
      style={{ padding: '0.5rem 0.5rem', maxWidth: '5rem' }}
      value={inputValue}
      onChange={(e) => setInputValue(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      className={className}
      disabled={disabled}
    />
  )
}
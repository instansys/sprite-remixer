import { useState, useEffect } from 'react'

export function useLocalStorage(
  key: string,
  defaultValue: number
): [number, (value: number) => void] {
  const [value, setValue] = useState<number>(() => {
    const stored = localStorage.getItem(key)
    if (stored === null) return defaultValue
    const parsed = parseInt(stored, 10)
    return isNaN(parsed) ? defaultValue : parsed
  })

  useEffect(() => {
    localStorage.setItem(key, String(value))
  }, [key, value])

  const setValueWrapper = (newValue: number) => {
    setValue(newValue)
  }

  return [value, setValueWrapper]
}

export function useLocalStorageString<T extends string>(
  key: string,
  defaultValue: T
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = localStorage.getItem(key)
    return (stored as T) || defaultValue
  })

  useEffect(() => {
    localStorage.setItem(key, value)
  }, [key, value])

  return [value, setValue]
}

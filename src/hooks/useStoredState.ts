import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

export function useStoredState<Value>(key: string, initialValue: Value): [Value, Dispatch<SetStateAction<Value>>] {
  const [value, setValue] = useState<Value>(() => {
    try {
      const storedValue = window.localStorage.getItem(key)
      return storedValue ? JSON.parse(storedValue) as Value : initialValue
    } catch {
      return initialValue
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {}
  }, [key, value])

  return [value, setValue]
}

import { useSyncExternalStore } from 'react'

export const DEFAULT_WORKBENCH_NAME = '本来工作台'

let currentWorkbenchName = DEFAULT_WORKBENCH_NAME
const listeners = new Set<() => void>()

export function getWorkbenchName(): string {
  return currentWorkbenchName
}

export function setWorkbenchName(name: string | undefined): void {
  const next = typeof name === 'string' && name.trim() ? name.trim() : DEFAULT_WORKBENCH_NAME
  if (next === currentWorkbenchName) return
  currentWorkbenchName = next
  for (const listener of listeners) listener()
}

export function subscribeWorkbenchName(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useWorkbenchName(): string {
  return useSyncExternalStore(subscribeWorkbenchName, getWorkbenchName, getWorkbenchName)
}

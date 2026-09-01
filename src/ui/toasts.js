import { useSyncExternalStore } from 'react'

// A toast says what happened somewhere the user was not looking, and carries
// the undo for it. Confirming something already visible is noise -- creating a
// playlist needs no toast, because the row appears.
//
// A module-level store rather than a context, and that is the whole reason this
// file exists: a provider holding the list would re-render everything beneath
// it every time a toast appeared or expired, including the virtualised track
// list. Here only <Toasts> subscribes.

// Older ones are dropped rather than stacked past this: a column of them covers
// the thing the user is being told about.
const MAX_VISIBLE = 3
// Long enough to read and reach for the undo, which is the only reason any of
// these stay on screen at all.
const WITH_ACTION_MS = 9000
const PLAIN_MS = 5000

const listeners = new Set()
const timers = new Map()

let toasts = []
let nextId = 1

const emit = () => listeners.forEach((listener) => listener())

const stopTimer = (id) => {
  clearTimeout(timers.get(id))
  timers.delete(id)
}

export function dismissToast(id) {
  const next = toasts.filter((toast) => toast.id !== id)
  if (next.length === toasts.length) return
  stopTimer(id)
  toasts = next
  emit()
}

export function pushToast({ message, action = null, tone = 'default', duration }) {
  const id = nextId
  nextId += 1

  const shown = [...toasts, { id, message, action, tone }]
  shown.slice(0, Math.max(0, shown.length - MAX_VISIBLE)).forEach((toast) => stopTimer(toast.id))
  toasts = shown.slice(-MAX_VISIBLE)

  const ms = duration ?? (action ? WITH_ACTION_MS : PLAIN_MS)
  if (ms > 0) timers.set(id, setTimeout(() => dismissToast(id), ms))

  emit()
  return id
}

const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const snapshot = () => toasts

export const useToasts = () => useSyncExternalStore(subscribe, snapshot, snapshot)

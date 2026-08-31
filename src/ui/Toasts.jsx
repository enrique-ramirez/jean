import { Check, TriangleAlert, X } from 'lucide-react'

import { dismissToast, useToasts } from './toasts.js'
import styles from './Toasts.module.css'

const ICONS = { default: Check, error: TriangleAlert }

// Lives in the app grid rather than a portal, placed in the same cell as the
// content row. That pins it to the bottom of the content and above the status
// bar by construction -- no magic number for a bar whose height changes with
// the breakpoint, and no z-index argument with anything.
export function Toasts() {
  const toasts = useToasts()
  if (toasts.length === 0) return null

  return (
    <div className={styles.layer} role="status" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.tone] ?? ICONS.default

        return (
          <div key={toast.id} className={styles.toast} data-tone={toast.tone}>
            <Icon className={styles.icon} size={15} strokeWidth={2.2} aria-hidden="true" />
            <p className={styles.message}>{toast.message}</p>

            {toast.action ? (
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  dismissToast(toast.id)
                  toast.action.run()
                }}
              >
                {toast.action.label}
              </button>
            ) : null}

            <button
              type="button"
              className={styles.close}
              aria-label="Dismiss"
              onClick={() => dismissToast(toast.id)}
            >
              <X size={13} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

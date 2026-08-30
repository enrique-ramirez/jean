import { useDismissable } from '../hooks/useDismissable.js'
import styles from './Menu.module.css'

export function Menu({ isOpen, onDismiss, children, trigger, align = 'end', className }) {
  const ref = useDismissable(isOpen, onDismiss)

  return (
    <div className={styles.anchor} ref={ref}>
      {trigger}
      {isOpen ? (
        <div
          className={[styles.menu, className].filter(Boolean).join(' ')}
          data-align={align}
          role="menu"
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}

export function MenuItem({ icon: Icon, shortcut, children, ...props }) {
  return (
    <button type="button" className={styles.item} role="menuitem" {...props}>
      {Icon ? <Icon size={15} strokeWidth={2} aria-hidden="true" /> : null}
      {children}
      {shortcut ? <span className={styles.shortcut}>{shortcut}</span> : null}
    </button>
  )
}

export function MenuSeparator() {
  return <div className={styles.separator} role="separator" />
}

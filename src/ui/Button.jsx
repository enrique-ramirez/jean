import styles from './Button.module.css'

const VARIANTS = {
  primary: styles.primary,
  default: styles.default,
  ghost: styles.ghost,
}

export function Button({ variant = 'default', icon: Icon, children, className, ...props }) {
  const classes = [styles.button, VARIANTS[variant], !children && styles.iconOnly, className]

  return (
    <button type="button" className={classes.filter(Boolean).join(' ')} {...props}>
      {Icon ? <Icon size={16} aria-hidden="true" /> : null}
      {children}
    </button>
  )
}

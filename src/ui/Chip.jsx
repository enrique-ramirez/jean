import styles from './Chip.module.css'

export function Chip({ label, value }) {
  return (
    <span className={styles.chip}>
      {label}
      {value == null ? null : <b>{value}</b>}
    </span>
  )
}

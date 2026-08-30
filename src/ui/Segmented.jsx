import styles from './Segmented.module.css'

export function Segmented({ value, onChange, options, label }) {
  return (
    <div className={styles.segmented} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.option}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          title={option.label}
        >
          {option.icon ? <option.icon size={14} strokeWidth={2} aria-hidden="true" /> : null}
          <span className={styles.label}>{option.label}</span>
        </button>
      ))}
    </div>
  )
}

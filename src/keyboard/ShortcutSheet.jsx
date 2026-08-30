import { formatForDisplay } from '@tanstack/react-hotkeys'

import { KEYMAP_GROUPS, bindingsIn } from './keymap.js'
import styles from './ShortcutSheet.module.css'

export function ShortcutSheet({ onDismiss }) {
  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss()
      }}
    >
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <h2 className={styles.title}>Keyboard shortcuts</h2>
        <p className={styles.subtitle}>
          <kbd>/</kbd> filters the list you are looking at. <kbd>{formatForDisplay('Mod+k')}</kbd> searches
          everything.
        </p>

        {KEYMAP_GROUPS.map((group) => (
          <section key={group} className={styles.group}>
            <h3 className={styles.groupTitle}>{group}</h3>
            {bindingsIn(group).map((binding) => (
              <div key={binding.id} className={styles.row}>
                <span>{binding.name}</span>
                <span className={styles.keys}>
                  {binding.keys.map((key) => (
                    <kbd key={key}>{formatForDisplay(key)}</kbd>
                  ))}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}

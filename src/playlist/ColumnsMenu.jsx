import { Check, Columns3, Flame } from 'lucide-react'

import { Button } from '../ui/Button.jsx'
import { Menu, MenuItem, MenuSeparator } from '../ui/Menu.jsx'
import { OPTIONAL_COLUMNS } from './columns.js'
import styles from './ColumnsMenu.module.css'

function Option({ label, checked, disabled, onToggle }) {
  return (
    <MenuItem role="menuitemcheckbox" aria-checked={checked} disabled={disabled} onClick={onToggle}>
      <span className={styles.check} data-checked={checked}>
        {checked ? <Check size={11} strokeWidth={3} aria-hidden="true" /> : null}
      </span>
      {label}
    </MenuItem>
  )
}

export function ColumnsMenu({
  isOpen,
  onOpenChange,
  enabledIds,
  onToggleColumn,
  showArtwork,
  onToggleArtwork,
  isAvailable,
  onExplainHeat,
}) {
  return (
    <Menu
      isOpen={isOpen}
      onDismiss={() => onOpenChange(false)}
      className={styles.menu}
      trigger={
        <Button
          icon={Columns3}
          aria-label="View options"
          title="View options"
          aria-expanded={isOpen}
          onClick={() => onOpenChange(!isOpen)}
        />
      }
    >
      {/* The permanent way back to the explanation. The flame teaches once, on
          first sight, and after that this is where someone goes looking. */}
      {onExplainHeat ? (
        <>
          <MenuItem icon={Flame} onClick={onExplainHeat}>
            What the shading means
          </MenuItem>
          <MenuSeparator />
        </>
      ) : null}

      <Option label="Artwork" checked={showArtwork} onToggle={onToggleArtwork} />
      <MenuSeparator />
      {OPTIONAL_COLUMNS.map((column) => {
        const available = isAvailable(column.field)
        return (
          <Option
            key={column.id}
            label={available ? column.label : `${column.label} (not available)`}
            checked={enabledIds.includes(column.id) && available}
            disabled={!available}
            onToggle={() => onToggleColumn(column.id)}
          />
        )
      })}
    </Menu>
  )
}

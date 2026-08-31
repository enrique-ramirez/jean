import { Columns3 } from 'lucide-react'

import { Button } from '../ui/Button.jsx'
import styles from './HeatLegend.module.css'

// What the shading on the rows means. Three facts, in the order someone
// actually asks them: what is it, what is it measured against, why does it
// fade. The scale does most of the work -- the words are there for the two
// things a swatch cannot say.
export function HeatLegend({ onDismiss }) {
  return (
    <div className={styles.legend}>
      <p className={styles.title}>Play-count shading</p>

      <div className={styles.scale} aria-hidden="true" />
      <div className={styles.ends} aria-hidden="true">
        <span>never played</span>
        <span>played most</span>
      </div>

      <p className={styles.body}>
        Warmer rows are the ones you play more, measured against the most-played track in{' '}
        <em>this list</em> — so it rescales when you open a different one.
      </p>

      <p className={styles.body}>
        The colour cools as years pass since you last heard a track. Ones you have never
        played stay plain rather than faded.
      </p>

      <div className={styles.actions}>
        {/* Shows the icon rather than naming the menu. "How do I find this
            again" is the real discoverability problem, and it is best answered
            while the question is live -- pointing at the thing to look for
            beats a badge on a control that has to stay a one-click toggle. */}
        <p className={styles.home}>
          <Columns3 size={13} strokeWidth={2} aria-hidden="true" />
          Find this again under view options
        </p>
        <Button variant="primary" onClick={onDismiss}>
          Got it
        </Button>
      </div>
    </div>
  )
}

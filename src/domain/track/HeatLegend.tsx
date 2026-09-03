import { Columns3 } from "lucide-react";

import { Button } from "@/shared/ui/Button";
import styles from "./HeatLegend.module.css";

export function HeatLegend({ onDismiss }: { onDismiss: () => void }) {
	return (
		<div className={styles.legend}>
			<p className={styles.title}>Play-count shading</p>

			<div className={styles.scale} aria-hidden="true" />
			<div className={styles.ends} aria-hidden="true">
				<span>never played</span>
				<span>played most</span>
			</div>

			<p className={styles.body}>
				Warmer rows are the ones you play more, measured against the most-played
				track in <em>this list</em> — so it rescales when you open a different
				one.
			</p>

			<p className={styles.body}>
				The colour cools as years pass since you last heard a track. Ones you
				have never played stay plain rather than faded.
			</p>

			<div className={styles.actions}>
				<p className={styles.home}>
					<Columns3 size={13} strokeWidth={2} aria-hidden="true" />
					Find this again under view options
				</p>
				<Button variant="primary" onClick={onDismiss}>
					Got it
				</Button>
			</div>
		</div>
	);
}

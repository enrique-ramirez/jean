import { Star } from "lucide-react";

import styles from "./Stars.module.css";

// Display only until rating from Jean is a real feature. Five are always drawn
// and only the fill varies -- Letterboxd's and Plex's shape -- because a row
// whose stars end somewhere different each time cannot be scanned down.
//
// A half is a filled star clipped over its outline rather than a dedicated
// glyph: lucide has none, and clipping keeps the silhouette exactly.
export function Stars({
	value,
	max = 5,
	label,
}: {
	value: number;
	max?: number;
	label?: string;
}) {
	const whole = Math.floor(value);
	const half = value - whole >= 0.5;

	return (
		<span className={styles.stars} role="img" aria-label={label}>
			{Array.from({ length: max }, (_, star) => {
				const fill = star < whole ? 1 : star === whole && half ? 0.5 : 0;
				return (
					// Five stars are always drawn, in the same order, so the position is
					// the star.
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed set, see above
					<span key={star} className={styles.star}>
						<Star aria-hidden="true" />
						{fill > 0 ? (
							<Star
								className={styles.fill}
								aria-hidden="true"
								style={fill < 1 ? { clipPath: "inset(0 50% 0 0)" } : undefined}
							/>
						) : null}
					</span>
				);
			})}
		</span>
	);
}

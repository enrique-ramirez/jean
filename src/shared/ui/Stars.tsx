import { Star } from "lucide-react";

import styles from "./Stars.module.css";

// Display only -- no interaction, deliberately, until rating from Jean is a
// real feature. Reference pass: Letterboxd, Plex and iTunes all draw the full
// set of five and vary only the fill, rather than drawing three stars for a
// three-star record; the count is only legible at a glance when there is a
// track to read it against, and a row whose stars end in a different place
// every time makes a list of them impossible to scan down.
//
// A half is a filled star clipped over its outline, not a dedicated half
// glyph. lucide has none, and clipping keeps the outline's silhouette exactly,
// so a half reads as half of *this* star rather than as a smaller different
// one.
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

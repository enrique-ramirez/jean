import { Star } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useState } from "react";

import styles from "./Stars.module.css";

// A half is a filled star clipped over its outline: lucide has no half-star
// glyph, and clipping keeps the silhouette exactly.
function Glyph({ fill }: { fill: number }) {
	return (
		<>
			<Star aria-hidden="true" />
			{fill > 0 ? (
				<Star
					className={styles.fill}
					aria-hidden="true"
					style={fill < 1 ? { clipPath: "inset(0 50% 0 0)" } : undefined}
				/>
			) : null}
		</>
	);
}

const fillOf = (value: number, star: number) => {
	const whole = Math.floor(value);
	if (star < whole) return 1;
	return star === whole && value - whole >= 0.5 ? 0.5 : 0;
};

export function Stars({
	value,
	max = 5,
	label,
}: {
	value: number;
	max?: number;
	label?: string;
}) {
	return (
		<span className={styles.stars} role="img" aria-label={label}>
			{Array.from({ length: max }, (_, star) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: fixed set, position is the star
				<span key={star} className={styles.star}>
					<Glyph fill={fillOf(value, star)} />
				</span>
			))}
		</span>
	);
}

// Pointer-only, and deliberately not focusable: the virtualiser unmounts rows as
// they scroll and would take focus with them. Keyboard and touch rate through the
// track menu instead. See `domain/track/CLAUDE.md`.
export function StarsInput({
	value,
	max = 5,
	label,
	onRate,
}: {
	value: number;
	max?: number;
	label: string;
	// `null` clears the rating rather than setting a zero.
	onRate: (stars: number | null) => void;
}) {
	const [preview, setPreview] = useState<number | null>(null);
	const shown = preview ?? value;
	// Clicking the set star clears it, so its preview shows the state that would
	// leave behind rather than the star being pointed at.
	const isClearing = preview !== null && preview === value;

	// Committing a rating makes the star under the pointer the one that would now
	// *clear* it, so a preview left armed changes the drawing with no pointer
	// movement to explain it. Dropped on click and re-armed by the next
	// `pointerenter`, which is one event per star rather than a stream: an
	// `onPointerMove` re-arm looks equivalent and re-renders this at the pointer's
	// sample rate, which is felt immediately as a laggy hover.
	const arm = (event: ReactPointerEvent, stars: number) => {
		// A finger hides the value it would preview.
		if (event.pointerType === "touch") return;
		setPreview(stars);
	};

	return (
		// The group is named for the value; each button is named for what it would
		// do. A span rather than a fieldset because this sits in a grid `row`.
		// biome-ignore lint/a11y/useSemanticElements: in a grid row, see above
		<span
			className={styles.stars}
			role="group"
			aria-label={label}
			data-interactive="true"
			data-clearing={isClearing}
			onPointerLeave={() => setPreview(null)}
		>
			{Array.from({ length: max }, (_, star) => {
				const stars = star + 1;
				const clears = stars === value;
				return (
					<button
						// biome-ignore lint/suspicious/noArrayIndexKey: fixed set, position is the star
						key={star}
						type="button"
						className={styles.star}
						tabIndex={-1}
						aria-label={
							clears ? `Clear rating (${label})` : `Rate ${stars} of ${max}`
						}
						onPointerEnter={(event) => arm(event, stars)}
						// The row beneath plays on click and drags on pointer-down.
						onPointerDown={(event) => event.stopPropagation()}
						onClick={(event) => {
							event.stopPropagation();
							setPreview(null);
							onRate(clears ? null : stars);
						}}
					>
						<Glyph fill={fillOf(shown, star)} />
					</button>
				);
			})}
		</span>
	);
}

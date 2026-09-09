import { Star } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useState } from "react";
import { translate } from "@/shared/i18n/locale";
import styles from "./Stars.module.css";

// A half is a filled star clipped over its outline: lucide has no half-star glyph.
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

export function StarsInput({
	value,
	max = 5,
	label,
	onRate,
}: {
	value: number;
	max?: number;
	label: string;
	onRate: (stars: number | null) => void;
}) {
	const [preview, setPreview] = useState<number | null>(null);
	const shown = preview ?? value;
	const isClearing = preview !== null && preview === value;

	const arm = (event: ReactPointerEvent, stars: number) => {
		if (event.pointerType === "touch") return;
		setPreview(stars);
	};

	return (
		// biome-ignore lint/a11y/useSemanticElements: a fieldset cannot sit in this grid row
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
							clears
								? translate("rating.clearOn", { label })
								: translate("rating.set", { stars, max })
						}
						onPointerEnter={(event) => arm(event, stars)}
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

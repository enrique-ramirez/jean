import { useMemo } from "react";
import styles from "./GenreMark.module.css";
import { type Mark, pathsOf } from "./mark";

// The figure, stroked in whatever colour the tile sets. `currentColor` throughout, so that is one
// declaration on the element above this one.
// It draws *darker* than the field it sits on rather than lighter, in both themes: lighter, the
// figure is the brightest thing on a tile whose subject is a record sleeve, and a hundred and forty
// of them at once was a wall of glowing fingerprints. Subtractive, it is a texture the eye passes
// over on the way to the name.
// `slice` rather than `meet`: the box is wider than it is tall and a letterboxed figure would leave
// two bands of flat tint down the sides.
export function GenreMark({ mark }: { mark: Mark }) {
	const paths = useMemo(() => pathsOf(mark), [mark]);

	return (
		<svg
			className={styles.mark}
			viewBox="0 0 100 100"
			preserveAspectRatio="xMidYMid slice"
			aria-hidden="true"
			focusable="false"
		>
			{paths.map((path) => (
				<path
					key={path}
					d={path}
					fill="none"
					stroke="currentColor"
					strokeWidth={7}
					strokeLinecap="round"
				/>
			))}
		</svg>
	);
}

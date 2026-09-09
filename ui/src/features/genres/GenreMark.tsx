import { useMemo } from "react";
import styles from "./GenreMark.module.css";
import { type Mark, pathsOf } from "./mark";

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

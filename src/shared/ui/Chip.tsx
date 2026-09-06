import type { ReactNode } from "react";

import { classNames } from "@/shared/lib/classNames";

import styles from "./Chip.module.css";

// A small labelled figure. Given an `href` it becomes somewhere to go rather than something to read,
// which is the difference between a genre chip that reports a share and one that opens the genre.
export function Chip({
	label,
	value,
	href,
	title,
	className,
}: {
	label: ReactNode;
	value?: ReactNode;
	href?: string;
	title?: string;
	className?: string;
}) {
	const classes = classNames(styles.chip, className);
	const body = (
		<>
			{label}
			{value == null ? null : <b>{value}</b>}
		</>
	);

	return href ? (
		<a className={classes} href={href} title={title} data-link="">
			{body}
		</a>
	) : (
		<span className={classes} title={title}>
			{body}
		</span>
	);
}

import type { ReactNode } from "react";

import { classNames } from "@/shared/lib/classNames";

import styles from "./Chip.module.css";

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

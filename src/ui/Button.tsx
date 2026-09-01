import type { ButtonHTMLAttributes, ComponentType } from "react";

import styles from "./Button.module.css";

const VARIANTS: Record<string, string> = {
	primary: styles.primary,
	default: styles.default,
	ghost: styles.ghost,
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: keyof typeof VARIANTS;
	icon?: ComponentType<{
		size?: number;
		"aria-hidden"?: boolean | "true" | "false";
	}>;
}

export function Button({
	variant = "default",
	icon: Icon,
	children,
	className,
	...props
}: ButtonProps) {
	const classes = [
		styles.button,
		VARIANTS[variant],
		!children && styles.iconOnly,
		className,
	];

	return (
		<button
			type="button"
			className={classes.filter(Boolean).join(" ")}
			{...props}
		>
			{Icon ? <Icon size={16} aria-hidden="true" /> : null}
			{children}
		</button>
	);
}

import type { ButtonHTMLAttributes } from "react";

import { classNames } from "@/shared/lib/classNames";
import styles from "./Button.module.css";
import type { IconComponent } from "./icons";

const VARIANTS = {
	primary: styles.primary,
	default: styles.default,
	ghost: styles.ghost,
	danger: styles.danger,
} satisfies Record<string, string>;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: keyof typeof VARIANTS;
	icon?: IconComponent;
}

export function Button({
	variant = "default",
	icon: Icon,
	children,
	className,
	...props
}: ButtonProps) {
	return (
		<button
			type="button"
			className={classNames(
				styles.button,
				VARIANTS[variant],
				!children && styles.iconOnly,
				className,
			)}
			{...props}
		>
			{Icon ? <Icon size={16} aria-hidden="true" /> : null}
			{children}
		</button>
	);
}

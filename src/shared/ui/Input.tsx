import type { InputHTMLAttributes, ReactNode, Ref } from "react";

import { classNames } from "@/shared/lib/classNames";

import styles from "./Input.module.css";

type NativeProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size">;

export interface InputProps extends NativeProps {
	leading?: ReactNode;
	trailing?: ReactNode;
	// Drawn behind the text, in the input's own metrics, which is why the input is wrapped rather
	// than laid out directly: the two have to share a box.
	underlay?: ReactNode;
	size?: "sm" | "md" | "lg";
	isFilled?: boolean;
	inputRef?: Ref<HTMLInputElement>;
	className?: string;
}

export function Input({
	leading,
	trailing,
	underlay,
	size = "md",
	isFilled,
	inputRef,
	className,
	...input
}: InputProps) {
	const filled = isFilled ?? String(input.value ?? "").length > 0;

	return (
		<div
			className={classNames(styles.field, className)}
			data-size={size}
			data-filled={filled}
		>
			{leading ? <span className={styles.leading}>{leading}</span> : null}

			{underlay ? (
				<span className={styles.well}>
					{underlay}
					<input ref={inputRef} className={styles.input} {...input} />
				</span>
			) : (
				<input ref={inputRef} className={styles.input} {...input} />
			)}

			{trailing ? <span className={styles.trailing}>{trailing}</span> : null}
		</div>
	);
}

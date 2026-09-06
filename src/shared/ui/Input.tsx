import type { InputHTMLAttributes, ReactNode, Ref } from "react";

import styles from "./Input.module.css";

type NativeProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size">;

export interface InputProps extends NativeProps {
	/** Usually an icon. Takes the accent while the field holds something. */
	leading?: ReactNode;
	/** A match count, a clear button, a shortcut hint -- whatever sits at the far end. */
	trailing?: ReactNode;
	/**
	 * Drawn behind the text, in the input's own metrics. What a ghost completion is made of, and the
	 * reason the input is wrapped rather than laid out directly: the two have to share a box.
	 */
	underlay?: ReactNode;
	size?: "sm" | "md" | "lg";
	/** Whether the field holds anything, which is what lights the leading icon. Derived from `value` when not given. */
	isFilled?: boolean;
	inputRef?: Ref<HTMLInputElement>;
	/** Lands on the field, not the input: the box is what a caller positions and sizes. */
	className?: string;
}

// The one text field in Jean. Not a wrapper anybody may skip: a field styled per feature is a field
// that is subtly wrong in five places, and the focus ring in particular has been drawn three
// different ways and fixed three times.
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
			className={[styles.field, className].filter(Boolean).join(" ")}
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

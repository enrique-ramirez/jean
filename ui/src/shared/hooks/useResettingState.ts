import { type SetStateAction, useCallback, useState } from "react";

const sameKeys = (held: readonly unknown[], next: readonly unknown[]) =>
	held.length === next.length &&
	held.every((value, at) => Object.is(value, next[at]));

export function useResettingState<T>(
	initial: T,
	resetOn: readonly unknown[],
): [T, (next: SetStateAction<T>) => void] {
	const [held, setHeld] = useState({ resetOn, value: initial });

	const setValue = useCallback(
		(next: SetStateAction<T>) =>
			setHeld((current) => ({
				resetOn: current.resetOn,
				value:
					typeof next === "function"
						? (next as (value: T) => T)(current.value)
						: next,
			})),
		[],
	);

	if (!sameKeys(held.resetOn, resetOn)) {
		setHeld({ resetOn, value: initial });
		return [initial, setValue];
	}
	return [held.value, setValue];
}

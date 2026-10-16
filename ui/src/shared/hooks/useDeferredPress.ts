import { useEffect, useEffectEvent, useState } from "react";

export function useDeferredPress<Press extends string>(
	isAwaiting: boolean,
	run: (press: Press) => void,
) {
	const [held, setHeld] = useState<Press | null>(null);
	const runHeld = useEffectEvent(run);

	useEffect(() => {
		if (held === null || isAwaiting) return;
		setHeld(null);
		runHeld(held);
	}, [held, isAwaiting]);

	return (press: Press) => {
		if (isAwaiting) setHeld(press);
		else run(press);
	};
}

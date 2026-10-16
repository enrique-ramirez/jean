import { useEffect, useState } from "react";

const PATIENCE_MS = 100;

export interface Wait {
	isWaiting: boolean;
	isOverdue: boolean;
}

export const NO_WAIT: Wait = { isWaiting: false, isOverdue: false };

export function useWait(isWaiting: boolean, scope: string): Wait {
	const [overdueScope, setOverdueScope] = useState<string | null>(null);

	useEffect(() => {
		if (!isWaiting) return;
		const timer = setTimeout(() => setOverdueScope(scope), PATIENCE_MS);
		return () => {
			clearTimeout(timer);
			setOverdueScope(null);
		};
	}, [isWaiting, scope]);

	return { isWaiting, isOverdue: isWaiting && overdueScope === scope };
}

export function byWait<T>(
	wait: Wait,
	shown: { settled: T; quiet: T; reading: T },
): T {
	if (!wait.isWaiting) return shown.settled;
	return wait.isOverdue ? shown.reading : shown.quiet;
}

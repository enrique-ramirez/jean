import type { QueryClient, QueryKey } from "@tanstack/react-query";

export interface CachePatch<T> {
	previous: T | undefined;
	rollBack: () => void;
}

export function patchCache<T>(
	client: QueryClient,
	queryKey: QueryKey,
	patch: (current: T) => T | null,
	revision?: () => unknown,
): CachePatch<T> {
	const previous = client.getQueryData<T>(queryKey);
	const heldRevision = revision?.();
	const next = previous === undefined ? null : patch(previous);
	if (next) client.setQueryData(queryKey, next);

	return {
		previous,
		rollBack: () => {
			if (!next) return;
			if (revision && revision() !== heldRevision) return;
			client.setQueryData(queryKey, previous);
		},
	};
}

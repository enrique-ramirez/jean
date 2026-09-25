import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { discoverFooJean, type FooJeanDiscovery } from "@/shared/api/fooJean";

const KEY = "fooJean";

const UNCHECKED: FooJeanDiscovery = {
	state: { kind: "unreachable" },
	origin: null,
	retryable: false,
};

const MIN_RETRY_MS = 500;
const MAX_RETRY_MS = 60_000;

let retryMs = MIN_RETRY_MS;

const isRetryable = (discovery: FooJeanDiscovery | undefined) =>
	discovery?.retryable ?? false;

export function useFooJean() {
	const queryClient = useQueryClient();

	const query = useQuery({
		queryKey: [KEY],
		// Widened here rather than in `refetchInterval`, which react-query is free to consult more than
		// once per cycle.
		queryFn: async () => {
			const discovery = await discoverFooJean();
			retryMs = discovery.retryable
				? Math.min(retryMs * 2, MAX_RETRY_MS)
				: MIN_RETRY_MS;
			return discovery;
		},
		// A timeout or a refused connection is the network talking: caching it would present a component
		// that is installed and working as absent, for the life of the tab.
		staleTime: (query) =>
			isRetryable(query.state.data) ? 0 : Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: (query) => isRetryable(query.state.data),
		refetchInterval: (query) =>
			isRetryable(query.state.data) ? retryMs : false,
		retry: false,
	});

	const recheck = useCallback(() => {
		retryMs = MIN_RETRY_MS;
		queryClient.invalidateQueries({ queryKey: [KEY] });
	}, [queryClient]);

	return {
		discovery: query.data ?? UNCHECKED,
		isDiscovered: query.data !== undefined,
		isChecking: query.isFetching,
		recheck,
	};
}

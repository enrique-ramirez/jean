import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";

import {
	discoverFooJean,
	type FooJeanDiscovery,
	TOKEN_KEY,
	whenTokenRefused,
} from "@/shared/api/fooJean";
import { useStoredState } from "@/shared/hooks/useStoredState";

const KEY = "fooJean";

const UNCHECKED: FooJeanDiscovery = {
	state: { kind: "unreachable" },
	origin: null,
	token: null,
	retryable: false,
};

const MIN_RETRY_MS = 500;
const MAX_RETRY_MS = 60_000;

let retryMs = MIN_RETRY_MS;
let refusedToken: string | null = null;

const isRetryable = (discovery: FooJeanDiscovery | undefined) =>
	discovery?.retryable ?? false;

export function useFooJean() {
	const [token, setToken] = useStoredState(TOKEN_KEY, "");
	const queryClient = useQueryClient();

	const query = useQuery({
		queryKey: [KEY, token],
		// Widened here rather than in `refetchInterval`, which react-query is free to consult more than
		// once per cycle.
		queryFn: async () => {
			const discovery = await discoverFooJean(token || null);
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

	const isReady = query.data?.state.kind === "ready";

	useEffect(() => {
		if (!isReady) return;
		return whenTokenRefused(() => {
			if (refusedToken === token) return;
			refusedToken = token;
			recheck();
		});
	}, [isReady, recheck, token]);

	return {
		discovery: query.data ?? UNCHECKED,
		isDiscovered: query.data !== undefined,
		isChecking: query.isFetching,
		token,
		setToken,
		recheck,
	};
}

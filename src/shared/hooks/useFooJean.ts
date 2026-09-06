import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import {
	discoverFooJean,
	type FooJeanDiscovery,
	TOKEN_KEY,
} from "@/shared/api/fooJean";
import { useStoredState } from "@/shared/hooks/useStoredState";

// One probe for the whole app: tag writing and listening ask the same question of the same component.
// The dedupe is react-query's, not a provider's: every caller names this key, so the second one to mount reads the first one's result rather than fetching.
const KEY = "fooJean";

const ABSENT: FooJeanDiscovery = {
	state: { kind: "absent" },
	origin: null,
	token: null,
	retryable: false,
};

// beefweb answers on one work queue and closes the connection per response, so an interval that never widens is a permanent cost, per open tab, for a port that is never going to answer -- a firewall, or a machine that is off. Doubling to a cap of a minute keeps a phone walking back into range recovering in seconds while a dead port settles into costing almost nothing.
const MIN_RETRY_MS = 500;
const MAX_RETRY_MS = 60_000;

// The wait before the next attempt. Put back by a settled answer and by an explicit recheck.
let retryMs = MIN_RETRY_MS;

const isRetryable = (discovery: FooJeanDiscovery | undefined) =>
	discovery?.retryable ?? false;

export function useFooJean() {
	const [token, setToken] = useStoredState(TOKEN_KEY, "");
	const queryClient = useQueryClient();

	const query = useQuery({
		queryKey: [KEY, token],
		// Widened here rather than in `refetchInterval`, which react-query is free to consult more than once per cycle.
		queryFn: async () => {
			const discovery = await discoverFooJean(token || null);
			retryMs = discovery.retryable
				? Math.min(retryMs * 2, MAX_RETRY_MS)
				: MIN_RETRY_MS;
			return discovery;
		},
		// A settled answer is a property of the player rather than of this tab, so it is asked once and the settings screen has an explicit check again.
		// A timeout or a refused connection is the network talking: caching it would present a component that is installed and working as absent, for the life of the tab.
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
		discovery: query.data ?? ABSENT,
		isChecking: query.isFetching,
		token,
		setToken,
		recheck,
	};
}

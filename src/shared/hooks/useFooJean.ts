import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import {
	discoverFooJean,
	type FooJeanDiscovery,
	TOKEN_KEY,
} from "@/shared/api/fooJean";
import { useStoredState } from "@/shared/hooks/useStoredState";

// One probe for the whole app. Tag writing and listening ask the same question
// of the same component, and each running its own discovery would send two
// `status` calls and two `capabilities` calls to learn one thing.
//
// The dedupe is react-query's, not a provider's: every caller names this key, so
// the second one to mount reads the first one's result rather than fetching.
const KEY = "fooJean";

const ABSENT: FooJeanDiscovery = {
	state: { kind: "absent" },
	origin: null,
	token: null,
};

export function useFooJean() {
	const [token, setToken] = useStoredState(TOKEN_KEY, "");
	const queryClient = useQueryClient();

	const query = useQuery({
		queryKey: [KEY, token],
		queryFn: () => discoverFooJean(token || null),
		// A property of the player rather than of this tab. The settings screen has
		// an explicit "check again".
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
		retry: false,
	});

	const recheck = useCallback(() => {
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

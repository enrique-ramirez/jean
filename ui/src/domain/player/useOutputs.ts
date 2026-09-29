import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { orThrow, refusedStatusOf } from "@/shared/api/client";
import {
	isFooJeanReady,
	permitsOutputChange,
	requireFooJean,
} from "@/shared/api/discovery";
import { fetchOutputs, type OutputDevice } from "@/shared/api/outputs";
import { setActiveOutput } from "@/shared/api/playback";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { translate } from "@/shared/i18n/locale";
import { pushToast } from "@/shared/ui/toastStore";
import { usePlayerPatch } from "./playerWrite";

export const OUTPUTS_KEY = ["outputs"];

// The list is read at exactly four moments (found, a picker opening, the tab
// becoming visible, `canChangeOutput` turning true), never on a schedule of its
// own and never again just because a second host mounted: `enabled` is the gate
// and the readiness together, `staleTime: 0` lets a gate turning true or the tab
// coming back read over stale data, and `refetchOnMount: false` keeps a later
// host from reading the cache the first one already holds.
export function useOutputs() {
	const { discovery } = useFooJean();
	const enabled = permitsOutputChange(discovery) && isFooJeanReady(discovery);

	const query = useQuery({
		queryKey: OUTPUTS_KEY,
		enabled,
		staleTime: 0,
		refetchOnMount: false,
		// The tab becoming visible again is one of the four moments criterion 18 names, unlike every
		// sibling query here, which turns this off: left implicit, the default reads as an oversight
		// rather than the one query that means to lean on it.
		refetchOnWindowFocus: true,
		// Coming back online is not one of the four moments criterion 18 names, and react-query
		// reads every stale query again on it unless told not to.
		refetchOnReconnect: false,
		// Thrown, react-query leaves `data` holding the last good list rather than replacing it with
		// an empty one, which criterion 24 says must stay drawn. No retry: a retry would read the route
		// again on its own schedule, which is a fifth moment nobody asked for.
		retry: false,
		queryFn: async () =>
			orThrow(await fetchOutputs(requireFooJean(discovery.origin))),
	});

	const devices: OutputDevice[] = query.data?.devices ?? [];

	// Absent rather than disabled while the switch is refused, only one device
	// exists, or the first list has not answered yet: a caret appearing a moment
	// after the status bar does would be worse than one that was always there.
	const isAvailable = enabled && devices.length > 1;

	const mutation = usePlayerPatch(
		async (deviceId: string) => {
			const origin = requireFooJean(discovery.origin);
			orThrow(await setActiveOutput(origin, deviceId));
		},
		(_player, deviceId: string) => ({ outputDeviceId: deviceId }),
	);

	const { mutate } = mutation;

	const choose = useCallback(
		(deviceId: string) => {
			mutate(deviceId, {
				onError: (error: unknown) => {
					pushToast({
						tone: "error",
						message: translate(
							refusedStatusOf(error) === 409
								? "player.outputDeviceGone"
								: "player.outputSwitchFailed",
						),
					});
				},
			});
		},
		[mutate],
	);

	return { devices, isAvailable, refetch: query.refetch, choose };
}

import {
	type QueryKey,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { orThrow, type Result, switchRefusalThrown } from "@/shared/api/client";
import { type FooJeanDiscovery, requireFooJean } from "@/shared/api/discovery";
import type { PlayerSnapshot, PlayerState } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { translate } from "@/shared/i18n/locale";
import { patchCache } from "@/shared/lib/patchCache";
import { pushToast } from "@/shared/ui/toastStore";
import { PLAYER_KEY } from "./playerPoll";

export function announcePlaybackRefusal(recheck: () => void) {
	pushToast({ tone: "error", message: translate("player.controlOffToast") });
	recheck();
}

export function reportPlaybackRefusal(error: unknown, recheck: () => void) {
	if (switchRefusalThrown(error) !== "playbackDisabled") return;
	announcePlaybackRefusal(recheck);
}

export function useOptimisticWrite<TData, TInput, TResult = unknown>(
	queryKey: QueryKey,
	mutationFn: (input: TInput) => Promise<TResult>,
	patch: (previous: TData, input: TInput) => TData | null,
	reconcile?: (previous: TData, input: TInput, result: TResult) => TData | null,
	revisionKey?: QueryKey,
) {
	const queryClient = useQueryClient();
	const { recheck } = useFooJean();

	return useMutation({
		mutationFn,

		onMutate: async (input: TInput) => {
			await queryClient.cancelQueries({ queryKey });
			return patchCache<TData>(
				queryClient,
				queryKey,
				(previous) => patch(previous, input),
				revisionKey && (() => queryClient.getQueryData(revisionKey)),
			);
		},

		onSuccess: reconcile
			? (result: TResult, input: TInput) => {
					const current = queryClient.getQueryData<TData>(queryKey);
					const next = current ? reconcile(current, input, result) : null;
					if (next) queryClient.setQueryData(queryKey, next);
				}
			: undefined,

		onError: (
			error: unknown,
			_input: TInput,
			written: { rollBack: () => void } | undefined,
		) => {
			reportPlaybackRefusal(error, recheck);
			written?.rollBack();
		},
	});
}

// Always re-anchors the interpolation: freezing a position without moving `syncedAt` leaves the seek
// bar carrying on from where the last update put it.
export const usePlayerPatch = <TInput>(
	mutationFn: (input: TInput) => Promise<unknown>,
	patchPlayer: (
		player: PlayerState,
		input: TInput,
		previous: PlayerSnapshot,
	) => Partial<PlayerState> | null,
) =>
	useOptimisticWrite<PlayerSnapshot, TInput>(
		PLAYER_KEY,
		mutationFn,
		(previous, input) => {
			const player = previous.player;
			if (!player) return null;
			const next = patchPlayer(player, input, previous);
			return (
				next && { player: { ...player, ...next }, syncedAt: performance.now() }
			);
		},
	);

export const useCommand = (
	discovery: FooJeanDiscovery,
	command: (origin: string) => Promise<Result<unknown>>,
) => {
	const { recheck } = useFooJean();
	return useMutation({
		mutationFn: async () => {
			const origin = requireFooJean(discovery.origin);
			orThrow(await command(origin));
		},
		onError: (error: unknown) => reportPlaybackRefusal(error, recheck),
	});
};

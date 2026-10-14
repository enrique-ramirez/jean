import {
	type QueryClient,
	type QueryKey,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { orThrow, type Result, switchRefusalThrown } from "@/shared/api/client";
import { type FooJeanDiscovery, requireFooJean } from "@/shared/api/discovery";
import type { PlayerSnapshot, PlayerState } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { translate } from "@/shared/i18n/locale";
import { type CachePatch, patchCache } from "@/shared/lib/patchCache";
import { pushToast } from "@/shared/ui/toastStore";
import { holdPlayerWrite } from "./playerPoll";
import { sessionEpoch } from "./session";

export function patchInSession<T>(
	client: QueryClient,
	queryKey: QueryKey,
	patch: (current: T) => T | null,
	revision?: () => unknown,
): CachePatch<T> {
	const epoch = sessionEpoch();
	const written = patchCache(client, queryKey, patch, revision);
	return {
		previous: written.previous,
		rollBack: () => {
			if (sessionEpoch() === epoch) written.rollBack();
		},
	};
}

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
			return patchInSession<TData>(
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

export const usePlayerPatch = <TInput>(
	mutationFn: (input: TInput) => Promise<unknown>,
	patchPlayer: (
		player: PlayerState,
		input: TInput,
		previous: PlayerSnapshot,
	) => Partial<PlayerState> | null,
) => {
	const queryClient = useQueryClient();
	const { recheck } = useFooJean();

	return useMutation({
		mutationFn,
		onMutate: (input: TInput) =>
			holdPlayerWrite(queryClient, (previous) =>
				patchPlayer(previous.player, input, previous),
			),
		onSuccess: (_result, _input, held) => held?.answered(),
		onError: (error, _input, held) => {
			reportPlaybackRefusal(error, recheck);
			held?.rollBack();
		},
	});
};

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

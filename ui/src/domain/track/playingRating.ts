import type { QueryClient } from "@tanstack/react-query";

import { PLAYER_KEY } from "@/domain/player/playerPoll";
import type {
	ActiveItem,
	PlayerSnapshot,
	TrackAddress,
} from "@/shared/api/types";
import { clearWrittenRating, setWrittenRating } from "./ratingStore";
import type { OptimisticValue, RateTarget } from "./useTagWriter";

export const nowPlayingKey = (path: string | null, subsong: number) =>
	path ? ["nowPlaying", path, subsong] : ["nowPlaying", null];

export interface HeldRating {
	rating: string;
	agreedRating: string;
}

const playingRows = new Set<RateTarget>();

export function holdPlayingRow(row: RateTarget) {
	playingRows.add(row);
	return () => {
		playingRows.delete(row);
	};
}

const isPlayingAt = (address: TrackAddress, item: ActiveItem) => {
	if (address.kind === "library")
		return (
			address.track === item.libraryPath && address.subsong === item.subsong
		);
	if (address.kind === "playlist")
		return (
			address.playlist === item.playlistGuid && address.index === item.index
		);
	return false;
};

const isPlaying = ({ source, ref }: RateTarget, item: ActiveItem) =>
	source.addresses(ref).some((address) => isPlayingAt(address, item));

const allOf = (paints: OptimisticValue[]): OptimisticValue => ({
	adopt: (raw) => {
		for (const paint of paints) paint.adopt(raw);
	},
	confirm: (raw) => {
		for (const paint of paints) paint.confirm(raw);
	},
	restore: () => {
		for (const paint of paints) paint.restore();
	},
});

const rowPaint = ({ columns, ref }: RateTarget): OptimisticValue => {
	const overlay = (raw: string) => setWrittenRating(columns, ref, raw);
	return {
		adopt: overlay,
		confirm: overlay,
		restore: () => clearWrittenRating(columns, ref),
	};
};

function heldRatingPaint(
	queryClient: QueryClient,
	{ path, subsong }: ActiveItem,
): OptimisticValue {
	const patch = (change: (held: HeldRating) => Partial<HeldRating>) =>
		queryClient.setQueryData(
			nowPlayingKey(path, subsong),
			(current: HeldRating | null | undefined) =>
				current ? { ...current, ...change(current) } : current,
		);

	return {
		adopt: (raw) => patch(() => ({ rating: raw })),
		confirm: (raw) => patch(() => ({ rating: raw, agreedRating: raw })),
		restore: () => patch((held) => ({ rating: held.agreedRating })),
	};
}

export const playingTrackPaint = (
	queryClient: QueryClient,
	item: ActiveItem,
): OptimisticValue =>
	allOf([
		heldRatingPaint(queryClient, item),
		...[...playingRows].filter((row) => isPlaying(row, item)).map(rowPaint),
	]);

export function rowRatingPaint(
	queryClient: QueryClient,
	target: RateTarget,
): OptimisticValue {
	const item =
		queryClient.getQueryData<PlayerSnapshot>(PLAYER_KEY)?.player?.activeItem;
	return item && isPlaying(target, item)
		? allOf([rowPaint(target), playingTrackPaint(queryClient, item)])
		: rowPaint(target);
}

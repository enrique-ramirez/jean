import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
	LYRIC_FIELD,
	useTagWriting,
	type WritableAddress,
} from "@/domain/track/useTagWriter";
import { playingTrack } from "@/shared/api/playerState";
import type { PlayerSnapshot } from "@/shared/api/types";
import { translate } from "@/shared/i18n/locale";
import { setCachedLyrics, useNowPlayingTrack } from "./useNowPlayingTrack";

export interface LyricTarget {
	writable: WritableAddress;
	path: string;
	subsong: number;
	title: string;
	artist: string | null;
	duration: number | null;
}

export function playingAgainst(
	target: LyricTarget,
	snapshot: PlayerSnapshot | null | undefined,
): { isPlayingTarget: boolean; other: string | null } {
	const track =
		snapshot?.player?.playbackState === "stopped"
			? null
			: playingTrack(snapshot?.player);
	const isPlayingTarget =
		track !== null &&
		track.path === target.path &&
		track.subsong === target.subsong;
	return {
		isPlayingTarget,
		other:
			isPlayingTarget || !track
				? null
				: (track.title ?? translate("track.unknownTitle")),
	};
}

const isLocalPath = (path: string | null) =>
	path !== null && !path.includes("://");

export function useNowPlayingLyric() {
	const { hasWritableAddress, writableAddress, writeLyric } = useTagWriting();
	const { track, addresses, artistTag, duration, details } =
		useNowPlayingTrack();

	const isLocalFile = track !== null && isLocalPath(track.path);
	const canSave =
		isLocalFile &&
		details !== null &&
		hasWritableAddress(LYRIC_FIELD, addresses);

	const writable = canSave ? writableAddress(LYRIC_FIELD, addresses) : null;
	const target: LyricTarget | null =
		track?.path && writable
			? {
					writable,
					path: track.path,
					subsong: track.subsong,
					title: track.title,
					artist: artistTag,
					duration,
				}
			: null;

	const queryClient = useQueryClient();

	const save = useCallback(
		async (saveTo: LyricTarget, text: string) => {
			const saved = await writeLyric(saveTo.writable, saveTo.title, text);
			if (saved)
				setCachedLyrics(queryClient, saveTo.path, saveTo.subsong, text);
			return saved;
		},
		[writeLyric, queryClient],
	);

	return { canSave: target !== null, target, save };
}

import { useEffect } from "react";

import { readValue } from "@/domain/track/fields";
import { fetchPlayingTrack } from "@/shared/api/tracks";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { LYRICS_EXPRESSIONS, NOW_PLAYING_FIELD } from "./nowPlayingFields";
import { useNowPlayingTrack } from "./useNowPlayingTrack";

const LOOK_AT = [2_000, 5_000, 10_000, 20_000];

export function useLyricsRecheck() {
	const { track, details, setLyrics } = useNowPlayingTrack();
	const { discovery } = useFooJean();
	const { origin } = discovery;
	const path = track?.path ?? null;
	const subsong = track?.subsong ?? 0;
	const isBare =
		details !== null &&
		readValue(details.row[NOW_PLAYING_FIELD.lyrics]) === null;

	useEffect(() => {
		if (!isBare || path === null || !origin) return;

		const from = Date.now();
		let look = 0;
		let timer: ReturnType<typeof setTimeout>;
		let isCancelled = false;

		const read = async () => {
			const answer = await fetchPlayingTrack(origin, LYRICS_EXPRESSIONS);
			if (isCancelled) return;

			const found =
				answer.ok &&
				answer.value.path === path &&
				answer.value.subsong === subsong
					? readValue(answer.value.columns[0])
					: null;

			if (found === null) schedule();
			else setLyrics(found);
		};

		const schedule = () => {
			const at = LOOK_AT[look++];
			if (at === undefined) return;
			timer = setTimeout(
				() => void read(),
				Math.max(0, from + at - Date.now()),
			);
		};

		schedule();

		return () => {
			isCancelled = true;
			clearTimeout(timer);
		};
	}, [isBare, path, subsong, origin, setLyrics]);
}

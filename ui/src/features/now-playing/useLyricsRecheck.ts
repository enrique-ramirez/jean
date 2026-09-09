import { useEffect } from "react";

import { readValue } from "@/domain/track/fields";
import { fetchActiveItemColumns } from "@/shared/api/beefweb";
import {
	LYRICS_EXPRESSIONS,
	LYRICS_FIELD,
	NOW_PLAYING_FIELD,
} from "./nowPlayingFields";
import { useNowPlayingTrack } from "./useNowPlayingTrack";

const LOOK_AT = [2_000, 5_000, 10_000, 20_000];

export function useLyricsRecheck() {
	const { details, setLyrics } = useNowPlayingTrack();
	const path = details?.path ?? null;
	const isBare =
		details !== null &&
		readValue(details.row[NOW_PLAYING_FIELD.lyrics]) === null;

	useEffect(() => {
		if (!isBare || path === null) return;

		const from = Date.now();
		let look = 0;
		let timer: ReturnType<typeof setTimeout>;
		let isCancelled = false;

		const read = async () => {
			const row = await fetchActiveItemColumns(LYRICS_EXPRESSIONS).catch(
				() => null,
			);
			if (isCancelled) return;

			const found =
				row && row[LYRICS_FIELD.path] === path
					? readValue(row[LYRICS_FIELD.lyrics])
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
	}, [isBare, path, setLyrics]);
}

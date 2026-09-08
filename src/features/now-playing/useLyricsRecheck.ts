import { useEffect } from "react";

import { readValue } from "@/domain/track/fields";
import { fetchActiveItemColumns } from "@/shared/api/beefweb";
import {
	LYRICS_EXPRESSIONS,
	LYRICS_FIELD,
	NOW_PLAYING_FIELD,
} from "./nowPlayingFields";
import { useNowPlayingTrack } from "./useNowPlayingTrack";

// `foo_openlyrics` writes the tag while the track plays, and beefweb pushes nothing when a tag changes,
// so the only way to see a lyric that arrives late is to look again. Milliseconds from the first look,
// not gaps between them: its local sources answer at once and its online search runs well past them.
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

			// The player answers about whatever is playing when the request is served.
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

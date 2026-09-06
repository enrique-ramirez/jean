import { DiscAlbum, Music2 } from "lucide-react";
import type { CSSProperties } from "react";
import { useMemo } from "react";

import { genreHref } from "@/domain/library/genreRoute";
import type { LibrarySource } from "@/domain/track/librarySource";
import { plural } from "@/shared/lib/text";
import { Artwork } from "@/shared/ui/Artwork";
import { GenreMark } from "./GenreMark";
import styles from "./GenreTile.module.css";
import type { Genre } from "./genres";
import { markOf } from "./mark";

// How far a sleeve leans, at most. Enough to read as dropped rather than filed, and not so far that
// the stack stops looking like a row of records.
const MAX_TILT = 9;

// One genre, as something to aim at.
// The name and the sleeves carry the meaning; the figure behind them is texture, and the counts are a
// pill kept out of the way of both. A wall of a hundred and forty bright fingerprints buries the one
// thing on each tile that is actually about the music.
// An anchor, not a button: a genre is a destination, and cmd-click has to open it in a tab.
export function GenreTile({
	genre,
	source,
}: {
	genre: Genre;
	source: LibrarySource;
}) {
	const mark = useMemo(() => markOf(genre.name), [genre.name]);

	// Each sleeve's lean comes off the same seed as the figure, so a genre's stack is scattered the
	// same way on every device and every render. A fan that reshuffles when React re-renders reads as
	// a glitch rather than as a pile.
	const covers = useMemo(
		() =>
			genre.coverRefs.map((ref, at) => ({
				ref,
				url: source.artworkUrl(ref),
				tilt: (mark.draws[at % mark.draws.length] * 2 - 1) * MAX_TILT,
			})),
		[genre.coverRefs, source, mark.draws],
	);

	const countLabel = [
		genre.albumCount > 0 ? plural(genre.albumCount, "album") : null,
		plural(genre.trackCount, "track"),
	]
		.filter(Boolean)
		.join(", ");

	return (
		<a
			className={styles.tile}
			href={genreHref(genre.name)}
			style={{ "--genre-tint": mark.tint } as CSSProperties}
			// What the grid's arrow keys walk. Read off the DOM in source order, so a filtered grid needs no second list of what is in it.
			data-genre-tile=""
		>
			<span className={styles.field}>
				<GenreMark mark={mark} />
			</span>

			{/* A pill over the artwork rather than a line beside it, which is what a shelf card does with
			    its caption. It sits opposite the name so neither has to give up width to the other.
			    Icons rather than words because at two columns the words all but span the tile -- and the
			    label carries the units, since `235 · 2,667` read aloud is two numbers about nothing.
			    `Album` and not `DiscAlbum`: the latter is what `Artwork` draws for *there is no cover
			    here*, and a tile can show both at once. */}
			<span className={styles.counts}>
				{/* A bare `<span>` takes no `aria-label`, so the units are read out of the document rather
				    than asserted onto it. Everything visible is then hidden from the reader, which is
				    what keeps `235 · 2,667` from being announced as two numbers about nothing. */}
				<span className="visually-hidden">{countLabel}</span>

				<span aria-hidden="true" className={styles.figures}>
					{genre.albumCount > 0 ? (
						<>
							<DiscAlbum size={12} strokeWidth={2} />
							{genre.albumCount.toLocaleString()}
							<span className={styles.separator}>·</span>
						</>
					) : null}
					<Music2 size={12} strokeWidth={2} />
					{genre.trackCount.toLocaleString()}
				</span>
			</span>

			<span className={styles.body}>
				{/* One line. A tag can be `Alternative rock, blues rock, psychedelic rock`, and wrapping it
				    to three lines makes every tile in the row a different height on the inside. */}
				<span className={styles.name} title={genre.name}>
					{genre.name}
				</span>

				{covers.length > 0 ? (
					<span className={styles.stack}>
						{covers.map((cover) => (
							<span
								key={cover.ref}
								className={styles.sleeve}
								style={{ "--tilt": `${cover.tilt}deg` } as CSSProperties}
							>
								<Artwork src={cover.url} size="100%" alt="" />
							</span>
						))}
					</span>
				) : null}
			</span>
		</a>
	);
}

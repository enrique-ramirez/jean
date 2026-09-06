import {
	type CSSProperties,
	memo,
	type PointerEvent as ReactPointerEvent,
} from "react";
import { formatTime } from "@/domain/player/position";
import type { TrackColumns } from "@/shared/api/types";
import { Artwork } from "@/shared/ui/Artwork";
import { Equalizer } from "@/shared/ui/Equalizer";
import { Stars, StarsInput } from "@/shared/ui/Stars";
import type { Column } from "./columns";
import {
	artistOf,
	FIELD,
	lastPlayedOf,
	numberOf,
	playCountOf,
	titleOf,
	value,
} from "./fields";
import { discNumber } from "./grouping";
import type { LibrarySource } from "./librarySource";
import {
	isWritableScale,
	MAX_STARS,
	rawRatingWith,
	starsOf,
	toStars,
} from "./rating";
import { useWrittenRating } from "./ratingStore";
import styles from "./TrackRow.module.css";
import { useTagWriting } from "./useTagWriter";

function Rating({
	row,
	source,
	itemIndex,
}: {
	row: TrackColumns;
	source: LibrarySource;
	itemIndex: number;
}) {
	const { canRateInline, rate } = useTagWriting();
	const written = useWrittenRating(row);

	const raw = rawRatingWith(row, written);
	const rating = starsOf(raw);
	const stars = rating === null ? 0 : toStars(rating);
	const label = rating === null ? "Unrated" : `${stars} of ${MAX_STARS} stars`;

	if (!canRateInline || !isWritableScale(raw))
		return <Stars value={stars} label={label} />;

	return (
		<StarsInput
			value={stars}
			label={label}
			onRate={(next) => rate({ source, ref: itemIndex, row }, next)}
		/>
	);
}

function shortDate(row: TrackColumns) {
	const played = lastPlayedOf(row);
	if (played === null) return null;
	return new Date(played).toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
	});
}

function Cell({
	column,
	row,
	source,
	itemIndex,
}: {
	column: Column;
	row: TrackColumns;
	source: LibrarySource;
	itemIndex: number;
}) {
	const className = [
		styles.cell,
		column.align === "right" ? styles.numeric : null,
	]
		.filter(Boolean)
		.join(" ");

	if (column.kind === "rating") {
		return (
			<span className={className}>
				<Rating row={row} source={source} itemIndex={itemIndex} />
			</span>
		);
	}

	if (column.kind === "duration") {
		const seconds = numberOf(row, FIELD.duration);
		return (
			<span className={`${className} tabular`}>
				{seconds === null ? "--" : formatTime(seconds)}
			</span>
		);
	}

	if (column.kind === "playCount") {
		const plays = playCountOf(row) ?? 0;
		return (
			<span className={`${className} tabular`} data-zero={plays === 0}>
				{plays === 0 ? "--" : plays}
			</span>
		);
	}

	if (column.kind === "date") {
		return (
			<span className={`${className} tabular`}>{shortDate(row) ?? "--"}</span>
		);
	}

	if (column.kind === "bitrate") {
		const rate = numberOf(row, FIELD.bitrate);
		return (
			<span className={`${className} tabular`}>
				{rate === null ? "--" : rate}
			</span>
		);
	}

	return <span className={className}>{value(row, column.field) ?? "--"}</span>;
}

function TrackRowComponent({
	row,
	index,
	itemIndex,
	coverIndex = itemIndex,
	source,
	columns,
	template,
	showArtwork,
	heat,
	patina,
	isActive,
	isPlaying,
	isSelected,
	isCursor,
	isMatch,
	showArtist = true,
	note = null,
	showDisc = false,
	onSelect,
}: {
	row: TrackColumns;
	index: number;
	itemIndex: number;
	coverIndex?: number;
	source: LibrarySource;
	columns: Column[];
	template: string;
	showArtwork: boolean;
	heat: number;
	patina: number;
	isActive?: boolean;
	isPlaying?: boolean;
	isSelected?: boolean;
	isCursor?: boolean;
	isMatch?: boolean;
	showArtist?: boolean;
	note?: string | null;
	showDisc?: boolean;
	onSelect: (index: number, event: ReactPointerEvent) => void;
}) {
	const title = titleOf(row);
	const artist = artistOf(row);
	const trackNumber = value(row, FIELD.trackNumber);

	const disc = showDisc && trackNumber !== null ? discNumber(row) : null;

	return (
		// biome-ignore lint/a11y/useSemanticElements: rows are absolutely positioned by the virtualiser, which table layout cannot express
		// biome-ignore lint/a11y/useFocusableInteractive: the virtualiser unmounts the focused row as it scrolls out of view, so the cursor is an index in state and the list element owns focus
		<div
			className={styles.track}
			style={
				{
					gridTemplateColumns: template,
					"--heat": heat,
					"--patina": patina,
				} as CSSProperties
			}
			data-row={index}
			data-active={isActive}
			data-selected={isSelected}
			data-cursor={isCursor}
			data-match={isMatch}
			role="row"
			aria-selected={isSelected}
			onPointerDown={(event) => {
				// Secondary click must leave the selection alone, or a multi-track selection is emptied
				// before the context menu about to act on it has opened.
				if (event.button === 0) onSelect(index, event);
			}}
		>
			<span className={`${styles.index} tabular`}>
				{isActive && isPlaying ? (
					<Equalizer label="Now playing" />
				) : disc !== null ? (
					`${disc}.${trackNumber}`
				) : (
					(trackNumber ?? index + 1)
				)}
			</span>

			{showArtwork ? (
				<Artwork src={source.artworkUrl(coverIndex)} size={34} />
			) : null}

			<span className={styles.names} data-inline={note !== null}>
				<span className={styles.title}>{title}</span>
				{note === null ? null : <span className={styles.note}>{note}</span>}
				{showArtist ? <span className={styles.artist}>{artist}</span> : null}
			</span>

			{columns.map((column) => (
				<Cell
					key={column.id}
					column={column}
					row={row}
					source={source}
					itemIndex={itemIndex}
				/>
			))}
		</div>
	);
}

export const TrackRow = memo(TrackRowComponent);

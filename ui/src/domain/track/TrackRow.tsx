import { GripVertical } from "lucide-react";
import {
	type CSSProperties,
	memo,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
} from "react";
import { spellValues } from "@/shared/api/multiValue";
import type { TrackColumns } from "@/shared/api/types";
import {
	type Formats,
	useFormats,
	useSpoken,
	useTranslate,
} from "@/shared/i18n/useTranslate";
import { classNames } from "@/shared/lib/classNames";
import { formatTime } from "@/shared/lib/time";
import { Artwork } from "@/shared/ui/Artwork";
import { Equalizer } from "@/shared/ui/Equalizer";
import { Stars, StarsInput } from "@/shared/ui/Stars";
import type { Column, ColumnKind } from "./columns";
import {
	artistOf,
	coverIdentity,
	FIELD,
	lastPlayedOf,
	numberOf,
	playCountOf,
	titleOf,
	value,
} from "./fields";
import { discNumber } from "./grouping";
import type { LibraryColumns } from "./libraryColumns";
import type { LibrarySource } from "./librarySource";
import type { TrackRows } from "./project";
import { isWritableScale, ratingDisplayOf, rawRatingWith } from "./rating";
import { useWrittenRating } from "./ratingStore";
import styles from "./TrackRow.module.css";
import { RATING_FIELD, useTagWriting } from "./useTagWriter";

function Rating({
	columns,
	row,
	source,
	itemIndex,
}: {
	columns: LibraryColumns;
	row: TrackColumns;
	source: LibrarySource;
	itemIndex: number;
}) {
	const t = useTranslate();
	const { canRateInline, rate, hasWritableAddress } = useTagWriting();
	const written = useWrittenRating(columns, itemIndex);

	const raw = rawRatingWith(row, written);
	const { stars, label } = ratingDisplayOf(raw, t);

	if (
		!canRateInline ||
		!isWritableScale(raw) ||
		!hasWritableAddress(RATING_FIELD, source.addresses(itemIndex))
	)
		return <Stars value={stars} label={label} />;

	return (
		<StarsInput
			value={stars}
			label={label}
			onRate={(next) => rate({ source, ref: itemIndex, columns }, next)}
		/>
	);
}

function shortDate(row: TrackColumns, format: Formats) {
	const played = lastPlayedOf(row);
	if (played === null) return null;
	return format.date(played, { year: "numeric", month: "short" });
}

function cellText(column: Column, row: TrackColumns, format: Formats) {
	switch (column.kind) {
		case "duration": {
			const seconds = numberOf(row, FIELD.duration);
			return seconds === null ? "--" : formatTime(seconds);
		}
		case "playCount": {
			const plays = playCountOf(row) ?? 0;
			return plays === 0 ? "--" : plays;
		}
		case "date":
			return shortDate(row, format) ?? "--";
		case "bitrate":
			return numberOf(row, FIELD.bitrate) ?? "--";
		default: {
			const text = value(row, column.field);
			return (
				(column.kind === "values" && text ? spellValues(text) : text) ?? "--"
			);
		}
	}
}

const PROSE_KINDS: ReadonlySet<ColumnKind> = new Set([
	"text",
	"values",
	"rating",
]);

function GridCell({
	className,
	children,
	...rest
}: {
	className: string;
	children: ReactNode;
	"data-zero"?: boolean;
	"data-inline"?: boolean;
}) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: rows are absolutely positioned by the virtualiser, which table layout cannot express
		// biome-ignore lint/a11y/useFocusableInteractive: the grid holds focus and names the cursor row through aria-activedescendant; a cell never takes it
		<span className={className} role="gridcell" {...rest}>
			{children}
		</span>
	);
}

function Cell({
	column,
	columns,
	row,
	source,
	itemIndex,
}: {
	column: Column;
	columns: LibraryColumns;
	row: TrackColumns;
	source: LibrarySource;
	itemIndex: number;
}) {
	const format = useFormats();
	const plays = column.kind === "playCount" ? (playCountOf(row) ?? 0) : null;

	return (
		<GridCell
			className={classNames(
				styles.cell,
				column.align === "right" && styles.numeric,
				!PROSE_KINDS.has(column.kind) && "tabular",
			)}
			data-zero={plays === null ? undefined : plays === 0}
		>
			{column.kind === "rating" ? (
				<Rating
					columns={columns}
					row={row}
					source={source}
					itemIndex={itemIndex}
				/>
			) : (
				cellText(column, row, format)
			)}
		</GridCell>
	);
}

const stopClick = (event: ReactMouseEvent) => event.stopPropagation();

function TrackRowComponent({
	id,
	rows,
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
	onGripPointerDown,
}: {
	id: string;
	rows: TrackRows;
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
	onGripPointerDown?: (event: ReactPointerEvent) => void;
}) {
	const t = useTranslate();
	const say = useSpoken();
	const row = rows.at(index);
	const title = titleOf(row, t);
	const artist = artistOf(row, t);
	const trackNumber = value(row, FIELD.trackNumber);

	const disc =
		showDisc && trackNumber !== null ? discNumber(row[FIELD.discNumber]) : null;

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
			id={id}
			aria-rowindex={index + 1}
			data-row={index}
			data-active={isActive}
			data-selected={isSelected}
			data-cursor={isCursor}
			data-match={isMatch}
			data-reorderable={onGripPointerDown ? "" : undefined}
			role="row"
			aria-selected={isSelected}
			onPointerDown={(event) => {
				// Secondary click must leave the selection alone, or a multi-track selection is emptied
				// before the context menu about to act on it has opened.
				if (event.button === 0) onSelect(index, event);
			}}
		>
			<GridCell className={`${styles.index} tabular`}>
				{isActive && isPlaying ? (
					<Equalizer label={say("player.nowPlaying")} />
				) : disc !== null ? (
					`${disc}.${trackNumber}`
				) : (
					(trackNumber ?? index + 1)
				)}
			</GridCell>

			{showArtwork ? (
				<Artwork
					src={source.artworkUrl(coverIndex)}
					identity={coverIdentity(row)}
					size={34}
				/>
			) : null}

			<GridCell className={styles.names} data-inline={note !== null}>
				<span className={styles.title}>{title}</span>
				{note === null ? null : <span className={styles.note}>{note}</span>}
				{showArtist ? <span className={styles.artist}>{artist}</span> : null}
			</GridCell>

			{columns.map((column) => (
				<Cell
					key={column.id}
					column={column}
					columns={rows.columns}
					row={row}
					source={source}
					itemIndex={itemIndex}
				/>
			))}

			{onGripPointerDown ? (
				<button
					type="button"
					className={styles.grip}
					aria-label={t("playlist.dragHandle")}
					tabIndex={-1}
					data-owns-touch=""
					onPointerDown={onGripPointerDown}
					onClick={stopClick}
				>
					<GripVertical size={16} strokeWidth={2} aria-hidden="true" />
				</button>
			) : null}
		</div>
	);
}

export const TrackRow = memo(TrackRowComponent);

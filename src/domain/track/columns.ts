import type { Phrase } from "@/shared/i18n/en";
import { FIELD } from "./fields";

export type ColumnLabel = Extract<Phrase, `column.${string}`>;

export type ColumnKind =
	| "text"
	| "duration"
	| "rating"
	| "playCount"
	| "date"
	| "bitrate";

export interface Column {
	id: string;
	label: ColumnLabel;
	width: string;
	compactWidth?: string;
	align?: "right";
	kind: ColumnKind;
	field: number;
}

export const OPTIONAL_COLUMNS: Column[] = [
	{
		id: "duration",
		label: "column.duration",
		width: "4rem",
		compactWidth: "3.25rem",
		align: "right",
		kind: "duration",
		field: FIELD.duration,
	},
	{
		id: "rating",
		label: "column.rating",
		width: "5rem",
		compactWidth: "4.5rem",
		kind: "rating",
		field: FIELD.rating,
	},
	{
		id: "playCount",
		label: "column.playCount",
		width: "3.75rem",
		compactWidth: "2.75rem",
		align: "right",
		kind: "playCount",
		field: FIELD.playCount,
	},
	{
		id: "album",
		label: "column.album",
		width: "minmax(0, 1.4fr)",
		kind: "text",
		field: FIELD.album,
	},
	{
		id: "lastPlayed",
		label: "column.lastPlayed",
		width: "6.5rem",
		kind: "date",
		field: FIELD.lastPlayed,
	},
	{
		id: "year",
		label: "column.year",
		width: "3.25rem",
		align: "right",
		kind: "text",
		field: FIELD.year,
	},
	{
		id: "genre",
		label: "column.genre",
		width: "minmax(0, 1fr)",
		kind: "text",
		field: FIELD.genre,
	},
	{
		id: "codec",
		label: "column.codec",
		width: "4rem",
		kind: "text",
		field: FIELD.codec,
	},
	{
		id: "bitrate",
		label: "column.bitrate",
		width: "4rem",
		align: "right",
		kind: "bitrate",
		field: FIELD.bitrate,
	},
];

export const DEFAULT_COLUMN_IDS = ["duration", "rating", "playCount"];

const COMPACT_PRIORITY = ["duration", "playCount", "rating"];
const COMPACT_MAX_COLUMNS = 2;

const LEADING = {
	number: { width: "2rem", compactWidth: "1.5rem" },
	numberBare: { width: "1.5rem", compactWidth: "1.25rem" },
	numberWithDisc: { width: "2.375rem", compactWidth: "2.25rem" },
	artwork: { width: "34px", compactWidth: "32px" },
	names: { width: "minmax(0, 2fr)", compactWidth: "minmax(6rem, 1fr)" },
};

const widthOf = (
	column: { width: string; compactWidth?: string },
	isCompactViewport: boolean,
) => (isCompactViewport && column.compactWidth) || column.width;

function selectOptional({
	enabledIds,
	isCompactViewport,
	isAvailable,
}: {
	enabledIds: string[];
	isCompactViewport: boolean;
	isAvailable: (field: number) => boolean;
}): Column[] {
	const enabled = OPTIONAL_COLUMNS.filter(
		(column) => enabledIds.includes(column.id) && isAvailable(column.field),
	);

	if (!isCompactViewport) return enabled;

	return COMPACT_PRIORITY.map((id) =>
		enabled.find((column) => column.id === id),
	)
		.filter((column) => column !== undefined)
		.slice(0, COMPACT_MAX_COLUMNS);
}

export function resolveColumns({
	enabledIds,
	showArtwork,
	isCompactViewport,
	isAvailable,
	hasDiscs = false,
}: {
	enabledIds: string[];
	showArtwork: boolean;
	isCompactViewport: boolean;
	isAvailable: (field: number) => boolean;
	hasDiscs?: boolean;
}) {
	const optional = selectOptional({
		enabledIds,
		isCompactViewport,
		isAvailable,
	});

	const leadingNumber = (withArtwork: boolean, withDisc: boolean) =>
		withDisc
			? LEADING.numberWithDisc
			: withArtwork
				? LEADING.number
				: LEADING.numberBare;

	const build = (withArtwork: boolean, withDisc: boolean) =>
		[
			widthOf(leadingNumber(withArtwork, withDisc), isCompactViewport),
			withArtwork ? widthOf(LEADING.artwork, isCompactViewport) : null,
			widthOf(LEADING.names, isCompactViewport),
			...optional.map((column) => widthOf(column, isCompactViewport)),
		]
			.filter((width) => width !== null)
			.join(" ");

	return {
		optional,
		template: build(showArtwork, hasDiscs),
		albumTemplate: build(false, false),
	};
}

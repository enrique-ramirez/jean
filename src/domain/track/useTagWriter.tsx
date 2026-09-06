import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";

import type { TrackColumns, TrackIdentity } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useMediaQuery } from "@/shared/hooks/useMediaQuery";
import { useStoredState } from "@/shared/hooks/useStoredState";
import { pushToast } from "@/shared/ui/toastStore";
import type { LibrarySource } from "./librarySource";
import { clearWrittenRating, setWrittenRating } from "./ratingStore";
import {
	NO_WRITER,
	type TagWriter,
	type TagWriterState,
	tagWriterOf,
	withoutField,
} from "./tagWriter";

// The only field Jean writes, of whatever the component's allowlist names.
export const RATING_FIELD = "rating";

const FIELDS_KEY = "jean.fooJeanFields";

// Unknown names fall through to the tag's own spelling: the component's allowlist may name fields Jean has no label for.
const FIELD_LABELS: Record<string, string> = { rating: "Ratings" };

export const labelOfField = (field: string) =>
	FIELD_LABELS[field.toLowerCase()] ?? field;

export interface RateTarget {
	source: LibrarySource;
	// The ref the source addresses the row by, which is not its position in a filtered view.
	ref: number;
	row: TrackColumns;
}

interface TagWriting {
	state: TagWriterState;
	isChecking: boolean;
	canRate: boolean;
	// Whether the row carries the control, decided by the input device rather than the viewport: a mouse on a narrow window keeps the stars.
	canRateInline: boolean;
	token: string;
	setToken: (token: string) => void;
	allowedFields: string[];
	isFieldEnabled: (field: string) => boolean;
	setFieldEnabled: (field: string, enabled: boolean) => void;
	recheck: () => void;
	rate: (target: RateTarget, stars: number | null) => void;
	// For a track with no row to overlay: the playing one, rated from the now-playing screen or from the keyboard. `label` is only used on failure, and `restore` undoes the caller's own optimistic value on the failures that rule it out -- the same rollback `clearWrittenRating` is for on a row.
	rateTrack: (
		track: TrackIdentity,
		label: string,
		stars: number | null,
		restore: () => void,
	) => void;
}

const IDLE: TagWriting = {
	state: { kind: "absent" },
	isChecking: false,
	canRate: false,
	canRateInline: false,
	token: "",
	setToken: () => {},
	allowedFields: [],
	isFieldEnabled: () => false,
	setFieldEnabled: () => {},
	recheck: () => {},
	rate: () => {},
	rateTrack: () => {},
};

const TagWriterContext = createContext<TagWriting>(IDLE);

export const useTagWriting = () => useContext(TagWriterContext);

// An empty string removes the tag. `"0"` would be a rating of zero.
const tagValueOf = (stars: number | null) =>
	stars === null ? "" : String(stars);

export function TagWriterProvider({ children }: { children: ReactNode }) {
	const { discovery, isChecking, token, setToken, recheck } = useFooJean();
	// Absent means on, so the stored value only records a decision actually made.
	const [fieldPrefs, setFieldPrefs] = useStoredState<Record<string, boolean>>(
		FIELDS_KEY,
		{},
	);
	const hasFinePointer = useMediaQuery("(hover: hover) and (pointer: fine)");

	const resolution = useMemo(() => tagWriterOf(discovery), [discovery]);

	// Fields a 403 has taken off the table for this session.
	const [refused, setRefused] = useState<string[]>([]);

	const permitted = useMemo(
		() => refused.reduce(withoutField, resolution.writer ?? NO_WRITER),
		[resolution, refused],
	);

	// Narrowing only: the component's allowlist is the ceiling, since a client that could widen it would not be bounded by it.
	const writer = useMemo(
		() =>
			permitted.allowedFields
				.filter((field) => fieldPrefs[field.toLowerCase()] === false)
				.reduce(withoutField, permitted),
		[permitted, fieldPrefs],
	);

	const isFieldEnabled = useCallback(
		(field: string) => fieldPrefs[field.toLowerCase()] !== false,
		[fieldPrefs],
	);

	const setFieldEnabled = useCallback(
		(field: string, enabled: boolean) =>
			setFieldPrefs((current) => ({
				...current,
				[field.toLowerCase()]: enabled,
			})),
		[setFieldPrefs],
	);

	// Coalesced per row rather than through `useCoalescedWrite`, which holds one pending value and would lose an edit whenever two rows are rated in turn.
	const pending = useRef(new Map<TrackColumns, RateTarget & { raw: string }>());
	const isWriting = useRef(false);
	const writerRef = useRef(writer);
	writerRef.current = writer;

	const drain = useCallback(async () => {
		if (isWriting.current) return;
		const next = pending.current.entries().next();
		if (next.done) return;

		const [row, target] = next.value;
		pending.current.delete(row);
		isWriting.current = true;

		try {
			await sendRating(target, writerRef.current, setRefused);
		} finally {
			isWriting.current = false;
			// Not guarded on being mounted: a queued write must still drain after the row goes.
			drain();
		}
	}, []);

	const rate = useCallback(
		(target: RateTarget, stars: number | null) => {
			const raw = tagValueOf(stars);
			setWrittenRating(target.row, raw);
			pending.current.set(target.row, { ...target, raw });
			drain();
		},
		[drain],
	);

	const rateTrack = useCallback(
		(
			track: TrackIdentity,
			label: string,
			stars: number | null,
			restore: () => void,
		) => {
			const raw = tagValueOf(stars);
			writerRef.current.write(track, { [RATING_FIELD]: raw }).then((result) => {
				// Success is silent: a rating is a small, reversible act with a visible result.
				if (result.ok) return;

				// A failure names the track, because this path can be reached with the track nowhere on screen.
				if (result.reason === "timeout") {
					// The write may still land, so a timeout keeps the value it wrote, exactly as a row does.
					pushToast({
						message: `${label} may not have been rated. ${result.message}`,
						tone: "error",
					});
					return;
				}

				restore();
				pushToast({
					message: `${label} was not rated. ${result.message}`,
					tone: "error",
				});
			});
		},
		[],
	);

	const value = useMemo<TagWriting>(
		() => ({
			state: resolution.state,
			isChecking,
			canRate: writer.canWrite && writer.allows(RATING_FIELD),
			canRateInline:
				writer.canWrite && writer.allows(RATING_FIELD) && hasFinePointer,
			token,
			setToken,
			// The component's list, not the narrowed one: settings draws a switch per permitted field, including the ones switched off.
			allowedFields: permitted.allowedFields,
			isFieldEnabled,
			setFieldEnabled,
			recheck,
			rate,
			rateTrack,
		}),
		[
			resolution,
			isChecking,
			recheck,
			writer,
			permitted,
			isFieldEnabled,
			setFieldEnabled,
			hasFinePointer,
			token,
			setToken,
			rate,
			rateTrack,
		],
	);

	return (
		<TagWriterContext.Provider value={value}>
			{children}
		</TagWriterContext.Provider>
	);
}

async function sendRating(
	{ source, ref, row, raw }: RateTarget & { raw: string },
	writer: TagWriter,
	refuse: (update: (current: string[]) => string[]) => void,
) {
	const resolved = await source.identify(ref, row).catch(() => null);
	if (!resolved?.identity.path) {
		clearWrittenRating(row);
		pushToast({
			message: "That track has moved. Reload to rate it.",
			tone: "error",
		});
		return;
	}

	const result = await writer.write(resolved.identity, {
		[RATING_FIELD]: raw,
	});

	if (result.ok) {
		// The component echoes what it wrote, normalised.
		setWrittenRating(row, result.written.fields[RATING_FIELD] ?? raw);
		return;
	}

	if (result.reason === "timeout") {
		// The write may still land, so a timeout is never rolled back; ask the player what it ended up with.
		const after = await source
			.identify(ref, row, ["%rating%"])
			.catch(() => null);
		if (after) setWrittenRating(row, after.columns[0] ?? "");
		pushToast({
			message: after
				? "foobar2000 took a while, but the rating is saved."
				: "foobar2000 did not answer. The rating may not have been saved.",
			tone: after ? "default" : "error",
		});
		return;
	}

	clearWrittenRating(row);

	if (result.reason === "not-allowed") {
		// Logged as well as shown: it means the capability check and the component disagree, which is a bug rather than a condition.
		console.error(
			`foo_jean refused '${result.field ?? RATING_FIELD}': ${result.message}`,
		);
		refuse((current) => [...current, result.field ?? RATING_FIELD]);
		pushToast({
			message: "This foobar2000 does not allow ratings to be written.",
			tone: "error",
		});
		return;
	}

	pushToast({
		message:
			result.reason === "unknown-track"
				? "foobar2000 does not know that track, so it was not rated."
				: `The rating was not saved. ${result.message}`,
		tone: "error",
	});
}

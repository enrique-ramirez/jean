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

// The only field this ships, of whatever the component's allowlist names.
export const RATING_FIELD = "rating";

const FIELDS_KEY = "jean.fooJeanFields";

// Unknown names fall through to the tag's own spelling; the allowlist is the
// player owner's to set and may name fields Jean has no label for.
const FIELD_LABELS: Record<string, string> = { rating: "Ratings" };

export const labelOfField = (field: string) =>
	FIELD_LABELS[field.toLowerCase()] ?? field;

export interface RateTarget {
	source: LibrarySource;
	// The ref the source addresses the row by, which is not its position in a
	// filtered view.
	ref: number;
	row: TrackColumns;
}

interface TagWriting {
	state: TagWriterState;
	isChecking: boolean;
	canRate: boolean;
	// Whether the *row* carries the control, which is a question about the input
	// device rather than the viewport: a mouse on a narrow window keeps the stars.
	canRateInline: boolean;
	token: string;
	setToken: (token: string) => void;
	// The component's list. The switches over it are Jean's.
	allowedFields: string[];
	isFieldEnabled: (field: string) => boolean;
	setFieldEnabled: (field: string, enabled: boolean) => void;
	recheck: () => void;
	rate: (target: RateTarget, stars: number | null) => void;
	// For a track with no row anywhere -- the playing one, rated from the
	// now-playing screen or from the keyboard. There is no row array to overlay,
	// so callers that can show the result patch their own store instead.
	// `label` is only ever spoken on failure.
	rateTrack: (
		track: TrackIdentity,
		label: string,
		stars: number | null,
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

// A context rather than a prop: the alternative threads a callback through five
// components to reach one leaf. It never changes while scrolling.
export const useTagWriting = () => useContext(TagWriterContext);

// An empty string removes the tag. `"0"` would be a rating of zero.
const tagValueOf = (stars: number | null) =>
	stars === null ? "" : String(stars);

export function TagWriterProvider({ children }: { children: ReactNode }) {
	// One discovery for the whole app; listening reads the same probe. The token
	// comes with it, because it is the thing the probe is keyed on.
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

	// **Narrowing only.** The component's allowlist is the ceiling; a client able
	// to widen the list bounding it would not be bounded.
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

	// Coalesced *per row*, which is why this is not `useCoalescedWrite`: that
	// holds one pending value, and superseding across rows loses an edit.
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
			// Not guarded on being mounted; see the root CLAUDE.md.
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
		(track: TrackIdentity, label: string, stars: number | null) => {
			const raw = tagValueOf(stars);
			writerRef.current.write(track, { [RATING_FIELD]: raw }).then((result) => {
				// **Success is silent**, and it used to speak. The argument for the
				// toast was that this path has no row to patch optimistically, so
				// nothing on screen would confirm the write -- which was true when the
				// only caller was the keyboard shortcut and false the moment the
				// now-playing screen grew its own stars. There, rating a track drew
				// the new stars *and* threw a toast over the transport, which is the
				// app congratulating itself for doing exactly what was asked.
				//
				// A rating is a small, reversible, one-click act with a visible
				// result. Confirming it is the failure mode toasts are for.
				if (result.ok) return;

				// A failure still speaks, and names the track: this is the one path
				// that can be reached with the track nowhere on screen -- `0`-`5`
				// from a list, or from Home -- so "it did not save" without saying
				// what did not save is unactionable.
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
			// The component's list, not the narrowed one: settings draws a switch per
			// permitted field, including the ones switched off.
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
		// **The write may still land**, so this one is never rolled back. Ask the
		// player what it ended up with instead.
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
		// Logged as well as shown: it means the capability check and the component
		// disagree, which is a bug rather than a condition.
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

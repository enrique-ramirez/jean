import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";

import { useExportHeldWhenLibraryUnbuilt } from "@/domain/player/playerPoll";
import { libraryOrigin, type WriteFailure } from "@/shared/api/fooJean";
import type { TrackAddress } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useMediaQuery } from "@/shared/hooks/useMediaQuery";
import { useStoredState } from "@/shared/hooks/useStoredState";
import { translate } from "@/shared/i18n/locale";
import type { Translate } from "@/shared/i18n/useTranslate";
import { pushToast } from "@/shared/ui/toastStore";
import { FIELD, TRACK_EXPRESSIONS, titleOf } from "./fields";
import { type LibraryColumns, rowAt } from "./libraryColumns";
import { type LibrarySource, libraryAddressesResolve } from "./librarySource";
import { clearWrittenRating, setWrittenRating } from "./ratingStore";
import {
	NO_WRITER,
	type TagWriter,
	type TagWriterState,
	tagWriterOf,
	withoutField,
} from "./tagWriter";

export const RATING_FIELD = "rating";

const FIELDS_KEY = "jean.fooJeanFields";

// A field this install permits that Jean has no name for is drawn as the player spells it, which is
// the only honest thing to call something the component's own configuration invented.
const FIELD_LABELS = { rating: "fooJean.field.rating" } as const;

export function labelOfField(field: string, t: Translate): string {
	const known = FIELD_LABELS[field.toLowerCase() as keyof typeof FIELD_LABELS];
	return known ? t(known) : field;
}

export interface RateTarget {
	source: LibrarySource;
	ref: number;
	columns: LibraryColumns;
}

export interface OptimisticValue {
	adopt: (raw: string) => void;
	confirm: (raw: string) => void;
	restore: () => void;
}

export interface WritableAddress {
	address: TrackAddress;
	retry: TrackAddress | null;
}

interface TagWriting {
	state: TagWriterState;
	isChecking: boolean;
	canRate: boolean;
	canRateInline: boolean;
	allowedFields: string[];
	isFieldEnabled: (field: string) => boolean;
	setFieldEnabled: (field: string, enabled: boolean) => void;
	recheck: () => void;
	hasWritableAddress: (
		field: string,
		forms: readonly TrackAddress[],
	) => boolean;
	writableAddress: (
		field: string,
		forms: readonly TrackAddress[],
	) => WritableAddress | null;
	rate: (target: RateTarget, stars: number | null) => void;
	rateTrack: (
		writable: WritableAddress,
		label: string,
		stars: number | null,
		show: OptimisticValue,
	) => void;
}

const IDLE: TagWriting = {
	state: { kind: "unreachable" },
	isChecking: false,
	canRate: false,
	canRateInline: false,
	allowedFields: [],
	isFieldEnabled: () => false,
	setFieldEnabled: () => {},
	recheck: () => {},
	hasWritableAddress: () => false,
	writableAddress: () => null,
	rate: () => {},
	rateTrack: () => {},
};

const TagWriterContext = createContext<TagWriting>(IDLE);

export const useTagWriting = () => useContext(TagWriterContext);

// An empty string removes the tag. `"0"` would be a rating of zero.
const tagValueOf = (stars: number | null) =>
	stars === null ? "" : String(stars);

const RATING_COLUMN = TRACK_EXPRESSIONS[FIELD.rating];

const didNotLand = (label: string, raw: string) =>
	raw === ""
		? translate("rate.notRemoved", { track: label })
		: translate("rate.didNotLand", { track: label, count: Number(raw) });

async function confirmTimedOutRating(
	writer: TagWriter,
	address: TrackAddress,
	label: string,
	raw: string,
	paint: OptimisticValue,
) {
	const held = await writer.read(address, RATING_COLUMN);
	if (held === null) return;
	if (held === raw) return paint.confirm(raw);

	pushToast({ message: didNotLand(label, raw), tone: "error" });
}

const refusalMessage = (result: WriteFailure, label: string, raw: string) => {
	if (result.reason === "ambiguous") return didNotLand(label, raw);
	if (result.reason === "moved") return translate("rate.moved");
	if (result.reason === "not-allowed") return translate("rate.notAllowed");
	if (result.reason === "unknown-track") return translate("rate.unknownTrack");
	return translate("rate.failed", { label, message: result.message });
};

const addressKey = (address: TrackAddress) => {
	if (address.kind === "library")
		return `library:${address.track}:${address.subsong}`;
	if (address.kind === "ordinal") return `ordinal:${address.ordinal}`;
	return `playlist:${address.playlist}:${address.index}`;
};

interface PendingRating extends WritableAddress {
	key: string;
	label: string;
	raw: string;
	paint: OptimisticValue;
}

export function TagWriterProvider({ children }: { children: ReactNode }) {
	const { discovery, isChecking, recheck } = useFooJean();
	const [fieldPrefs, setFieldPrefs] = useStoredState<Record<string, boolean>>(
		FIELDS_KEY,
		{},
	);
	const hasFinePointer = useMediaQuery("(hover: hover) and (pointer: fine)");

	const resolution = useMemo(() => tagWriterOf(discovery), [discovery]);

	const [refused, setRefused] = useState<string[]>([]);

	const permitted = useMemo(
		() => refused.reduce(withoutField, resolution.writer ?? NO_WRITER),
		[resolution, refused],
	);

	// Narrowing only: the component's allowlist is the ceiling, since a client that could widen it
	// would not be bounded by it.
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

	const origin = libraryOrigin(discovery);
	const exportHeldWhenLibraryUnbuilt = useExportHeldWhenLibraryUnbuilt();

	const hasWritableAddress = useCallback(
		(field: string, forms: readonly TrackAddress[]) => {
			if (!writer.allows(field)) return false;
			const resolves = libraryAddressesResolve(
				origin,
				exportHeldWhenLibraryUnbuilt,
			);
			return forms.some((form) => form.kind === "playlist" || resolves);
		},
		[writer, origin, exportHeldWhenLibraryUnbuilt],
	);

	const writableAddress = useCallback(
		(field: string, forms: readonly TrackAddress[]) => {
			if (!writer.allows(field)) return null;
			const resolves = libraryAddressesResolve(
				origin,
				exportHeldWhenLibraryUnbuilt,
			);
			const usable = forms.filter(
				(form) => form.kind === "playlist" || resolves,
			);
			return usable.length === 0
				? null
				: { address: usable[0], retry: usable[1] ?? null };
		},
		[writer, origin, exportHeldWhenLibraryUnbuilt],
	);

	// Coalesced per address rather than through `useCoalescedWrite`, which holds one pending value and
	// would lose an edit whenever two tracks are rated in turn.
	const pending = useRef<PendingRating[]>([]);
	const isWriting = useRef(false);
	const writerRef = useRef(writer);
	writerRef.current = writer;

	const drain = useCallback(async () => {
		if (isWriting.current) return;
		const write = pending.current.shift();
		if (!write) return;

		isWriting.current = true;
		try {
			await sendRating(write, writerRef.current, setRefused);
		} finally {
			isWriting.current = false;
			drain();
		}
	}, []);

	const queueRating = useCallback(
		(write: PendingRating) => {
			const at = pending.current.findIndex((entry) => entry.key === write.key);
			const queued =
				at < 0 ? write : { ...write, paint: pending.current[at].paint };

			if (at < 0) pending.current.push(queued);
			else pending.current[at] = queued;

			queued.paint.adopt(queued.raw);
			drain();
		},
		[drain],
	);

	const rate = useCallback(
		({ source, ref, columns }: RateTarget, stars: number | null) => {
			const writable = writableAddress(RATING_FIELD, source.addresses(ref));
			if (!writable) return;

			const overlay = (raw: string) => setWrittenRating(columns, ref, raw);

			queueRating({
				...writable,
				key: addressKey(writable.address),
				label: titleOf(rowAt(columns, ref), translate),
				raw: tagValueOf(stars),
				paint: {
					adopt: overlay,
					confirm: overlay,
					restore: () => clearWrittenRating(columns, ref),
				},
			});
		},
		[queueRating, writableAddress],
	);

	const rateTrack = useCallback(
		(
			writable: WritableAddress,
			label: string,
			stars: number | null,
			show: OptimisticValue,
		) =>
			queueRating({
				...writable,
				key: addressKey(writable.address),
				label,
				raw: tagValueOf(stars),
				paint: show,
			}),
		[queueRating],
	);

	const value = useMemo<TagWriting>(
		() => ({
			state: resolution.state,
			isChecking,
			canRate: writer.canWrite && writer.allows(RATING_FIELD),
			canRateInline:
				writer.canWrite && writer.allows(RATING_FIELD) && hasFinePointer,
			// The component's list, not the narrowed one: Settings draws a switch per permitted field,
			// including the ones switched off.
			allowedFields: permitted.allowedFields,
			isFieldEnabled,
			setFieldEnabled,
			recheck,
			hasWritableAddress,
			writableAddress,
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
			hasWritableAddress,
			writableAddress,
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

// `foo_jean` refuses an address two media library roots both hold before it writes anything, so the
// precise address beside it goes instead. Nothing else is ever sent twice: every other refusal
// leaves it open whether the tag was written, and a second write would land on top of a rating
// somebody made in between.
async function writeRating(
	writer: TagWriter,
	{ address, retry }: WritableAddress,
	fields: Record<string, string>,
) {
	const result = await writer.write(address, fields);
	if (result.ok || result.reason !== "ambiguous" || !retry)
		return { sentTo: address, result };

	return { sentTo: retry, result: await writer.write(retry, fields) };
}

async function sendRating(
	{ address, retry, label, raw, paint }: PendingRating,
	writer: TagWriter,
	refuse: (update: (current: string[]) => string[]) => void,
) {
	const { sentTo, result } = await writeRating(
		writer,
		{ address, retry },
		{ [RATING_FIELD]: raw },
	);

	if (result.ok)
		return paint.confirm(result.written.fields[RATING_FIELD] ?? raw);

	if (result.reason === "timeout")
		return confirmTimedOutRating(writer, sentTo, label, raw, paint);

	paint.restore();

	if (result.reason === "not-allowed") {
		console.error(
			`foo_jean refused '${result.field ?? RATING_FIELD}': ${result.message}`,
		);
		refuse((current) => [...current, result.field ?? RATING_FIELD]);
	}

	pushToast({ message: refusalMessage(result, label, raw), tone: "error" });
}

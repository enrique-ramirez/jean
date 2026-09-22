import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";

import type { TrackAddress } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useMediaQuery } from "@/shared/hooks/useMediaQuery";
import { useStoredState } from "@/shared/hooks/useStoredState";
import { translate } from "@/shared/i18n/locale";
import type { Translate } from "@/shared/i18n/useTranslate";
import { pushToast } from "@/shared/ui/toastStore";
import { FIELD, TRACK_EXPRESSIONS, titleOf } from "./fields";
import { type LibraryColumns, rowAt } from "./libraryColumns";
import type { LibrarySource } from "./librarySource";
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

interface TagWriting {
	state: TagWriterState;
	isChecking: boolean;
	canRate: boolean;
	canRateInline: boolean;
	token: string;
	setToken: (token: string) => void;
	allowedFields: string[];
	isFieldEnabled: (field: string) => boolean;
	setFieldEnabled: (field: string, enabled: boolean) => void;
	recheck: () => void;
	rate: (target: RateTarget, stars: number | null) => void;
	rateTrack: (
		address: TrackAddress,
		label: string,
		stars: number | null,
		show: { adopt: (raw: string) => void; restore: () => void },
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

const RATING_COLUMN = TRACK_EXPRESSIONS[FIELD.rating];

async function confirmTimedOutRating(
	writer: TagWriter,
	address: TrackAddress,
	label: string,
	raw: string,
) {
	const held = await writer.read(address, RATING_COLUMN);
	if (held === null || held === raw) return;

	pushToast({
		message: translate("rate.didNotLand", { track: label, stars: Number(raw) }),
		tone: "error",
	});
}

export function TagWriterProvider({ children }: { children: ReactNode }) {
	const { discovery, isChecking, token, setToken, recheck } = useFooJean();
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

	// Coalesced per row rather than through `useCoalescedWrite`, which holds one pending value and
	// would lose an edit whenever two rows are rated in turn.
	const pending = useRef<(RateTarget & { raw: string })[]>([]);
	const isWriting = useRef(false);
	const writerRef = useRef(writer);
	writerRef.current = writer;

	const drain = useCallback(async () => {
		if (isWriting.current) return;
		const target = pending.current.shift();
		if (!target) return;

		isWriting.current = true;
		try {
			await sendRating(target, writerRef.current, setRefused);
		} finally {
			isWriting.current = false;
			drain();
		}
	}, []);

	const rate = useCallback(
		(target: RateTarget, stars: number | null) => {
			const raw = tagValueOf(stars);
			setWrittenRating(target.columns, target.ref, raw);

			const queued = { ...target, raw };
			const at = pending.current.findIndex(
				(entry) =>
					entry.columns.load === target.columns.load &&
					entry.ref === target.ref,
			);
			if (at < 0) pending.current.push(queued);
			else pending.current[at] = queued;

			drain();
		},
		[drain],
	);

	const rateTrack = useCallback(
		(
			address: TrackAddress,
			label: string,
			stars: number | null,
			show: { adopt: (raw: string) => void; restore: () => void },
		) => {
			const raw = tagValueOf(stars);
			const writing = writerRef.current;
			writing.write(address, { [RATING_FIELD]: raw }).then((result) => {
				if (result.ok)
					return show.adopt(result.written.fields[RATING_FIELD] ?? raw);

				if (result.reason === "timeout")
					return confirmTimedOutRating(writing, address, label, raw);

				show.restore();
				pushToast({
					message:
						result.reason === "moved"
							? translate("rate.moved")
							: translate("rate.failed", { label, message: result.message }),
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
			// The component's list, not the narrowed one: Settings draws a switch per permitted field,
			// including the ones switched off.
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
	{ source, ref, columns, raw }: RateTarget & { raw: string },
	writer: TagWriter,
	refuse: (update: (current: string[]) => string[]) => void,
) {
	const address = source.address(ref);
	if (!address) {
		clearWrittenRating(columns, ref);
		return;
	}

	const result = await writer.write(address, { [RATING_FIELD]: raw });

	if (result.ok) {
		setWrittenRating(columns, ref, result.written.fields[RATING_FIELD] ?? raw);
		return;
	}

	if (result.reason === "timeout")
		return confirmTimedOutRating(
			writer,
			address,
			titleOf(rowAt(columns, ref), translate),
			raw,
		);

	clearWrittenRating(columns, ref);

	if (result.reason === "moved") {
		pushToast({
			message: translate("rate.moved"),
			tone: "error",
		});
		return;
	}

	if (result.reason === "not-allowed") {
		console.error(
			`foo_jean refused '${result.field ?? RATING_FIELD}': ${result.message}`,
		);
		refuse((current) => [...current, result.field ?? RATING_FIELD]);
		pushToast({
			message: translate("rate.notAllowed"),
			tone: "error",
		});
		return;
	}

	pushToast({
		message:
			result.reason === "unknown-track"
				? translate("rate.unknownTrack")
				: translate("rate.notSaved", { message: result.message }),
		tone: "error",
	});
}

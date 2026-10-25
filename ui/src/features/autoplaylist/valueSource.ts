import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type {
	ValueField,
	ValueSource,
	ValueWant,
} from "@/domain/library/queryCompletion";
import { LIBRARY_ROLES } from "@/domain/track/libraryAsker";
import { orThrow } from "@/shared/api/client";
import { requireFooJean } from "@/shared/api/discovery";
import {
	type ValueField as AskedField,
	fetchLibraryValues,
	isQueryTooLong,
} from "@/shared/api/libraryQuestions";
import { useDebounced } from "@/shared/hooks/useDebounced";
import { useFormats } from "@/shared/i18n/useTranslate";

const SORTABLE_POOL = 64;

const VALUES_KEPT_MS = 60_000;

const ASKED_FIELD: Record<ValueField, AskedField> = {
	artist: "artist",
	"album artist": "albumArtist",
	album: "album",
	genre: "genre",
};

const NO_VALUES: ValueSource = {
	artist: [],
	"album artist": [],
	album: [],
	genre: [],
};

export function useValueSource(
	origin: string | null,
	structure: number,
	wanted: ValueWant | null,
): ValueSource {
	const { compare } = useFormats();
	const field = useDebounced(wanted?.field ?? null);
	const prefix = useDebounced(wanted?.prefix ?? "");
	const asked = useMemo(
		(): ValueWant | null => (field === null ? null : { field, prefix }),
		[field, prefix],
	);

	const { data } = useQuery({
		queryKey: ["fooJeanValues", origin, structure, asked],
		queryFn: async () => {
			const { field, prefix } = asked as ValueWant;
			const answer = orThrow(
				await fetchLibraryValues(requireFooJean(origin), LIBRARY_ROLES, {
					field: ASKED_FIELD[field],
					prefix,
					limit: SORTABLE_POOL,
				}),
			);
			if (!("values" in answer)) throw new Error("the library is not ready");
			return { field, values: answer.values };
		},
		enabled: Boolean(origin) && asked !== null && !isQueryTooLong(asked.prefix),
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: VALUES_KEPT_MS,
		refetchOnWindowFocus: false,
		placeholderData: keepPreviousData,
	});

	return useMemo(
		() =>
			data
				? { ...NO_VALUES, [data.field]: [...data.values].sort(compare) }
				: NO_VALUES,
		[data, compare],
	);
}

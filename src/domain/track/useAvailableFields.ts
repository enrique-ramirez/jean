import { useCallback, useMemo } from "react";

import type { TrackColumns } from "@/shared/api/types";

import { FIELD, fieldIsAvailable } from "./fields";

// The capability probe: a field the player cannot resolve returns '?' on every row, so what an install supports is read off the rows rather than from a list Jean would have to maintain.
export function useAvailableFields(rows: TrackColumns[]) {
	const available = useMemo(() => {
		const fields = new Set(
			Object.values(FIELD).filter((field) => fieldIsAvailable(rows, field)),
		);

		// Never hidden, for any reason: a library with no ratings yet still needs the column to rate through.
		fields.add(FIELD.rating);

		return fields;
	}, [rows]);

	const isAvailable = useCallback(
		(field: number) => available.has(field),
		[available],
	);

	return { isAvailable, hasPlayCounts: available.has(FIELD.playCount) };
}

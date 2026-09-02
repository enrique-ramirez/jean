import { useCallback, useMemo } from "react";

import type { TrackColumns } from "@/shared/api/types";

import { FIELD, fieldIsAvailable } from "./fields";

// The capability probe: a field the player cannot resolve returns '?' on every
// row, so what a given install supports is read off the rows themselves rather
// than from a component list we would have to maintain.
export function useAvailableFields(rows: TrackColumns[]) {
	const available = useMemo(() => {
		const fields = new Set(
			Object.values(FIELD).filter((field) => fieldIsAvailable(rows, field)),
		);

		// **Never hidden, for any reason.** It used to be gated on there being a
		// rating somewhere in the view; see `domain/track/CLAUDE.md` for why that
		// was wrong and must not come back.
		fields.add(FIELD.rating);

		return fields;
	}, [rows]);

	const isAvailable = useCallback(
		(field: number) => available.has(field),
		[available],
	);

	return { isAvailable, hasPlayCounts: available.has(FIELD.playCount) };
}

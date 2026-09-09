import { useCallback, useMemo } from "react";

import type { TrackColumns } from "@/shared/api/types";

import { FIELD, fieldIsAvailable } from "./fields";

export function useAvailableFields(rows: TrackColumns[]) {
	const available = useMemo(() => {
		const fields = new Set(
			Object.values(FIELD).filter((field) => fieldIsAvailable(rows, field)),
		);

		// Never hidden: a library with no ratings yet still needs the column to rate through.
		fields.add(FIELD.rating);

		return fields;
	}, [rows]);

	const isAvailable = useCallback(
		(field: number) => available.has(field),
		[available],
	);

	return { isAvailable, hasPlayCounts: available.has(FIELD.playCount) };
}

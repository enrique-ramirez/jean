import { useCallback, useMemo } from "react";

import { FIELD, resolvesAnywhere } from "./fields";
import type { LibraryColumns } from "./libraryColumns";

export function useAvailableFields(columns: LibraryColumns) {
	const available = useMemo(() => {
		const fields = new Set(
			Object.values(FIELD).filter((field) => resolvesAnywhere(columns, field)),
		);

		// Never hidden: a library with no ratings yet still needs the column to rate through.
		fields.add(FIELD.rating);

		return fields;
	}, [columns]);

	const isAvailable = useCallback(
		(field: number) => available.has(field),
		[available],
	);

	return { isAvailable, hasPlayCounts: available.has(FIELD.playCount) };
}

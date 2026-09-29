import { type FuzzyKey, fuzzyScore, squash } from "@/shared/lib/text";

// An artist, an album or a genre: something a query might *name*, as against a track it might merely
// match. `trackCount` is how much of it the library holds.
export interface Entity {
	match: FuzzyKey;
	trackCount: number;
}

/**
 * The entities a query plausibly *names*, best first. The floor is what keeps a section honest: a list
 * of two shows two things however badly the second scored, so sorting alone cannot decide whether the
 * query is about an artist at all. Below a whole-word match, `blood` offers `youngbloodz` above two
 * hundred songs with the word in their titles.
 *
 * Entities take the whole ladder, unlike tracks: a track was filtered on the token before it was
 * ranked, so it can never reach the rungs that catch a typo, and an artist was not.
 */
export function rankEntities<T extends Entity>(
	entities: T[],
	query: string,
	floor: number,
): T[] {
	const squashed = squash(query);
	if (squashed.length === 0) return [];

	return (
		entities
			.map((entity) => ({
				entity,
				score: fuzzyScore(entity.match, squashed, floor),
			}))
			.filter((scored) => scored.score >= floor)
			// Then by how much of them the library holds: at the same rung, the one you own more of is
			// more likely the one meant.
			.sort(
				(a, b) =>
					b.score - a.score || b.entity.trackCount - a.entity.trackCount,
			)
			.map((scored) => scored.entity)
	);
}

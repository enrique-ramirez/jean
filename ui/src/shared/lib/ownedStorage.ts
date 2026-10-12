const OWNED_PREFIX = "jean.";

export function clearOwnedKeys(
	storage: Storage,
	kept: readonly string[] = [],
): void {
	const owned = Array.from(
		{ length: storage.length },
		(_, index) => storage.key(index) ?? "",
	).filter((key) => key.startsWith(OWNED_PREFIX) && !kept.includes(key));

	for (const key of owned) storage.removeItem(key);
}

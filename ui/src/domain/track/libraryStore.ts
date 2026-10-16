export const LIBRARY_FORMAT = 1;

export interface StoreKey {
	declaration: readonly string[];
	format: number;
	apiVersion: number;
	build: string;
}

export interface LibraryPair {
	snapshotId: string;
	trackCount: number;
	structure: number;
	revision: number;
}

export interface StoredLibrary extends LibraryPair {
	key: StoreKey;
}

export type ReloadPlan =
	| { kind: "export" }
	| { kind: "draw"; structure: number; revision: number }
	| { kind: "delta"; structure: number; since: number };

const sameDeclaration = (
	stored: readonly string[],
	declared: readonly string[],
) => {
	const held = new Set(stored);
	return held.size === declared.length && declared.every((c) => held.has(c));
};

export const sameKey = (stored: StoreKey, key: StoreKey) =>
	stored.format === key.format &&
	stored.apiVersion === key.apiVersion &&
	stored.build === key.build &&
	sameDeclaration(stored.declaration, key.declaration);

export const MAX_KEPT_CHANGES = 64;

export function reloadPlan(
	stored: StoredLibrary | null,
	key: StoreKey,
	now: LibraryPair,
): ReloadPlan {
	if (!stored || !sameKey(stored.key, key)) return { kind: "export" };

	if (
		stored.snapshotId === now.snapshotId &&
		stored.trackCount === now.trackCount &&
		stored.structure === now.structure &&
		stored.revision === now.revision
	)
		return { kind: "draw", structure: now.structure, revision: now.revision };

	return { kind: "delta", structure: stored.structure, since: stored.revision };
}

export type StoredKind = "load" | "part" | "partPatch" | "delta" | "splice";

export interface StoredEvent {
	kind: StoredKind;
	bytes: ArrayBuffer;
}

export interface KeepNote extends LibraryPair {
	declaration: readonly string[];
	format: number;
	apiVersion: number;
	isWhole: boolean;
}

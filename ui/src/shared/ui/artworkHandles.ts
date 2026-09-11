const handles = new Map<string, { url: string; refs: number }>();

const share = (key: string, blob: Blob) => {
	const held = handles.get(key);
	if (held) {
		held.refs += 1;
		return held.url;
	}

	const url = URL.createObjectURL(blob);
	handles.set(key, { url, refs: 1 });
	return url;
};

/** A claim on a picture somebody already fetched, or null. Every caller that takes one MUST drop it. */
export function heldArtwork(key: string): string | null {
	const held = handles.get(key);
	if (!held) return null;

	held.refs += 1;
	return held.url;
}

/** The address to point an `<img>` at, and a claim on it. `key` is which picture, not where it lives. */
export const holdArtwork = async (key: string, read: () => Promise<Blob>) =>
	heldArtwork(key) ?? share(key, await read());

export function dropArtwork(key: string) {
	const held = handles.get(key);
	if (!held) return;

	held.refs -= 1;
	if (held.refs > 0) return;

	handles.delete(key);
	URL.revokeObjectURL(held.url);
}

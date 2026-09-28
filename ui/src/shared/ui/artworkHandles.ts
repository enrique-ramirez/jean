// A browser's IntersectionObserver does not notify the instant `.observe()` is called: the first
// report for a freshly observed element rides the render step, which can trail the call by more than
// one animation frame, so a microtask-length grace period is not enough to outlast it. 50ms is an
// empirical margin against that lag, not a value derived from it.
const DROP_DELAY_MS = 50;

interface Held {
	url: string;
	refs: number;
	expiry: ReturnType<typeof setTimeout> | null;
}

const handles = new Map<string, Held>();

const cancelExpiry = (held: Held) => {
	if (held.expiry === null) return;
	clearTimeout(held.expiry);
	held.expiry = null;
};

const share = (key: string, blob: Blob) => {
	const held = handles.get(key);
	if (held) {
		held.refs += 1;
		cancelExpiry(held);
		return held.url;
	}

	// `createObjectURL` mints a new handle per call, never one shared per blob.
	const url = URL.createObjectURL(blob);
	handles.set(key, { url, refs: 1, expiry: null });
	return url;
};

/** A claim on a picture somebody already fetched, or null. Every caller that takes one MUST drop it. */
export function heldArtwork(key: string): string | null {
	const held = handles.get(key);
	if (!held) return null;

	held.refs += 1;
	cancelExpiry(held);
	return held.url;
}

/** The address to point an `<img>` at, and a claim on it. `key` is which picture, not where it lives. */
export const holdArtwork = async (key: string, read: () => Promise<Blob>) =>
	heldArtwork(key) ?? share(key, await read());

// The surface showing a picture can change in the same React commit as the one dropping it: closing
// one `<Artwork>` and opening another on the same key runs the outgoing cleanup before the incoming
// effect, and the incoming side's own claim can land later still, behind the delay above. A drop to
// zero is deferred rather than acted on so a claim arriving before the timer fires wins the handle
// back; `cancelExpiry` above is that win.
export function dropArtwork(key: string) {
	const held = handles.get(key);
	if (!held) return;

	held.refs -= 1;
	if (held.refs > 0) return;

	held.expiry = setTimeout(() => {
		if (held.refs > 0) return;
		handles.delete(key);
		URL.revokeObjectURL(held.url);
	}, DROP_DELAY_MS);
}

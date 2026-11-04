// A portable install can report a file's canonical path as `file-relative://`, which this reads as
// a stream; whether the player does that is still to be checked against a real one.
export const isStreamPath = (path: string | null | undefined) =>
	path?.includes("://") ?? false;

export const fileKey = (path: string, subsong: number) => `${path}:${subsong}`;

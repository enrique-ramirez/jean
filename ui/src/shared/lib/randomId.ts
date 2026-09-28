// A browser offers `crypto.randomUUID` only in a secure context; `getRandomValues` has no such limit.
export const randomId = () => {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
};

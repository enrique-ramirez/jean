import { readStoredState } from "@/shared/hooks/useStoredState";

// What this device calls itself when it listens, so the picker on somebody's phone can say who else has the sound.

// Per device and never synced; the root CLAUDE.md holds that list.
export const DEVICE_ID_KEY = "jean.deviceId";
export const DEVICE_NAME_KEY = "jean.deviceName";

// ---- the id ------------------------------------------------------------------

// `crypto.randomUUID` is secure-context only, and Jean is served over plain HTTP from beefweb on a LAN, so it is routinely absent. `getRandomValues` is not restricted that way.
const randomId = () => {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
};

let id: string | null = null;

// Stable for as long as this browser keeps its storage, which is what makes a reconnect the same listener rather than a new one. Never derived from anything about the person.
export function deviceId(): string {
	if (id) return id;

	try {
		id = localStorage.getItem(DEVICE_ID_KEY);
		if (!id) {
			id = randomId();
			localStorage.setItem(DEVICE_ID_KEY, id);
		}
	} catch {
		// Private mode: a fresh id per page load, which reports one device as several rather than refusing to listen.
		id ??= randomId();
	}

	return id;
}

// ---- the name ----------------------------------------------------------------

// A browser cannot learn the name of the machine it runs on. There is no API for it, so this guesses at the *kind* of device and Settings is where anyone who cares writes "Kitchen speaker" instead.
// That is what separates it from the user-agent detection this codebase does not do: nothing branches on this. Detection that picks behaviour is banned because a wrong answer breaks the feature silently; a label is wrong in a way its owner can see and fix in one field.

interface ClientHints {
	platform?: string;
	mobile?: boolean;
}

const hints = (): ClientHints | undefined =>
	(navigator as Navigator & { userAgentData?: ClientHints }).userAgentData;

export function defaultDeviceName(): string {
	const reported = hints();

	if (reported?.platform) {
		switch (reported.platform) {
			case "Android":
				return reported.mobile ? "Android phone" : "Android tablet";
			case "Chrome OS":
				return "Chromebook";
			case "macOS":
				return "Mac";
			case "Windows":
				return "Windows PC";
			case "Linux":
				return "Linux PC";
		}
	}

	// Safari and Firefox publish no client hints, and `navigator.platform` is what is left. Deprecated, present everywhere, and read here for a word rather than for a decision.
	const platform = navigator.platform ?? "";
	const touch = navigator.maxTouchPoints ?? 0;

	if (platform.includes("iPhone")) return "iPhone";
	// An iPad reports itself as a Mac, and the touch points are the only thing that tells them apart.
	if (platform.includes("iPad") || (platform.includes("Mac") && touch > 1))
		return "iPad";
	if (platform.includes("Mac")) return "Mac";
	if (platform.includes("Win")) return "Windows PC";
	if (platform.includes("Linux") || platform.includes("X11"))
		return touch > 1 ? "Android phone" : "Linux PC";

	return "Browser";
}

// Read outside React by the connection, and through `useStoredState` by Settings, which is why it goes through the one store rather than straight to `localStorage`.
export const deviceName = () =>
	readStoredState(DEVICE_NAME_KEY, defaultDeviceName);

// What the component is told when a ticket is asked for. The name is a label and the id is what groups this device's connections.
export const deviceIdentity = () => ({
	deviceId: deviceId(),
	name: deviceName(),
});

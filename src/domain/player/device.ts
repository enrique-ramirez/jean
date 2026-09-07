import { readStoredState } from "@/shared/hooks/useStoredState";
import { translate } from "@/shared/i18n/locale";

export const DEVICE_ID_KEY = "jean.deviceId";
export const DEVICE_NAME_KEY = "jean.deviceName";

// `crypto.randomUUID` is secure-context only, and Jean is routinely served over plain HTTP on a LAN.
// `getRandomValues` is not restricted that way.
const randomId = () => {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
};

let id: string | null = null;

export function deviceId(): string {
	if (id) return id;

	try {
		id = localStorage.getItem(DEVICE_ID_KEY);
		if (!id) {
			id = randomId();
			localStorage.setItem(DEVICE_ID_KEY, id);
		}
	} catch {
		id ??= randomId();
	}

	return id;
}

// A browser cannot learn the name of the machine it runs on, so this guesses at the kind of device
// and Settings is where anyone who cares writes something better. Nothing branches on the answer,
// which is what separates it from the user-agent detection this codebase does not do.

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
				return translate(
					reported.mobile ? "device.androidPhone" : "device.androidTablet",
				);
			case "Chrome OS":
				return translate("device.chromebook");
			case "macOS":
				return translate("device.mac");
			case "Windows":
				return translate("device.windows");
			case "Linux":
				return translate("device.linux");
		}
	}

	// Safari and Firefox publish no client hints, so `navigator.platform` is what is left.
	const platform = navigator.platform ?? "";
	const touch = navigator.maxTouchPoints ?? 0;

	if (platform.includes("iPhone")) return "iPhone";
	// An iPad reports itself as a Mac, and the touch points are the only thing that tells them apart.
	if (platform.includes("iPad") || (platform.includes("Mac") && touch > 1))
		return "iPad";
	if (platform.includes("Mac")) return translate("device.mac");
	if (platform.includes("Win")) return translate("device.windows");
	if (platform.includes("Linux") || platform.includes("X11"))
		return translate(touch > 1 ? "device.androidPhone" : "device.linux");

	return translate("device.browser");
}

export const deviceName = () =>
	readStoredState(DEVICE_NAME_KEY, defaultDeviceName);

export const deviceIdentity = () => ({
	deviceId: deviceId(),
	name: deviceName(),
});

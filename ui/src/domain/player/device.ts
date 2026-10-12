import {
	readStoredState,
	writeStoredState,
} from "@/shared/hooks/useStoredState";
import { translate } from "@/shared/i18n/locale";
import { randomId } from "@/shared/lib/randomId";

const DEVICE_ID_KEY = "jean.deviceId";
export const DEVICE_NAME_KEY = "jean.deviceName";

let id: string | null = null;

export function deviceId(): string {
	if (id) return id;

	id = readStoredState<string | null>(DEVICE_ID_KEY, null);
	if (!id) {
		id = randomId();
		writeStoredState(DEVICE_ID_KEY, id);
	}
	return id;
}

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

const deviceName = () => readStoredState(DEVICE_NAME_KEY, defaultDeviceName);

export const deviceIdentity = () => ({
	deviceId: deviceId(),
	name: deviceName(),
});

import { permitsPlaybackControl } from "@/shared/api/discovery";
import { useFooJean } from "@/shared/hooks/useFooJean";
import type { Translate } from "@/shared/i18n/locale";
import { useInSession } from "./session";

// `foo_jean` refuses a command for `controlPlayback` only on the player's own session, never on a
// detached one.
export function useCanControlPlayback(): boolean {
	const { discovery } = useFooJean();
	const inSession = useInSession();
	return inSession || permitsPlaybackControl(discovery);
}

export const whenControllable = (
	canControl: boolean,
	onClick: (() => void) | undefined,
	name: string,
	t: Translate,
) =>
	canControl
		? { onClick }
		: {
				"aria-disabled": "true" as const,
				"aria-label": t("player.controlOffName", { control: name }),
			};

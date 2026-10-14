import { permitsPlaybackControl } from "@/shared/api/discovery";
import { useFooJean } from "@/shared/hooks/useFooJean";
import type { Phrase } from "@/shared/i18n/en";
import type { Translate } from "@/shared/i18n/locale";
import { type ConnectionState, useConnection } from "./connection";
import { useInSession } from "./session";

export type PlaybackRefusal = Extract<
	Phrase,
	"player.controlOffName" | "player.unreachableName" | "player.unresponsiveName"
>;

const REFUSAL_WHILE: Record<
	Exclude<ConnectionState, "connected">,
	PlaybackRefusal
> = {
	reconnecting: "player.unreachableName",
	stillReconnecting: "player.unreachableName",
	playerUnresponsive: "player.unresponsiveName",
};

// `foo_jean` refuses a command for `controlPlayback` only on the player's own session, never on a
// detached one.
export function useCanControlPlayback(): boolean {
	const { discovery } = useFooJean();
	const inSession = useInSession();
	return inSession || permitsPlaybackControl(discovery);
}

export function usePlaybackRefusal(): PlaybackRefusal | null {
	const canControl = useCanControlPlayback();
	const connection = useConnection();
	if (!canControl) return "player.controlOffName";
	return connection === "connected" ? null : REFUSAL_WHILE[connection];
}

export const refusalUnless = (canControl: boolean): PlaybackRefusal | null =>
	canControl ? null : "player.controlOffName";

export const refusedName = (
	refusal: PlaybackRefusal | null,
	name: string,
	t: Translate,
) => (refusal === null ? name : t(refusal, { control: name }));

export const whenAllowed = (
	refusal: PlaybackRefusal | null,
	onClick: (() => void) | undefined,
	name: string,
	t: Translate,
) =>
	refusal === null
		? { onClick }
		: {
				"aria-disabled": "true" as const,
				"aria-label": refusedName(refusal, name, t),
			};

export const whenControllable = (
	canControl: boolean,
	onClick: (() => void) | undefined,
	name: string,
	t: Translate,
) => whenAllowed(refusalUnless(canControl), onClick, name, t);

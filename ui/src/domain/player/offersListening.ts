import { useStoredState } from "@/shared/hooks/useStoredState";
import { useInSession } from "./session";
import { usePlayer } from "./usePlayer";

export const useOffersListeningWhenSilent = () =>
	useStoredState("jean.offerListening", true);

export function useIsListeningOfferedFirst(isOn: boolean): boolean {
	const [offers] = useOffersListeningWhenSilent();
	const inSession = useInSession();
	const { data: snapshot } = usePlayer();
	return (
		offers && !isOn && !inSession && snapshot?.player?.outputSilent === true
	);
}

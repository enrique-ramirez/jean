import type { PollFollower } from "@/domain/player/playerPoll";
import { libraryEvents } from "./libraryHolds";

export const libraryPollFollower: PollFollower = {
	answered: libraryEvents.answered,
	libraryAnnounced: (origin, library) =>
		libraryEvents.announced(origin, library),
};

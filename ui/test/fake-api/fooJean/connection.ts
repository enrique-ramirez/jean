import { json, type Responder } from "../http.ts";
import { notFound } from "./answers.ts";
import type { FooJeanFake } from "./options.ts";
import { playbackModesOf } from "./playbackModes.ts";
import type { Asked } from "./request.ts";

const capabilitiesAbandoned = (fake: FooJeanFake, response: Responder) =>
	new Promise<boolean>((resolve) => {
		fake.capabilitiesHeld.push(() => resolve(false));
		response.on("close", () => resolve(true));
	});

export const offersStream = (fake: FooJeanFake) =>
	fake.canStream && fake.streamFormats.length > 0;

// `canCreateSessions` in `contract/openapi.yaml`: it says nothing about a free place.
export const createsSessions = (fake: FooJeanFake) =>
	fake.canCreateSessions && fake.maxSessions > 0 && offersStream(fake);

export async function handleConnection({ state, fake, path, response }: Asked) {
	if (path === "/api/status") {
		return json(response, {
			name: fake.name,
			version: fake.version,
			apiVersion: fake.apiVersion,
		});
	}

	if (path === "/api/capabilities") {
		if (fake.hangCapabilities && (await capabilitiesAbandoned(fake, response)))
			return true;
		return json(response, {
			apiVersion: fake.apiVersion,
			allowedFields: fake.allowedFields,
			canWrite: fake.allowedFields.length > 0,
			maxAutoPlaylists: fake.maxAutoPlaylists,
			canCreateAutoPlaylists:
				fake.canWritePlaylists !== false && fake.maxAutoPlaylists > 0,
			canReadLibrary: fake.canReadLibrary,
			canStream: offersStream(fake),
			canMuteWhileStreaming: fake.canMuteWhileStreaming,
			canChangeOutput: fake.canChangeOutput,
			canControlPlayback: fake.canControlPlayback,
			playerName: state.player.info.name,
			playerVersion: state.player.info.version,
			volumeMin: state.player.volume.min,
			volumeMax: state.player.volume.max,
			volumeUnit: state.player.volume.type,
			playbackModes: playbackModesOf(state),
			streamFormats: fake.streamFormats,
			maxSessions: fake.maxSessions,
			canCreateSessions: createsSessions(fake),
			...(fake.canWritePlaylists === "absent"
				? null
				: { canWritePlaylists: fake.canWritePlaylists }),
		});
	}

	return notFound(response);
}

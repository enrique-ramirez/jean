import type { RequestHeaders, Responder } from "../http.ts";
import type { ArtworkServer } from "../routes.ts";
import type { DetachedSession } from "../sessions.ts";
import type { createState, RecordedRequest } from "../state.ts";
import type { FooJeanFake } from "./options.ts";

export type FakeState = ReturnType<typeof createState>;

export interface Asked {
	state: FakeState;
	fake: FooJeanFake;
	method: string;
	path: string;
	url: URL;
	headers: RequestHeaders;
	body: unknown;
	bodyBytes: number;
	response: Responder;
	recorded: RecordedRequest;
	named: string;
	namesDetached: boolean;
	session: DetachedSession | null;
	addressed: DetachedSession | FakeState;
	artwork: ArtworkServer;
}

export type AskedBeforeItsSession = Omit<Asked, "session" | "addressed">;

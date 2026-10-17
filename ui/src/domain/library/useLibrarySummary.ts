import { useSyncExternalStore } from "react";
import { FIELD, TRACK_EXPRESSIONS } from "@/domain/track/fields";
import type { LibrarySummary, SummaryRoles } from "@/shared/api/librarySummary";
import { type Subscribers, subscribers } from "@/shared/lib/store";
import type { Library } from "./useLibrary";

const expressionOf = (field: number) => TRACK_EXPRESSIONS[field];

export const SUMMARY_ROLES: SummaryRoles = {
	trackNumber: expressionOf(FIELD.trackNumber),
	discNumber: expressionOf(FIELD.discNumber),
	title: expressionOf(FIELD.title),
	artist: expressionOf(FIELD.artist),
	album: expressionOf(FIELD.album),
	albumArtist: expressionOf(FIELD.albumArtist),
	duration: expressionOf(FIELD.duration),
	playCount: expressionOf(FIELD.playCount),
	lastPlayed: expressionOf(FIELD.lastPlayed),
	rating: expressionOf(FIELD.rating),
	year: expressionOf(FIELD.year),
	genre: expressionOf(FIELD.genre),
	codec: expressionOf(FIELD.codec),
	bitrate: expressionOf(FIELD.bitrate),
	playCountLocal: expressionOf(FIELD.playCountLocal),
	lastPlayedLocal: expressionOf(FIELD.lastPlayedLocal),
	added: expressionOf(FIELD.added),
};

interface Held {
	summary: LibrarySummary | null;
	listeners: Subscribers;
}

const held = new Map<string, Held>();

const heldFor = (origin: string) => {
	let one = held.get(origin);
	if (!one) {
		one = { summary: null, listeners: subscribers() };
		held.set(origin, one);
	}
	return one;
};

export const summaryOf = (origin: string) => held.get(origin)?.summary ?? null;

export const subscribeSummary = (origin: string, listener: () => void) =>
	heldFor(origin).listeners.subscribe(listener);

export function keepSummary(origin: string, summary: LibrarySummary) {
	const one = heldFor(origin);
	one.summary = summary;
	one.listeners.notify();
}

export const atStructure = (
	summary: LibrarySummary | null,
	structure: number,
) => (summary?.structure === structure ? summary : null);

const NOTHING = () => () => {};

export function useLibrarySummary({ origin }: Pick<Library, "origin">) {
	return useSyncExternalStore(
		origin ? (listener) => subscribeSummary(origin, listener) : NOTHING,
		() => (origin ? summaryOf(origin) : null),
	);
}

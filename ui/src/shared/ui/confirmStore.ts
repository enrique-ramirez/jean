import { useSyncExternalStore } from "react";
import { subscribers } from "@/shared/lib/store";

export interface Question {
	title: string;
	body: string;
	confirm: string;
	decline: string;
}

interface Asked {
	question: Question;
	answer: (confirmed: boolean) => void;
}

const listeners = subscribers();

let asked: Asked[] = [];

export function askToConfirm(question: Question): Promise<boolean> {
	return new Promise((resolve) => {
		asked = [...asked, { question, answer: resolve }];
		listeners.notify();
	});
}

export function answerConfirmation(confirmed: boolean) {
	const [first, ...rest] = asked;
	if (!first) return;
	asked = rest;
	listeners.notify();
	first.answer(confirmed);
}

const snapshot = () => asked[0]?.question ?? null;

export const useConfirmation = () =>
	useSyncExternalStore(listeners.subscribe, snapshot);

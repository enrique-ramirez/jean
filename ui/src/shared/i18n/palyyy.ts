const MAY_INDEX = 4;
const TENTH = 10;

const PLAY = /\b(p)lay(s|ed|ing)?\b/gi;
const AFTER_THE_P = "alyyy";

export const isPalyyyDay = (): boolean => {
	const today = new Date();
	return today.getMonth() === MAY_INDEX && today.getDate() === TENTH;
};

export const respelled = (text: string): string =>
	text.replace(
		PLAY,
		(_, first: string, suffix: string = "") =>
			`${first}${AFTER_THE_P}${suffix}`,
	);

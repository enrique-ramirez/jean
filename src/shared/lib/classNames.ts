// Joins the class names a component ends up with, dropping whatever a condition left out.
export const classNames = (...names: (string | false | null | undefined)[]) =>
	names.filter(Boolean).join(" ");

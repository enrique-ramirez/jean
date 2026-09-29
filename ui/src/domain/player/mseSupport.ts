export const MSE_MIME = 'audio/webm; codecs="opus"';

export const canUseMse = () =>
	typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(MSE_MIME);

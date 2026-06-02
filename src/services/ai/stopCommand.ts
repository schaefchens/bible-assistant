// Voice/text phrases that map to "stop everything happening right now".
// Normalized to lower-case and trimmed of trailing punctuation before lookup.
const STOP_PHRASES = new Set([
  // English
  'stop',
  'stop it',
  'stop now',
  'stop reading',
  'stop playing',
  'stop playback',
  'cancel',
  'cancel that',
  'halt',
  'quiet',
  'silence',
  'be quiet',
  'shut up',
  'enough',
  'quit',
  'end',
  // German
  'stopp',
  'stoppen',
  'halt an',
  'anhalten',
  'ruhe',
  'leise',
  'still',
  'abbrechen',
  'ende',
  'aufhören',
  'hör auf',
  'hör auf damit',
  'hör bitte auf',
]);

/** True when the user's utterance is a bare "stop" command (in EN or DE),
 * which should short-circuit the pipeline and kill all activity rather than
 * be sent to the model. */
export function isStopCommand(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[.!?,]+$/g, '').trim();
  return STOP_PHRASES.has(normalized);
}

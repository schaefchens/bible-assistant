import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCommunityStore } from '@/store/communityStore';
import { parseSpaceCodeInput } from '@/lib/spaceCode';

/**
 * Add a space from a code someone gave you.
 *
 * **In the header, left of "new space"**, because it used to sit at the bottom
 * of the list of spaces you already read — which is exactly where nobody looks
 * for the way in. Being handed a code is the most common reason to open this
 * screen at all, so it is now the first thing on it.
 *
 * **There is no button.** `parseSpaceCodeInput` already answers "is this a
 * code yet?" on every keystroke, so the field submits itself the moment the
 * answer is yes — which is the moment a paste lands, and paste is how a code
 * arrives. A button would only be a second thing to hit after the one action
 * that mattered, and in this header it was the width that didn't fit an
 * iPhone SE.
 *
 * Typing one out by hand submits on the same rule, at the last character.
 * `submittedRef` is what keeps that from firing twice while the request is in
 * flight and the field still holds the text.
 *
 * Deliberately the plainest possible input, following `RecoverPassphrase`'s
 * pattern for the other pasted secret in this app: monospace, no autocorrect,
 * no capitalisation, and normalisation on submit rather than as you type.
 *
 * It accepts more than a code — a link in either shape, or the whole message
 * the sender's share sheet produced — because that is what people actually
 * paste. In a header there is no room to say so permanently, so the hint
 * appears while the field is focused (and stays for an error), which is when
 * it is any use.
 *
 * The error cases are worth reading. `key_mismatch` means the key the server
 * returned does not match the fingerprint carried in the code — so either the
 * code was altered on its way here or the server is offering a different
 * author. There is no benign reading of that, so it is a hard failure with a
 * plain-language message, never a warning to click through.
 */
export function SubscribeField() {
  const { t } = useTranslation();
  const subscribe = useCommunityStore((s) => s.subscribe);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  /** The last text handed to `subscribe`, so the self-submit can't fire twice
   * for the same code while the request is still running. */
  const submittedRef = useRef<string | null>(null);

  const submit = async (raw: string) => {
    if (busy || raw.trim() === '') return;
    submittedRef.current = raw;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await subscribe(raw);
      // Cleared on success, because the code has done its job and a header
      // field still holding it looks like it didn't work.
      setCode('');
      setStatus(result === 'accepted' ? t('community.addByCodeAdded') : t('community.pending'));
      window.setTimeout(() => setStatus(null), 4000);
    } catch (e) {
      // ApiError's message is api.php's `error` string, so a reason the server
      // gave (space_not_ready, profile_required) lands here alongside the ones
      // the client raises itself.
      const key = e instanceof Error ? e.message : 'failed';
      const known = [
        'invalid_code',
        'key_mismatch',
        'profile_required',
        'space_not_ready',
        // Raised by the store before it touches the network: the content
        // standards have not been accepted, this author is blocked, or the code
        // is the user's own.
        'terms_required',
        'author_blocked',
        'own_space',
      ].includes(key);
      setError(t(`community.errors.${known ? key : 'failed'}`));
    } finally {
      setBusy(false);
    }
  };

  const onChange = (raw: string) => {
    setCode(raw);
    setError(null);
    // Submit as soon as the text contains a whole code — a paste, normally.
    const parsed = parseSpaceCodeInput(raw);
    if (parsed && submittedRef.current !== raw) void submit(raw);
  };

  const note = error ?? status ?? (focused ? t('community.addByCodeHint') : null);

  return (
    // Sized to a code, not to the space available: in the header it competes
    // with the screen's title, and a field wide enough to swallow the row would
    // push "new space" off a narrow phone.
    <div className="min-w-0 shrink">
      <input
        value={code}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          // Enter still works, for a code typed by hand that the parser is
          // about to accept anyway — and for anything it can't extract.
          if (e.key === 'Enter') void submit(code);
        }}
        placeholder={t('community.addByCodePlaceholder') as string}
        aria-label={t('community.addByCode') as string}
        title={t('community.addByCodeHint') as string}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        maxLength={64}
        disabled={busy}
        // Narrow on purpose: this header also holds the screen's title and
        // "new space". 7rem is what the placeholder needs at this size — any
        // narrower and the prompt itself is clipped, which is the one thing
        // the field has to say. Widens where there is room.
        //
        // The arithmetic at 375px (iPhone SE): 32 padding + 16 gaps + 112
        // field + ~110 button leaves ~105 for the title, which "Räume" and a
        // truncated subtitle fit. At 320 the title truncates too; nothing
        // overflows, because the title block is the flex-1 min-w-0 one.
        className="w-28 sm:w-40 min-w-0 bg-surface-raised rounded-xl px-2.5 py-1.5 font-mono text-xs sm:text-sm text-ink outline-none focus:ring-2 focus:ring-brand/60 disabled:opacity-60"
      />
      {/* Absolute, so a hint or an error can't shove the header's own height
          around while someone is typing in it. */}
      {note && (
        <p
          className={`absolute right-4 mt-1 max-w-[16rem] text-right text-[11px] ${
            error ? 'text-red-400' : 'text-ink-muted'
          }`}
        >
          {note}
        </p>
      )}
    </div>
  );
}

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCommunityStore } from '@/store/communityStore';
import { communityErrorKey } from '@/lib/communityErrors';
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
export function SubscribeField({ onSubscribed }: { onSubscribed?: () => void }) {
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
      // The shelf just added lands in a list this screen may not be showing —
      // the index puts your own and the ones you read behind tabs — so the
      // caller gets a chance to reveal it. Without this the field clears, says
      // "added", and nothing visibly changes.
      onSubscribed?.();
    } catch (e) {
      // ApiError's message is api.php's `error` string, so a reason the server
      // gave (space_not_ready, profile_required) lands here alongside the ones
      // the store raises before it touches the network (terms_required,
      // author_blocked, own_space). `communityErrorKey` also folds the one
      // refusal that comes back as prose rather than a key — a code the server
      // cannot resolve — which this used to miss entirely.
      const key = communityErrorKey(e);
      setError(t(`community.errors.${key ?? 'failed'}`));
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
    // `flex-1` so the column, not the input, takes the row's spare width: the
    // input keeps its own narrow size and a wrapped error gets somewhere to go.
    <div className="min-w-0 flex-1">
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
        // 7rem is what the placeholder needs at this size — any narrower and
        // the prompt itself is clipped, which is the one thing the field has to
        // say. It widens where there is room, and beside "new shelf" there is:
        // at 375px that row is 32 padding + 8 gap + ~130 button + 112 field,
        // with the rest to spare.
        className="w-28 sm:w-40 min-w-0 bg-surface-raised rounded-xl px-2.5 py-1.5 font-mono text-xs sm:text-sm text-ink outline-none focus:ring-2 focus:ring-brand/60 disabled:opacity-60"
      />
      {/* In flow, and under the field it belongs to. It used to be `absolute
          right-4`, pinned to the header this field lived in so that a hint
          could not shove the header's height around mid-typing. Beside "new
          shelf" that same trick laid a five-line error across the tabs and the
          first shelf — the head block is not fixed chrome, and growing it just
          gives the list below one line less to scroll in. */}
      {note && (
        <p
          className={`mt-1 text-[11px] ${
            error ? 'text-red-400' : 'text-ink-muted'
          }`}
        >
          {note}
        </p>
      )}
    </div>
  );
}

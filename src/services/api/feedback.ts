import { apiPostJson } from './client';
import type { FeedbackContext } from '@/lib/feedbackContext';
import type { FeedbackKind } from '@/types/domain';

/**
 * Send in-app feedback to the maintainer.
 *
 * Deliberately outside the sync machinery. `settings.syncEnabled` gates *the
 * user's library* — cards, lists, spaces — at three chokepoints, and routing
 * feedback through them would mean a tester who never opted in could not report
 * the bug they are looking at. Nothing here is stored under the user's account
 * either (see api.php's `handleFeedbackCreate`), so the opt-in keeps meaning
 * exactly what it says.
 *
 * One-shot, and not queued when it fails: an unsent report stays in the
 * textarea for the user to try again, which is both honest and how
 * `ReportDialog` behaves. A queued one would be an op with no entity behind it.
 */
export function sendFeedback(input: {
  kind: FeedbackKind;
  message: string;
  context: FeedbackContext;
}): Promise<{ received: true }> {
  return apiPostJson<{ received: true }>('feedback.create', input);
}

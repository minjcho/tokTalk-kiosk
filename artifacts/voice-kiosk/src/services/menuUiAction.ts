import type { OrderResult, OrderSession } from '@workspace/api-client-react';

/** Replayed screen commands must not replace a newer cart or another customer. */
export function menuVisibilityForResult(result: OrderResult, current: OrderSession | null): boolean | undefined {
  if (!current || current.status !== 'active' || result.session.status !== 'active' ||
      result.session.id !== current.id || result.session.revision !== current.revision) return undefined;
  if (result.uiAction === 'show_menu') return true;
  if (result.uiAction === 'close_menu') return false;
  return undefined;
}

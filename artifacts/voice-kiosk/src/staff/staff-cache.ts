import type { QueryClient } from '@tanstack/react-query';

const isStaffKey = (key: readonly unknown[]) =>
  typeof key[0] === 'string' && key[0].startsWith('/api/staff');

export function clearStaffCache(qc: QueryClient) {
  // Cancel first, so a late response cannot put another user's orders back.
  void qc.cancelQueries({ predicate: (q) => isStaffKey(q.queryKey) });
  qc.removeQueries({ predicate: (q) => isStaffKey(q.queryKey) });
  const mc = qc.getMutationCache();
  mc.getAll()
    .filter((m) => m.options.mutationKey?.[0] === 'updateStaffOrderStatus')
    .forEach((m) => mc.remove(m));
}

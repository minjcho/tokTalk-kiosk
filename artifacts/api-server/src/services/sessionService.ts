import { randomUUID } from "node:crypto";
import { KioskError } from "./errors";
import { PostgresSessionRepository } from "./postgresSessionRepository";
import { logger } from "../lib/logger";
import type { CartItem, OrderAction, OrderResult, Receipt, SessionDebug, SessionView } from "./orderTypes";

export const IDLE_SECONDS = 180;
export interface SessionState {
  id: string;
  revision: number;
  status: SessionView["status"];
  items: CartItem[];
  lastActivity: number;
  lastTranscript: string | null;
  clarification: string | null;
  pendingOrder?: OrderAction[];
  pendingCustomizationConfirmed?: boolean;
  history: { text: string; applied: boolean; question: string | null }[];
  debug: SessionDebug;
  busy: boolean;
  lockToken?: string;
  receipt?: Receipt;
  requests: Map<string, OrderResult>;
}

/** Storage remains behind this interface; all writes are asynchronous and fenced. */
export interface SessionRepository {
  save(session: SessionState): Promise<void>;
  find(id: string): Promise<SessionState | undefined>;
  delete(id: string): Promise<void>;
  all(): Promise<IterableIterator<SessionState>>;
  acquire(session: SessionState, revision?: number): Promise<void>;
  release(session: SessionState): Promise<void>;
  renew(session: SessionState): Promise<void>;
  isCurrent(session: SessionState): Promise<boolean>;
  touch(id: string): Promise<SessionState>;
  confirm(session: SessionState): Promise<Receipt>;
  cleanup(): Promise<void>;
}

export const repository: SessionRepository = new PostgresSessionRepository();

export async function createSession(): Promise<SessionState> {
  const state: SessionState = {
    id: randomUUID(), revision: 0, status: "active", items: [], lastActivity: Date.now(),
    lastTranscript: null, clarification: null, history: [], busy: false,
    debug: { transcript: null, extractedJson: null, events: [] }, requests: new Map(),
  };
  await repository.save(state);
  return state;
}

export async function getSession(id: string, requireActive = false): Promise<SessionState> {
  const session = await repository.find(id);
  if (!session) throw expiredSession();
  if (requireActive && session.status !== "active") {
    throw new KioskError("SESSION_CLOSED", "이미 종료된 주문입니다. 새 주문을 시작해주세요.", 409);
  }
  return session;
}

export function expiredSession() {
  return new KioskError("SESSION_EXPIRED", "주문 시간이 종료되었습니다. 새 주문을 시작해주세요.", 410);
}

export function sessionView(state: SessionState): SessionView {
  return {
    id: state.id, revision: state.revision, status: state.status, items: structuredClone(state.items),
    total: state.items.reduce((sum, i) => sum + i.lineTotal, 0),
    itemCount: state.items.reduce((sum, i) => sum + i.quantity, 0),
    expiresAt: new Date(state.lastActivity + IDLE_SECONDS * 1000).toISOString(),
    lastTranscript: state.lastTranscript, clarification: state.clarification,
  };
}

export async function lockSession(session: SessionState, revision?: number) {
  await repository.acquire(session, revision);
}

export async function ensureCurrent(session: SessionState) {
  if (session.status !== "active" || !await repository.isCurrent(session)) {
    throw new KioskError("SESSION_CLOSED", "종료되었거나 처리 시간이 지난 주문에는 추가할 수 없습니다.", 409);
  }
}

export function changed(session: SessionState) {
  session.revision++;
  session.clarification = null;
  session.history = [];
  session.pendingOrder = undefined;
  session.pendingCustomizationConfirmed = undefined;
}

export function debugEvent(session: SessionState, level: "info" | "error", code: string, message: string) {
  session.debug.events.push({ time: new Date().toISOString(), level, code, message });
  session.debug.events = session.debug.events.slice(-30);
}

/** Transactionally issues one receipt and removes all customer conversation context. */
export async function confirmSession(session: SessionState): Promise<Receipt> {
  if (session.clarification || session.pendingOrder?.length) {
    throw new KioskError("PREFERENCES_PENDING", "먼저 확인 질문에 답해주세요. 대기 중인 음료는 아직 장바구니에 담기지 않았습니다.", 409);
  }
  return repository.confirm(session);
}

/** Never send a success response until the shared state has been committed. */
export async function withSessionLock<T>(session: SessionState, revision: number, operation: () => Promise<T> | T): Promise<T> {
  await lockSession(session, revision);
  // A crashed worker's lease expires; a late worker cannot overwrite its successor.
  const heartbeat = setInterval(() => {
    repository.renew(session).catch(() => {
      // Commit also checks the lease. Never extend idle time just for processing.
      logger.warn({ code: "SESSION_LEASE_RENEW_FAILED" }, "Session processing lease could not be renewed");
    });
  }, 10_000);
  heartbeat.unref();
  try {
    const result = await operation();
    await repository.release(session);
    return result;
  } catch (error) {
    if (error instanceof KioskError) debugEvent(session, "error", error.code, error.message);
    // Preserve only safe per-session diagnostics. Do not mask the original failure.
    await repository.release(session).catch(() => {});
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

export function startSessionCleanup() {
  const sweep = () => repository.cleanup().catch(() => {
    logger.warn({ code: "SESSION_CLEANUP_FAILED" }, "Expired session cleanup failed");
  });
  void sweep();
  const timer = setInterval(sweep, 5_000);
  timer.unref();
  return timer;
}

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import {
  GetMenuResponse, GetKioskStatusResponse, CreateSessionResponse, GetSessionParams, GetSessionResponse,
  CancelSessionParams, SubmitTextOrderParams, SubmitTextOrderBody, SubmitTextOrderResponse,
  SubmitVoiceOrderParams, SubmitVoiceOrderBody, SubmitVoiceOrderResponse,
  AddCartItemParams, AddCartItemBody, AddCartItemResponse,
  UpdateCartItemParams, UpdateCartItemBody, UpdateCartItemResponse,
  RemoveCartItemParams, RemoveCartItemBody, RemoveCartItemResponse, ConfirmOrderParams, ConfirmOrderBody, ConfirmOrderResponse,
  GetSessionDebugParams, GetSessionDebugResponse, TouchSessionParams, TouchSessionResponse,
  SpeakClarificationParams, SpeakClarificationBody,
  SpeakGuidanceParams, SpeakGuidanceBody,
} from "@workspace/api-zod";
import { menu } from "../services/menuService";
import { KioskError, publicError } from "../services/errors";
import { makeItem, normalizeCart } from "../services/cartService";
import {
  createSession, getSession, sessionView, repository, changed, confirmSession,
  withSessionLock, IDLE_SECONDS, type SessionState,
} from "../services/sessionService";
import { TRANSCRIPTION_MODEL, PARSER_MODEL } from "../services/openaiClient";
import { orderService } from "../services/orderService";
import { transcriptionService } from "../services/transcriptionService";
import { rateLimiter, RateLimitError } from "../services/rateLimitService";
import { speechService } from "../services/speechService";
import { GUIDANCE_TEXT } from "../services/guidanceService";

const router: IRouter = Router();
router.use("/kiosk", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
type Handler = (req: Request, res: Response) => Promise<void> | void;

function guarded(handler: Handler) {
  return async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      await handler(req, res);
    } catch (error) {
      const safe = error instanceof z.ZodError
        ? new KioskError("INVALID_INPUT", "입력 내용을 확인해주세요. 수량과 옵션을 다시 선택할 수 있습니다.")
        : publicError(error);
      const rawId = req.params.sessionId;
      const session = typeof rawId === "string" ? await repository.find(rawId).catch(() => undefined) : undefined;
      // Never log SDK request objects, keys, audio bytes or raw provider responses.
      req.log.warn({ code: safe.code, providerStatus: (error as { status?: number } | null)?.status }, "Kiosk request failed");
      if (safe instanceof RateLimitError) res.setHeader("Retry-After", safe.retryAfterSeconds);
      res.status(safe.status).json({ error: safe.message, code: safe.code, ...(session?.lastTranscript ? { transcript: session.lastTranscript } : {}) });
    }
  };
}

function rateLimit(req: Request) {
  return rateLimiter.consume(req.ip || "unknown");
}

router.get("/kiosk/menu", guarded((_req, res) => { res.json(GetMenuResponse.parse(menu)); }));
router.get("/kiosk/status", guarded((_req, res) => {
  res.json(GetKioskStatusResponse.parse({
    aiReady: Boolean(process.env.OPENAI_API_KEY), transcriptionModel: TRANSCRIPTION_MODEL,
    parserModel: PARSER_MODEL, idleTimeoutSeconds: IDLE_SECONDS,
  }));
}));
router.post("/kiosk/sessions", guarded(async (req, res) => {
  await rateLimit(req);
  res.status(201).json(CreateSessionResponse.parse(sessionView(await createSession())));
}));
router.get("/kiosk/sessions/:sessionId", guarded(async (req, res) => {
  const { sessionId } = GetSessionParams.parse(req.params);
  res.setHeader("Cache-Control", "no-store");
  res.json(GetSessionResponse.parse(sessionView(await getSession(sessionId))));
}));
router.delete("/kiosk/sessions/:sessionId", guarded(async (req, res) => {
  const { sessionId } = CancelSessionParams.parse(req.params);
  // Deleting the repository entry also invalidates in-flight AI requests.
  await repository.delete(sessionId);
  res.sendStatus(204);
}));
router.post("/kiosk/sessions/:sessionId/activity", guarded(async (req, res) => {
  const { sessionId } = TouchSessionParams.parse(req.params);
  const session = await repository.touch(sessionId);
  res.json(TouchSessionResponse.parse(sessionView(session)));
}));

router.post("/kiosk/sessions/:sessionId/speech", guarded(async (req, res) => {
  const { sessionId } = SpeakClarificationParams.parse(req.params);
  const input = SpeakClarificationBody.parse(req.body);
  const currentQuestion = async () => {
    const session = await getSession(sessionId, true);
    // Clarifications can change without a cart revision, so compare both.
    if (session.busy || session.revision !== input.revision || !session.clarification || session.clarification !== input.question) {
      throw new KioskError("QUESTION_CHANGED", "확인 질문이 바뀌었어요. 현재 질문에 답해주세요.", 409);
    }
    return session.clarification;
  };
  const question = await currentQuestion();
  await rateLimit(req);
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.on("aborted", abort);
  res.on("close", abort);
  try {
    const bytes = await speechService.synthesize(question, controller.signal, input.speed);
    if (controller.signal.aborted) return;
    await currentQuestion();
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(bytes);
  } catch (error) {
    if (controller.signal.aborted) return;
    if (error instanceof KioskError) throw error;
    throw new KioskError("TTS_FAILED", "질문 음성을 재생하지 못했어요. 다시 듣기를 누르거나 화면에서 답해주세요.", 502);
  } finally {
    req.off("aborted", abort);
    res.off("close", abort);
  }
}));

router.post("/kiosk/sessions/:sessionId/guidance-speech", guarded(async (req, res) => {
  const { sessionId } = SpeakGuidanceParams.parse(req.params);
  // Explicitly reject text/other fields, even if a generated schema strips them.
  const input = SpeakGuidanceBody.strict().parse(req.body);
  const currentGuide = async () => {
    const session = await getSession(sessionId, true);
    if (session.busy || session.revision !== input.revision ||
        (input.guide === "welcome" && (session.items.length > 0 || session.clarification))) {
      throw new KioskError("GUIDANCE_CHANGED", "주문 상태가 바뀌었어요. 현재 화면에서 주문을 계속해 주세요.", 409);
    }
    return GUIDANCE_TEXT[input.guide];
  };
  const text = await currentGuide();
  await rateLimit(req);
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.on("aborted", abort);
  res.on("close", abort);
  try {
    const bytes = await speechService.synthesize(text, controller.signal);
    if (controller.signal.aborted) return;
    await currentGuide();
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(bytes);
  } catch (error) {
    if (controller.signal.aborted) return;
    if (error instanceof KioskError) throw error;
    throw new KioskError("TTS_FAILED", "안내 음성을 재생하지 못했어요. 다시 듣기를 누르거나 화면에서 주문해주세요.", 502);
  } finally {
    req.off("aborted", abort);
    res.off("close", abort);
  }
}));

router.post("/kiosk/sessions/:sessionId/text", guarded(async (req, res) => {
  const { sessionId } = SubmitTextOrderParams.parse(req.params);
  const input = SubmitTextOrderBody.parse(req.body);
  const text = input.text.trim();
  if (!text) throw new KioskError("NO_TEXT", "주문할 메뉴와 수량을 입력해주세요.");
  const session = await getSession(sessionId, true);
  const prior = session.requests.get(input.requestId);
  if (prior) { res.json(SubmitTextOrderResponse.parse(prior)); return; }
  const result = await withSessionLock(session, input.revision, async () => {
    // acquire refreshes the snapshot; a clarification may have kept its revision.
    const replay = session.requests.get(input.requestId);
    if (replay) return replay;
    await rateLimit(req);
    return orderService.process(text, session, input.requestId);
  });
  res.json(SubmitTextOrderResponse.parse(result));
}));
router.post("/kiosk/sessions/:sessionId/voice", guarded(async (req, res) => {
  const { sessionId } = SubmitVoiceOrderParams.parse(req.params);
  const input = SubmitVoiceOrderBody.parse(req.body);
  const session = await getSession(sessionId, true);
  const prior = session.requests.get(input.requestId);
  if (prior) { res.json(SubmitVoiceOrderResponse.parse(prior)); return; }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.audioBase64)) throw new KioskError("AUDIO_FORMAT", "녹음 파일을 읽지 못했습니다. 다시 녹음해주세요.");
  const result = await withSessionLock(session, input.revision, async () => {
    const replay = session.requests.get(input.requestId);
    if (replay) return replay;
    await rateLimit(req);
    let text: string;
    try {
      text = await transcriptionService.transcribe(Buffer.from(input.audioBase64, "base64"), input.mimeType, session.clarification);
    } catch (error) {
      // Failed STT has no current transcript. Successful display-only commands
      // preserve the last order transcript just like the text route.
      session.debug.transcript = null;
      session.lastTranscript = null;
      if (error instanceof KioskError) throw error;
      const safe = publicError(error);
      throw new KioskError(safe.code === "AI_UNAVAILABLE" ? "STT_FAILED" : safe.code,
        safe.code === "AI_UNAVAILABLE" ? "목소리를 글로 바꾸지 못했습니다. 다시 녹음하거나 화면에서 주문해주세요." : safe.message, safe.status);
    }
    return orderService.process(text, session, input.requestId);
  });
  res.json(SubmitVoiceOrderResponse.parse(result));
}));

async function touchMutation(session: SessionState, revision: number, operation: () => void) {
  await withSessionLock(session, revision, () => { operation(); changed(session); });
}
router.post("/kiosk/sessions/:sessionId/items", guarded(async (req, res) => {
  const { sessionId } = AddCartItemParams.parse(req.params);
  const input = AddCartItemBody.parse(req.body);
  const session = await getSession(sessionId, true);
  await touchMutation(session, input.revision, () => {
    const item = makeItem(input.menuId, input.quantity, input.temperature, input.size, input.options);
    session.items = normalizeCart([...session.items, item]);
  });
  res.json(AddCartItemResponse.parse(sessionView(session)));
}));
router.patch("/kiosk/sessions/:sessionId/items/:itemId", guarded(async (req, res) => {
  const { sessionId, itemId } = UpdateCartItemParams.parse(req.params);
  const input = UpdateCartItemBody.parse(req.body);
  const session = await getSession(sessionId, true);
  await touchMutation(session, input.revision, () => {
    const existing = session.items.find((i) => i.id === itemId);
    if (!existing) throw new KioskError("ITEM_UNKNOWN", "장바구니에서 해당 음료를 찾지 못했습니다.", 404);
    const updated = makeItem(existing.menuId, input.quantity, input.temperature, input.size, input.options, itemId);
    session.items = normalizeCart(session.items.map((i) => i.id === itemId ? updated : i));
  });
  res.json(UpdateCartItemResponse.parse(sessionView(session)));
}));
router.delete("/kiosk/sessions/:sessionId/items/:itemId", guarded(async (req, res) => {
  const { sessionId, itemId } = RemoveCartItemParams.parse(req.params);
  const input = RemoveCartItemBody.parse(req.body);
  const session = await getSession(sessionId, true);
  await touchMutation(session, input.revision, () => {
    if (!session.items.some((i) => i.id === itemId)) throw new KioskError("ITEM_UNKNOWN", "이미 삭제된 음료입니다.", 404);
    session.items = session.items.filter((i) => i.id !== itemId);
  });
  res.json(RemoveCartItemResponse.parse(sessionView(session)));
}));
router.post("/kiosk/sessions/:sessionId/confirm", guarded(async (req, res) => {
  const { sessionId } = ConfirmOrderParams.parse(req.params);
  const input = ConfirmOrderBody.parse(req.body);
  const session = await getSession(sessionId);
  if (session.receipt) { res.json(ConfirmOrderResponse.parse(session.receipt)); return; }
  if (session.status !== "active") throw new KioskError("SESSION_CLOSED", "종료된 주문입니다. 새 주문을 시작해주세요.", 409);
  const receipt = await withSessionLock(session, input.revision, () => confirmSession(session));
  res.json(ConfirmOrderResponse.parse(receipt));
}));
router.get("/kiosk/sessions/:sessionId/debug", guarded(async (req, res) => {
  const { sessionId } = GetSessionDebugParams.parse(req.params);
  res.setHeader("Cache-Control", "no-store");
  res.json(GetSessionDebugResponse.parse((await getSession(sessionId)).debug));
}));
export default router;

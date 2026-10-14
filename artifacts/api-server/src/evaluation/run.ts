/**
 * Opt-in real provider evaluation. Never writes voice bytes/transcripts/provider errors.
 * Source recordings are controlled by the collection owner, not deleted by this runner.
 */
import { readFile, realpath, stat, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute, extname, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { CreateSessionResponse, SubmitVoiceOrderResponse, GetSessionResponse, GetKioskStatusResponse } from "@workspace/api-zod";
import { CorpusSchema, assertConsent, fromCart, sameCart, scoreCart, validateSlots, type Corpus, type Expected, type Group, type Slots } from "./criteria";
import { textCases } from "./textCases";

const BASE = "http://localhost:80/api/kiosk";
const ROOT = resolve(import.meta.dirname, "../../../..");
type Turn = { text?: string; audioFile?: string; expected: Expected };
type Case = { id: string; group: Group; initialCart: Slots[]; turns: Turn[]; consent?: Corpus["cases"][number]["consent"] };
type Result = ReturnType<typeof scoreCart> & {
  caseId: string; group: Group; turn: number; trial: number; passed: boolean;
  clarificationCorrect: boolean; safetyCorrect: boolean; latencyMs: number;
  errorCode: string | null; audioSha256?: string;
  accepted: boolean; actualCart: Slots[]; expectedCart: Slots[];
};

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
}
async function request(path: string, method = "GET", body?: object) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(125_000),
  });
  const data = res.status === 204 ? null : await res.json();
  return { ok: res.ok, data };
}
const safeCode = (value: unknown) => typeof value === "string" && /^[A-Z_]{1,50}$/.test(value) ? value : "REQUEST_FAILED";
const responseCode = (data: unknown) => safeCode(data && typeof data === "object" && "code" in data ? data.code : null);
async function required(path: string, method = "GET", body?: object) {
  const res = await request(path, method, body);
  if (!res.ok) throw new Error(responseCode(res.data));
  return res.data;
}
function assertSafeExpected(initial: Slots[], turn: Turn) {
  validateSlots(turn.expected.cart);
  if ((turn.expected.needsClarification || turn.expected.rejectionCodes.length) && !sameCart(initial, turn.expected.cart)) {
    throw new Error("EXPECTED_UNSAFE_MUTATION");
  }
}
async function loadAudio(path: string, folder: string) {
  const actual = await realpath(resolve(folder, path));
  const rel = relative(folder, actual);
  if (isAbsolute(path) || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("AUDIO_PATH_OUTSIDE_CORPUS");
  const mime = ({ ".wav": "audio/wav", ".webm": "audio/webm", ".m4a": "audio/mp4", ".mp4": "audio/mp4", ".ogg": "audio/ogg" } as Record<string, string>)[extname(actual).toLowerCase()];
  const info = await stat(actual);
  if (!mime || !info.isFile() || info.size < 1000 || info.size > 10_000_000) throw new Error("AUDIO_FILE_INVALID");
  const bytes = await readFile(actual);
  return { bytes, mime, hash: createHash("sha256").update(bytes).digest("hex") };
}
async function main() {
  const textOnly = process.argv.includes("--text");
  const manifest = arg("--manifest");
  if (!textOnly && !manifest) throw new Error("NEED_CONSENTED_MANIFEST: use --manifest /path/to/manifest.json");
  const repeats = Number(arg("--repeats") ?? "1");
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3) throw new Error("REPEATS_MUST_BE_1_TO_3");
  const folder = manifest ? await realpath(dirname(resolve(manifest))) : ROOT;
  const allCases: Case[] = textOnly ? textCases : CorpusSchema.parse(JSON.parse(await readFile(resolve(manifest!), "utf8"))).cases;
  const selected = arg("--case")?.split(",");
  const cases = selected ? allCases.filter((c) => selected.includes(c.id)) : allCases;
  if (!cases.length || selected?.some((id) => !cases.some((c) => c.id === id))) throw new Error("CASE_NOT_FOUND");
  if (new Set(cases.map((c) => c.id)).size !== cases.length) throw new Error("DUPLICATE_CASE_ID");
  // Preflight the entire corpus before sending any bytes externally.
  for (const c of cases) {
    if (!textOnly) assertConsent(c.consent!);
    validateSlots(c.initialCart);
    let before = c.initialCart;
    for (const t of c.turns) {
      assertSafeExpected(before, t);
      if (!textOnly) {
        const preflight = await loadAudio(t.audioFile!, folder);
        preflight.bytes.fill(0);
      }
      before = t.expected.cart;
    }
  }
  const status = GetKioskStatusResponse.parse(await required("/status"));
  if (!status.aiReady) throw new Error("AI_NOT_READY");
  const rows: Result[] = [];
  for (let trial = 1; trial <= repeats; trial++) for (const c of cases) {
    let session = CreateSessionResponse.parse(await required("/sessions", "POST"));
    try {
      for (const item of c.initialCart) session = GetSessionResponse.parse(await required(`/sessions/${session.id}/items`, "POST", { ...item, revision: session.revision }));
      for (const [index, t] of c.turns.entries()) {
        if (!textOnly) assertConsent(c.consent!); // Recheck expiry before every upload.
        const before = fromCart(session.items), revision = session.revision;
        const audio = textOnly ? undefined : await loadAudio(t.audioFile!, folder);
        const start = performance.now();
        let actual: Slots[]; let clarification = false; let hasQuestion = false; let code: string | null = null;
        try {
          const response = await request(`/sessions/${session.id}/${textOnly ? "text" : "voice"}`, "POST", {
            revision, requestId: randomUUID(),
            ...(audio ? { audioBase64: audio.bytes.toString("base64"), mimeType: audio.mime } : { text: t.text }),
          });
          if (response.ok) {
            const result = SubmitVoiceOrderResponse.parse(response.data);
            session = result.session;
            clarification = result.needsClarification;
            hasQuestion = Boolean(result.message.trim()) && Boolean(session.clarification?.trim());
          } else {
            code = responseCode(response.data);
            session = GetSessionResponse.parse(await required(`/sessions/${session.id}`));
          }
        } catch {
          code = "TRANSPORT_OR_CONTRACT_ERROR";
          session = GetSessionResponse.parse(await required(`/sessions/${session.id}`));
        }
        actual = fromCart(session.items);
        const scores = scoreCart(actual, t.expected.cart);
        const rejectionCorrect = code !== null && t.expected.rejectionCodes.includes(code as Expected["rejectionCodes"][number]);
        const clarificationCorrect = code === null
          ? clarification === t.expected.needsClarification && (!clarification || hasQuestion)
          : rejectionCorrect;
        const safetyCorrect = !(clarification || code || t.expected.needsClarification || t.expected.rejectionCodes.length) ||
          (sameCart(actual, before) && session.revision === revision);
        const passed = scores.exactCart && clarificationCorrect && safetyCorrect &&
          (t.expected.rejectionCodes.length ? rejectionCorrect : code === null);
        rows.push({ ...scores, caseId: c.id, group: c.group, turn: index + 1, trial, passed,
          clarificationCorrect, safetyCorrect, latencyMs: Math.round(performance.now() - start),
          errorCode: code, accepted: code === null && !clarification,
          actualCart: actual, expectedCart: t.expected.cart,
          ...(audio ? { audioSha256: audio.hash } : {}) });
        audio?.bytes.fill(0);
        process.stdout.write(`${passed ? "PASS" : "FAIL"} ${c.id} turn=${index + 1} trial=${trial}${code ? ` code=${code}` : ""}\n`);
        // Respect the public 30-AI-request/minute budget including session creates.
        await new Promise((done) => setTimeout(done, 2600));
      }
    } finally { await required(`/sessions/${session.id}`, "DELETE"); }
  }
  const groups = [...new Set(rows.map((r) => `${r.group.dialect}/${r.group.condition}`))].map((key) => {
    const subset = rows.filter((r) => `${r.group.dialect}/${r.group.condition}` === key);
    const rate = (field: "passed" | "menuCorrect" | "quantityCorrect" | "optionsCorrect" | "clarificationCorrect") => subset.filter((r) => r[field]).length / subset.length;
    return { group: key, turns: subset.length, passed: subset.filter((r) => r.passed).length,
      uniqueRecordings: new Set(subset.flatMap((r) => r.audioSha256 ? [r.audioSha256] : [])).size,
      exactRate: rate("passed"), menuRate: rate("menuCorrect"), quantityRate: rate("quantityCorrect"),
      optionTemperatureSizeRate: rate("optionsCorrect"), clarificationRate: rate("clarificationCorrect") };
  });
  const summary = {
    kind: textOnly ? "text-only-not-acoustic-evidence" : "consented-recordings",
    createdAt: new Date().toISOString(), models: { transcription: status.transcriptionModel, parser: status.parserModel },
    repeats, cases: cases.length, turns: rows.length, passed: rows.filter((r) => r.passed).length,
    exactRate: rows.filter((r) => r.passed).length / rows.length,
    unsafeMutations: rows.filter((r) => !r.safetyCorrect).length,
    wrongAcceptedOrders: rows.filter((r) => r.accepted && !r.passed).length,
    groups, rows,
    releaseApproval: false, // Physical-device checklist & required coverage need a human sign-off.
  };
  const report = resolve(ROOT, "generated-artifacts/voice-quality", textOnly ? "text-report.json" : "voice-report.json");
  await mkdir(dirname(report), { recursive: true, mode: 0o700 });
  await writeFile(report, JSON.stringify(summary, null, 2), { mode: 0o600 });
  process.stdout.write(`Summary: ${summary.passed}/${rows.length}; unsafe=${summary.unsafeMutations}; report=${relative(ROOT, report)}\n`);
  if (summary.passed !== rows.length) process.exitCode = 1;
}
main().catch((e: unknown) => {
  // Zod messages may echo uploaded metadata. Never print them or raw provider errors.
  process.stderr.write(`${e instanceof z.ZodError ? "INVALID_CORPUS_OR_CONTRACT" : e instanceof Error && /^[A-Z_0-9: /.-]+$/.test(e.message) ? e.message : "EVALUATION_FAILED"}\n`);
  process.exitCode = 1;
});

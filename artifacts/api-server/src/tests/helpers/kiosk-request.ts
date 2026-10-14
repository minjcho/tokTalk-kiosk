import type { Request, Response } from "express";
import { EventEmitter } from "node:events";
import router from "../../routes/kiosk";

export interface KioskReply<T = unknown> {
  status: number;
  headers: Record<string, string>;
  body: T;
}

/** Run the real router without opening a test port or making provider calls. */
export function kioskRequest<T = unknown>(peer: string, method: string, url: string, body?: unknown): Promise<KioskReply<T>> {
  return new Promise((resolve, reject) => {
    const reply = { status: 200, headers: {}, body: undefined } as KioskReply<T>;
    const timeout = setTimeout(() => reject(new Error("Kiosk test request timed out")), 10_000);
    const finish = (value?: unknown) => {
      clearTimeout(timeout);
      reply.body = value as T;
      resolve(reply);
    };
    const req = Object.assign(new EventEmitter(), {
      method, url, body, ip: peer, headers: {},
      log: { warn() {} },
    }) as unknown as Request;
    const res = Object.assign(new EventEmitter(), {
      setHeader(name: string, value: unknown) { reply.headers[name.toLowerCase()] = String(value); return res; },
      status(value: number) { reply.status = value; return res; },
      json(value: unknown) { finish(value); return res; },
      send(value: unknown) { finish(value); return res; },
      sendStatus(value: number) { reply.status = value; finish(); return res; },
    }) as unknown as Response;
    router(req, res, (error?: unknown) => {
      clearTimeout(timeout);
      reject(error || new Error(`No kiosk route matched ${method} ${url}`));
    });
  });
}

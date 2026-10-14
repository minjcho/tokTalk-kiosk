import { Router, type IRouter, type RequestHandler, type Request, type Response } from "express";
import { z } from "zod";
import {
  GetStaffMeResponse, ListStaffOrdersQueryParams, ListStaffOrdersResponse,
  UpdateStaffOrderStatusParams, UpdateStaffOrderStatusBody, UpdateStaffOrderStatusResponse,
} from "@workspace/api-zod";
import { requireStaff } from "../middlewares/requireStaff";
import { listStaffOrders, updateStaffOrderStatus } from "../services/staffOrderRepository";
import { KioskError } from "../services/errors";

type Handler = (req: Request, res: Response) => Promise<void> | void;
function guarded(handler: Handler): RequestHandler {
  return async (req, res): Promise<void> => {
    try { await handler(req, res); }
    catch (error) {
      const safe = error instanceof z.ZodError
        ? new KioskError("STAFF_INVALID_INPUT", "요청 내용을 확인해주세요.", 400)
        : error instanceof KioskError ? error
        : new KioskError("STAFF_STORAGE_UNAVAILABLE", "주문을 불러오지 못했습니다. 다시 시도해주세요.", 503);
      req.log.warn({ code: safe.code }, "Staff request failed");
      res.status(safe.status).json({ code: safe.code, error: safe.message });
    }
  };
}

export function createStaffRouter(authorization: RequestHandler = requireStaff): IRouter {
  const router: IRouter = Router();
  router.use("/staff", authorization);
  router.get("/staff/me", guarded((_req, res) => {
    res.json(GetStaffMeResponse.parse({ userId: res.locals.staffUserId }));
  }));
  router.get("/staff/orders", guarded(async (req, res) => {
    const { status, before } = ListStaffOrdersQueryParams.strict().parse(req.query);
    res.json(ListStaffOrdersResponse.parse(await listStaffOrders(status, before)));
  }));
  router.patch("/staff/orders/:orderNumber/status", guarded(async (req, res) => {
    const { orderNumber } = UpdateStaffOrderStatusParams.parse(req.params);
    const { status, expectedVersion } = UpdateStaffOrderStatusBody.strict().parse(req.body);
    res.json(UpdateStaffOrderStatusResponse.parse(await updateStaffOrderStatus(orderNumber, status, expectedVersion, res.locals.staffUserId)));
  }));
  return router;
}

export default createStaffRouter();

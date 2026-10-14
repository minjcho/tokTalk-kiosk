import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from "./middlewares/clerkProxyMiddleware";
import { staffRequestBoundary } from "./middlewares/requireStaff";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
// Anonymous kiosk behavior is independent of the staff identity provider.
app.use("/api/kiosk", cors());
app.use("/api/staff", staffRequestBoundary);
app.use(express.json({ limit: "14mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api/staff", (req, res, next) => {
  if (!process.env.CLERK_SECRET_KEY || !process.env.CLERK_PUBLISHABLE_KEY) {
    res.status(503).json({ code: "STAFF_AUTH_UNAVAILABLE", error: "직원 인증이 설정되지 않았습니다." });
    return;
  }
  next();
});
app.use("/api/staff",
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

const handleErrors: ErrorRequestHandler = (err, req, res, _next) => {
  const tooLarge = err?.type === "entity.too.large";
  req.log.warn({ code: tooLarge ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST" }, "Request rejected");
  res.status(tooLarge ? 413 : 400).json({
    code: tooLarge ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST",
    error: tooLarge ? "녹음이 너무 깁니다. 45초 이내로 나누어 말씀해주세요." : "요청을 읽지 못했습니다. 다시 시도해주세요.",
  });
};
app.use(handleErrors);

export default app;

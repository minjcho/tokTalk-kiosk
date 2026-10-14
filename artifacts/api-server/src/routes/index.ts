import { Router, type IRouter } from "express";
import healthRouter from "./health";
import kioskRouter from "./kiosk";
import staffRouter from "./staff";

const router: IRouter = Router();

router.use(healthRouter);
router.use(kioskRouter);
router.use(staffRouter);

export default router;

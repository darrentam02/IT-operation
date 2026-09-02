import { Router, type IRouter } from "express";
import healthRouter from "./health";
import operationsRouter from "./operations";
import integrationsRouter from "./integrations";
import authRouter from "./auth";
import vendorRouter from "./vendor";
import vendorPortalRouter from "./vendor-portal";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(operationsRouter);
router.use(integrationsRouter);
router.use(vendorRouter);
router.use(vendorPortalRouter);

export default router;

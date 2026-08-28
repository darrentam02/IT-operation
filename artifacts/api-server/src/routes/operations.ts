import { Router, type IRouter } from "express";
import {
  ApproveProcurementParams,
  ApproveProcurementResponse,
  GetDashboardSummaryResponse,
  GetTreasuryAnalyticsResponse,
  ListAuditLogsResponse,
  ListProcurementRecordsResponse,
  ListReleaseGatesResponse,
  ListStaffResponse,
  SearchComplianceBody,
  SearchComplianceResponse,
  ToggleReleaseGateParams,
  ToggleReleaseGateResponse,
  UpdateStaffStatusBody,
  UpdateStaffStatusParams,
  UpdateStaffStatusResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const staff = [
  { id: "s-001", name: "Maya Chen", initials: "MC", role: "Incident Commander", team: "Platform Reliability", region: "HK", status: "On Call - Incidents", ticket: "INC-4821", environment: "PROD", eta: "42 min", updatedAt: "1 min ago", isStale: false },
  { id: "s-002", name: "Ethan Wong", initials: "EW", role: "Release Engineer", team: "Enterprise Apps", region: "HK", status: "Deployment Window", ticket: "REL-2394", environment: "UAT", eta: "1 hr 20 min", updatedAt: "2 min ago", isStale: false },
  { id: "s-003", name: "Aisha Rahman", initials: "AR", role: "Security Analyst", team: "Cyber Defence", region: "MY", status: "Active", ticket: "SEC-8812", environment: "SIT", eta: "3 hr", updatedAt: "6 min ago", isStale: false },
  { id: "s-004", name: "Daniel Lim", initials: "DL", role: "Network Lead", team: "Infrastructure", region: "SG", status: "In Meeting", ticket: "NET-4107", environment: "PROD", eta: "55 min", updatedAt: "11 min ago", isStale: false },
  { id: "s-005", name: "Rina Pratama", initials: "RP", role: "Service Manager", team: "End User Services", region: "ID", status: "Active", ticket: "SR-9271", environment: "STAGING", eta: "2 hr 10 min", updatedAt: "4 hr 18 min ago", isStale: true },
  { id: "s-006", name: "Li Wei", initials: "LW", role: "Database Engineer", team: "Data Platforms", region: "CN", status: "Deployment Window", ticket: "DB-3125", environment: "PROD", eta: "28 min", updatedAt: "3 min ago", isStale: false },
  { id: "s-007", name: "Noor Aziz", initials: "NA", role: "Application Support", team: "Business Systems", region: "MY", status: "Out of Office", ticket: "N/A", environment: "SIT", eta: "Tomorrow", updatedAt: "7 min ago", isStale: false },
  { id: "s-008", name: "Marcus Lau", initials: "ML", role: "Cloud Engineer", team: "Cloud Operations", region: "HK", status: "On Call - Incidents", ticket: "INC-4817", environment: "PROD", eta: "1 hr 5 min", updatedAt: "5 min ago", isStale: false },
];

const releaseGates = [
  { id: "g-01", environment: "SIT", title: "Regression suite passed", owner: "QA Automation", due: "Completed 09:12", checked: true, risk: "Low" },
  { id: "g-02", environment: "SIT", title: "Security scan exceptions reviewed", owner: "Cyber Defence", due: "Completed 09:34", checked: true, risk: "Low" },
  { id: "g-03", environment: "UAT", title: "Business owner sign-off", owner: "Enterprise Apps", due: "Today 15:00", checked: false, risk: "Medium" },
  { id: "g-04", environment: "UAT", title: "Data reconciliation verified", owner: "Data Platforms", due: "Today 16:30", checked: true, risk: "Low" },
  { id: "g-05", environment: "PROD", title: "Rollback plan attached", owner: "Release Engineering", due: "Today 17:00", checked: true, risk: "High" },
  { id: "g-06", environment: "PROD", title: "Change Advisory Board approval", owner: "Head of IT", due: "Today 17:30", checked: false, risk: "Critical" },
];

const procurement = [
  { id: "p-01", prNumber: "PR-2026-0842", poNumber: "PO-2026-0611", vendor: "Nimbus Cloud Services", region: "HK", amount: 428000, currency: "HKD", hkdAmount: 428000, status: "Pending L2 Approval", match: "Matched", createdAt: "28 Aug 2026, 09:18" },
  { id: "p-02", prNumber: "PR-2026-0838", poNumber: "PO-2026-0607", vendor: "Sino Network Systems", region: "CN", amount: 186500, currency: "RMB", hkdAmount: 223800, status: "Variance Blocked", match: "Tax +3.1%", createdAt: "27 Aug 2026, 14:42" },
  { id: "p-03", prNumber: "PR-2026-0831", poNumber: "PO-2026-0599", vendor: "Kuala SecureOps", region: "MY", amount: 92000, currency: "MYR", hkdAmount: 165600, status: "Pending L2 Approval", match: "Matched", createdAt: "26 Aug 2026, 11:03" },
  { id: "p-04", prNumber: "PR-2026-0826", poNumber: "PO-2026-0591", vendor: "Jakarta DataWorks", region: "ID", amount: 840000000, currency: "IDR", hkdAmount: 405600, status: "Payment Approved", match: "Matched", createdAt: "25 Aug 2026, 16:27" },
  { id: "p-05", prNumber: "PR-2026-0819", poNumber: "PO-2026-0583", vendor: "Vertex Managed Services", region: "HK", amount: 780000, currency: "HKD", hkdAmount: 780000, status: "Pending L3 Approval", match: "Matched", createdAt: "24 Aug 2026, 10:15" },
];

const auditLogs = [
  { id: "a-01", actor: "Darren Tam", action: "Approved L2 purchase order", target: "PO-2026-0611", timestamp: "28 Aug 2026, 10:42:18", region: "HK", deputy: false },
  { id: "a-02", actor: "Grace Leung", action: "Activated delegated authority", target: "Head of IT role", timestamp: "28 Aug 2026, 09:58:04", region: "HK", deputy: true },
  { id: "a-03", actor: "Maya Chen", action: "Updated incident status", target: "INC-4821", timestamp: "28 Aug 2026, 09:44:51", region: "HK", deputy: false },
  { id: "a-04", actor: "Finance Control", action: "Blocked payment variance", target: "PO-2026-0607", timestamp: "27 Aug 2026, 16:19:37", region: "CN", deputy: false },
  { id: "a-05", actor: "Ethan Wong", action: "Completed release gate", target: "UAT data reconciliation", timestamp: "27 Aug 2026, 15:52:13", region: "HK", deputy: false },
];

router.get("/dashboard/summary", (_req, res) => {
  const checked = releaseGates.filter((item) => item.checked).length;
  res.json(GetDashboardSummaryResponse.parse({
    activeStaff: 247,
    staleStaff: staff.filter((member) => member.isStale).length,
    pendingApprovals: procurement.filter((item) => item.status.includes("Pending")).length,
    blockedVariances: procurement.filter((item) => item.status.includes("Blocked")).length,
    releaseReadiness: Math.round((checked / releaseGates.length) * 100),
    systemPulse: 99.94,
    lastSync: "Live · refreshed 42s ago",
  }));
});

router.get("/staff", (_req, res) => {
  res.json(ListStaffResponse.parse(staff));
});

router.patch("/staff/:id", (req, res) => {
  const params = UpdateStaffStatusParams.safeParse(req.params);
  const body = UpdateStaffStatusBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid staff status update" });
    return;
  }
  const member = staff.find((item) => item.id === params.data.id);
  if (!member) {
    res.status(404).json({ error: "Staff member not found" });
    return;
  }
  member.status = body.data.status;
  member.updatedAt = "just now";
  member.isStale = false;
  res.json(UpdateStaffStatusResponse.parse(member));
});

router.get("/release-gates", (_req, res) => {
  res.json(ListReleaseGatesResponse.parse(releaseGates));
});

router.patch("/release-gates/:id/check", (req, res) => {
  const params = ToggleReleaseGateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid release gate" });
    return;
  }
  const gate = releaseGates.find((item) => item.id === params.data.id);
  if (!gate) {
    res.status(404).json({ error: "Release gate not found" });
    return;
  }
  gate.checked = !gate.checked;
  res.json(ToggleReleaseGateResponse.parse(gate));
});

router.get("/procurement", (_req, res) => {
  res.json(ListProcurementRecordsResponse.parse(procurement));
});

router.patch("/procurement/:id/approve", (req, res) => {
  const params = ApproveProcurementParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid procurement record" });
    return;
  }
  const record = procurement.find((item) => item.id === params.data.id);
  if (!record) {
    res.status(404).json({ error: "Procurement record not found" });
    return;
  }
  if (record.status.includes("Blocked")) {
    res.status(409).json({ error: "Resolve the financial variance before approval" });
    return;
  }
  record.status = "Payment Approved";
  res.json(ApproveProcurementResponse.parse(record));
});

router.get("/treasury", (_req, res) => {
  res.json(GetTreasuryAnalyticsResponse.parse({
    monthlyPayments: [
      { month: "Mar", paid: 12.8, committed: 14.4 }, { month: "Apr", paid: 15.2, committed: 16.1 },
      { month: "May", paid: 13.7, committed: 15.6 }, { month: "Jun", paid: 18.4, committed: 19.2 },
      { month: "Jul", paid: 16.9, committed: 18.8 }, { month: "Aug", paid: 14.6, committed: 20.4 },
    ],
    businessUnits: [
      { name: "Digital Banking", value: 24, color: "#0f766e" }, { name: "Corporate Systems", value: 18, color: "#2563eb" },
      { name: "Infrastructure", value: 16, color: "#84cc16" }, { name: "Cyber Security", value: 14, color: "#f59e0b" },
      { name: "Data & Analytics", value: 11, color: "#8b5cf6" }, { name: "Regional IT", value: 8, color: "#06b6d4" },
      { name: "End User Services", value: 5, color: "#f97316" }, { name: "Architecture", value: 4, color: "#ec4899" },
    ],
    fxRates: [
      { currency: "RMB/HKD", rate: 1.2, delta: 0 }, { currency: "MYR/HKD", rate: 1.8, delta: -0.4 },
      { currency: "IDR/HKD", rate: 0.000483, delta: 0.2 },
    ],
    totalYtd: 126800000,
    varianceRate: 1.7,
  }));
});

router.post("/compliance/search", (req, res) => {
  const body = SearchComplianceBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Enter a compliance question" });
    return;
  }
  res.json(SearchComplianceResponse.parse({
    answer: "Production changes require completed UAT evidence, an approved rollback plan, named technical and business owners, and Change Advisory Board authorization before the deployment window opens. Emergency changes may use the expedited path, but retrospective review is mandatory within one business day.",
    confidence: 0.94,
    citations: [
      { document: "IT Procedures Manual v3.2", section: "4.1 Production Release Control", page: 28, excerpt: "No production release may proceed without recorded UAT sign-off, rollback readiness, and CAB authorization." },
      { document: "IT Procedures Manual v3.2", section: "4.3 Emergency Change Path", page: 31, excerpt: "Emergency implementation must be followed by retrospective review within one business day." },
    ],
  }));
});

router.get("/audit-logs", (_req, res) => {
  res.json(ListAuditLogsResponse.parse(auditLogs));
});

export default router;
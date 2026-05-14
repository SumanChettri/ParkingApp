const express = require("express");
const Booking = require("../models/Booking");
const Slot = require("../models/Slot");
const { verifyAndOpenGate } = require("../services/gateService");
const { verifyOtp } = require("../services/otpService");
const {
  peekPendingEntryGate,
  consumePendingEntryGate,
  peekPendingExitGate,
  consumePendingExitGate,
  clearPendingEntryMemory,
  clearPendingExitMemory
} = require("../services/iotAppGateQueue");
const iotStateService = require("../services/iotStateService");

const router = express.Router();

const VACATED_SENSOR_GRACE_MS = 15000;
const ACTIVE_OTP_SEARCH_LIMIT = 120;

function normalizeGate(gate) {
  const g = String(gate || "")
    .trim()
    .toLowerCase();
  if (["entry", "in", "enter"].includes(g)) return "entry";
  if (["exit", "out", "leave"].includes(g)) return "exit";
  return null;
}

function parseOccupiedFlag(rawOccupied, rawState) {
  if (typeof rawOccupied === "boolean") return rawOccupied;
  if (typeof rawOccupied === "number") return rawOccupied !== 0;
  if (typeof rawOccupied === "string") {
    const v = rawOccupied.trim().toLowerCase();
    if (["true", "1", "yes", "occupied", "booked"].includes(v)) return true;
    if (["false", "0", "no", "free", "vacant"].includes(v)) return false;
  }
  if (typeof rawState === "string") {
    const s = rawState.trim().toLowerCase();
    if (["occupied", "booked"].includes(s)) return true;
    if (["free", "vacant"].includes(s)) return false;
  }
  return null;
}

function normalizeSensorId(body) {
  if (body?.sensorId) return String(body.sensorId).trim();
  if (body?.slot_id) {
    const m = String(body.slot_id)
      .trim()
      .match(/^a?(\d+)$/i);
    if (m) return `IR-${m[1]}`;
  }
  if (body?.slotNumber != null) return `IR-${Number(body.slotNumber)}`;
  return "";
}

async function findBookingByOtp({ otp, gate }) {
  const type = gate === "exit" ? "exit" : "entry";
  const now = new Date();
  const statusFilter = type === "entry" ? "booked" : "entered";
  const hashField = type === "entry" ? "entryOtpHash" : "exitOtpHash";

  const candidates = await Booking.find({
    status: statusFilter,
    otpExpiresAt: { $gt: now },
    [hashField]: { $nin: ["", null] }
  })
    .sort({ createdAt: -1 })
    .limit(ACTIVE_OTP_SEARCH_LIMIT);

  for (const b of candidates) {
    const hash = b[hashField];
    // OTP is bcrypt-hashed; compare against active candidates.
    // Candidate pool is small (active bookings), so this remains fast.
    // eslint-disable-next-line no-await-in-loop
    const ok = await verifyOtp(String(otp || ""), hash);
    if (ok) return b;
  }
  return null;
}

/** Aggregated slot map for dashboards / ESP polling */
router.get("/slots", async (req, res) => {
  try {
    const slots = await Slot.find().sort({ slotNumber: 1 });
    const freeSlots = slots.filter((s) => s.state === "free").length;
    const bookedSlots = slots.filter((s) => s.state === "reserved").length;
    const shaped = slots.map((s) => ({
      slotNumber: s.slotNumber,
      state: s.state,
      sensorId: s.sensorId,
      lastSensorState: Boolean(s.lastSensorState)
    }));
    res.json({ freeSlots, bookedSlots, slots: shaped });
  } catch (err) {
    res.status(500).json({ message: err.message || "slots failed" });
  }
});

/** Bulk IR line update from ESP (ir1..ir6 === bay occupied when true). */
router.post("/ir-update", async (req, res) => {
  try {
    const body = req.body || {};
    await iotStateService.updateIrFromBody(body);

    for (let i = 1; i <= 6; i += 1) {
      const k = `ir${i}`;
      if (typeof body[k] !== "boolean") continue;
      const occ = body[k];
      const slot = await Slot.findOne({ slotNumber: i });
      if (!slot || slot.state === "reserved") continue;
      slot.lastSensorState = occ;
      slot.state = occ ? "occupied" : "free";
      if (!occ) slot.vacatedAt = null;
      await slot.save();
    }

    const doc = await iotStateService.getDoc();
    res.json({
      success: true,
      irFreeCount: doc.irFreeCount,
      irUsedCount: doc.irUsedCount
    });
  } catch (err) {
    res.status(500).json({ message: err.message || "ir-update failed" });
  }
});

/** ESP8266 entry: merge in-memory app token + Mongo IotState.entryGatePending */
router.get("/entry-gate-pending", async (req, res) => {
  try {
    const mem = peekPendingEntryGate();
    const doc = await iotStateService.getDoc();
    const open = Boolean(mem.open || doc.entryGatePending);
    const out = { open, entryGatePending: doc.entryGatePending };
    if (mem.open && mem.token) {
      out.token = mem.token;
      out.bookingId = mem.bookingId;
    }
    if (open && !out.token) out.token = "pending";
    res.json(out);
  } catch (err) {
    res.status(500).json({ message: err.message || "pending check failed" });
  }
});

router.post("/entry-gate-ack", async (req, res) => {
  try {
    await iotStateService.clearEntryGatePending();
    const token = req.body?.token;
    if (token) consumePendingEntryGate(token);
    clearPendingEntryMemory();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: err.message || "ack failed" });
  }
});

/** ESP32 exit: merge in-memory app token + Mongo IotState.exitGatePending */
router.get("/exit-gate-pending", async (req, res) => {
  try {
    const mem = peekPendingExitGate();
    const doc = await iotStateService.getDoc();
    const open = Boolean(mem.open || doc.exitGatePending);
    const out = { open, exitGatePending: doc.exitGatePending };
    if (mem.open && mem.token) {
      out.token = mem.token;
      out.bookingId = mem.bookingId;
    }
    if (open && !out.token) out.token = "pending";
    res.json(out);
  } catch (err) {
    res.status(500).json({ message: err.message || "pending check failed" });
  }
});

router.post("/exit-gate-ack", async (req, res) => {
  try {
    await iotStateService.clearExitGatePending();
    const token = req.body?.token;
    if (token) consumePendingExitGate(token);
    clearPendingExitMemory();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: err.message || "ack failed" });
  }
});

router.post("/sensor", async (req, res) => {
  try {
    const sensorId = normalizeSensorId(req.body || {});
    const occ = parseOccupiedFlag(req.body?.isOccupied, req.body?.state);
    if (!sensorId || occ === null) {
      return res.status(400).json({
        message:
          "Invalid sensor payload. Expected sensorId (or slot_id) and isOccupied boolean (or state free/occupied)."
      });
    }

    const slot = await Slot.findOne({ sensorId });
    if (!slot) return res.status(404).json({ message: "Sensor mapping not found" });
    slot.lastSensorState = occ;

    if (slot.state === "reserved") {
      await slot.save();
      return res.json({ success: true, suppressed: "reservedSlot" });
    }

    const now = Date.now();
    const vacatedAtMs = slot.vacatedAt ? new Date(slot.vacatedAt).getTime() : 0;
    const recentlyVacated = vacatedAtMs > 0 && now - vacatedAtMs < VACATED_SENSOR_GRACE_MS;
    /** After exit OTP, stay "free" briefly so IR jitter doesn't reclaim the bay before refresh. */
    if (slot.state === "free" && occ === true && recentlyVacated) {
      await slot.save();
      return res.json({ success: true, suppressed: "recentlyVacated" });
    }

    slot.state = occ ? "occupied" : "free";
    slot.vacatedAt = null;
    await slot.save();
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Sensor sync failed" });
  }
});

router.post("/keypad", async (req, res) => {
  const { bookingId, otp } = req.body || {};
  const gate = normalizeGate(req.body?.gate);
  const cleanOtp = String(otp || "").trim();
  if (!cleanOtp || cleanOtp.length < 4 || cleanOtp.length > 8 || !gate) {
    return res.status(400).json({ message: "otp (4-8 digits) and gate (entry|exit) are required" });
  }
  try {
    let resolvedBookingId = bookingId;
    if (!resolvedBookingId) {
      const match = await findBookingByOtp({ otp: cleanOtp, gate });
      if (!match) return res.status(404).json({ message: "No active booking matches this OTP" });
      resolvedBookingId = String(match._id);
    }

    await verifyAndOpenGate({ bookingId: resolvedBookingId, otp: cleanOtp, type: gate });
    res.json({
      success: true,
      gate,
      bookingId: resolvedBookingId,
      servoCommand: "open",
      message: `${gate} gate open signal ready for ESP`
    });
  } catch (err) {
    let status = err.status || 500;
    if (status === 402 || status === 404) status = 401;
    res.status(status).json({ message: err.message || "Keypad verification failed" });
  }
});

module.exports = router;

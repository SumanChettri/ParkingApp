const express = require("express");
const Booking = require("../models/Booking");
const Slot = require("../models/Slot");
const { verifyAndOpenGate } = require("../services/gateService");
const { verifyOtp } = require("../services/otpService");

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
    res.status(err.status || 500).json({ message: err.message || "Keypad verification failed" });
  }
});

module.exports = router;

const express = require("express");
const Booking = require("../models/Booking");
const Slot = require("../models/Slot");
const { verifyAndOpenGate } = require("../services/gateService");
const { verifyOtp } = require("../services/otpService");

const router = express.Router();

const VACATED_SENSOR_GRACE_MS = 15000;

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
    .limit(30);

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
  const { sensorId, isOccupied } = req.body;
  const slot = await Slot.findOne({ sensorId });
  if (!slot) return res.status(404).json({ message: "Sensor mapping not found" });
  const occ = Boolean(isOccupied);
  slot.lastSensorState = occ;

  if (slot.state === "reserved") {
    await slot.save();
    return res.json({ success: true });
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
  res.json({ success: true });
});

router.post("/keypad", async (req, res) => {
  const { bookingId, otp, gate } = req.body;
  if (!otp || !gate || !["entry", "exit"].includes(gate)) {
    return res.status(400).json({ message: "otp and gate (entry|exit) are required" });
  }
  try {
    let resolvedBookingId = bookingId;
    if (!resolvedBookingId) {
      const match = await findBookingByOtp({ otp, gate });
      if (!match) return res.status(404).json({ message: "No active booking matches this OTP" });
      resolvedBookingId = String(match._id);
    }

    await verifyAndOpenGate({ bookingId: resolvedBookingId, otp, type: gate });
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

const express = require("express");
const Booking = require("../models/Booking");
const Slot = require("../models/Slot");
const { verifyAndOpenGate } = require("../services/gateService");
const { issueExitOtpForBooking } = require("../services/otpIssueService");
const {
  otpBufferAfterEndMs,
  VEHICLE_TYPES,
  vehicleHourlyPricingTable,
  graceMinutes,
  rateHintsMinor,
  totalAmountMinorForDuration,
  computeExitQuote
} = require("../services/pricing");

const router = express.Router();

/** One atomic update — avoids two users grabbing the same bay. */
async function allocateSlotAtomically(preferredSlot) {
  const pref =
    preferredSlot !== undefined && preferredSlot !== null && preferredSlot !== "" ? Number(preferredSlot) : null;

  if (pref >= 1 && pref <= 6) {
    const slot = await Slot.findOneAndUpdate(
      { slotNumber: pref, state: "free" },
      { $set: { state: "reserved", vacatedAt: null } },
      { new: true }
    );
    if (slot) return slot;
  }

  return Slot.findOneAndUpdate(
    { state: "free" },
    { $set: { state: "reserved", vacatedAt: null } },
    { new: true, sort: { slotNumber: 1 } }
  );
}

function sanitizeBooking(b) {
  if (!b) return null;
  return {
    bookingId: b._id,
    slotNumber: b.slotNumber,
    status: b.status,
    startTime: b.startTime,
    endTime: b.endTime,
    vehicleNumber: b.vehicleNumber,
    vehicleType: b.vehicleType,
    entryFeePaise: b.entryFeePaise,
    name: b.name,
    email: b.email,
    entryPaid: Boolean(b.entryPaid),
    exitPaid: Boolean(b.exitPaid),
    otpExpiresAt: b.otpExpiresAt,
    demo: {
      entryOtp: b.entryPaid && b.demoEntryOtp ? b.demoEntryOtp : null,
      exitOtp: b.status === "entered" && b.demoExitOtp ? b.demoExitOtp : null
    }
  };
}

/** Public vehicle → entry fee map (minor units) for app UI */
router.get("/pricing", (req, res) => {
  const currency = (process.env.PAYMENT_CURRENCY || "INR").toUpperCase();
  const visitTotalsByDurationMinor = {};
  const durationRateHints = {};
  for (const t of VEHICLE_TYPES) {
    visitTotalsByDurationMinor[t] = {
      "30": totalAmountMinorForDuration(t, 30),
      "60": totalAmountMinorForDuration(t, 60),
      "120": totalAmountMinorForDuration(t, 120)
    };
  }
  for (const mins of [30, 60, 120]) {
    durationRateHints[String(mins)] = {};
    for (const t of VEHICLE_TYPES) {
      durationRateHints[String(mins)][t] = rateHintsMinor(t, mins);
    }
  }

  res.json({
    currency,
    vehicleTypes: VEHICLE_TYPES,
    hourlyRatesMinor: vehicleHourlyPricingTable(),
    amountByDurationMinor: VEHICLE_TYPES.reduce((acc, t) => {
      acc[t] = {
        "30": totalAmountMinorForDuration(t, 30),
        "60": totalAmountMinorForDuration(t, 60),
        "120": totalAmountMinorForDuration(t, 120)
      };
      return acc;
    }, {}),
    graceMinutes: graceMinutes(),
    visitTotalsByDurationMinor,
    durationRateHints
  });
});

/** Issue exit OTP when leaving: free if within booked window + grace; otherwise requires overstay payment first. */
router.post("/:bookingId/issue-exit-otp", async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.bookingId);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    if (booking.status !== "entered") {
      return res.status(400).json({ message: "Exit OTP is available only after successful entry" });
    }
    if (!booking.entryPaid) {
      return res.status(402).json({ message: "Complete entry payment first" });
    }

    const quote = computeExitQuote(booking);
    const overstayMinor = quote.breakdown.totalMinor;
    if (overstayMinor > 0 && !booking.exitPaid) {
      return res.status(402).json({
        message: "Pay overstay fee to receive exit OTP",
        quote,
        requiresExitPayment: true
      });
    }

    const otpStillValid =
      booking.exitOtpHash &&
      booking.demoExitOtp &&
      booking.otpExpiresAt &&
      new Date(booking.otpExpiresAt) > new Date();

    if (!otpStillValid) {
      await issueExitOtpForBooking(booking);
      await booking.save();
    }

    const refreshed = await Booking.findById(booking._id);
    return res.json({
      ok: true,
      quote,
      booking: sanitizeBooking(refreshed)
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Could not issue exit OTP" });
  }
});

router.get("/:bookingId", async (req, res) => {
  try {
    const b = await Booking.findById(req.params.bookingId);
    if (!b) return res.status(404).json({ message: "Booking not found" });
    res.json(sanitizeBooking(b));
  } catch (err) {
    res.status(400).json({ message: err.message || "Invalid booking id" });
  }
});

router.post("/", async (req, res) => {
  const { vehicleType, preferredSlot, durationMins = 60, email = "", name = "Guest", vehicleNumber = "" } = req.body || {};

  if (!vehicleType || !VEHICLE_TYPES.includes(vehicleType)) {
    return res.status(400).json({ message: `vehicleType must be one of: ${VEHICLE_TYPES.join(", ")}` });
  }

  const mins = Number(durationMins);
  if (!Number.isFinite(mins) || mins < 15 || mins > 24 * 60) {
    return res.status(400).json({ message: "durationMins must be between 15 and 1440" });
  }
  const normalizedVehicleNumber = String(vehicleNumber || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!/^[A-Z0-9-]{6,15}$/.test(normalizedVehicleNumber)) {
    return res.status(400).json({ message: "vehicleNumber must be 6-15 chars (A-Z, 0-9, -)" });
  }

  const freeSlot = await allocateSlotAtomically(preferredSlot);
  if (!freeSlot) {
    return res.status(409).json({ message: "All spaces are taken. Try later or reset bays if you’re testing." });
  }

  const startTime = new Date();
  const endTime = new Date(startTime.getTime() + mins * 60 * 1000);
  const endMs = endTime.getTime();
  const bufferMs = otpBufferAfterEndMs();
  const otpExpiresAt = new Date(Math.max(endMs + bufferMs, Date.now() + 30 * 60 * 1000));

  const entryFeePaise = totalAmountMinorForDuration(vehicleType, mins);

  let booking;
  try {
    booking = await Booking.create({
      name: String(name || "Guest").trim() || "Guest",
      email: String(email || "").trim(),
      vehicleNumber: normalizedVehicleNumber,
      vehicleType,
      entryFeePaise,
      slotNumber: freeSlot.slotNumber,
      startTime,
      endTime,
      entryOtpHash: "",
      exitOtpHash: "",
      otpExpiresAt,
      demoEntryOtp: "",
      demoExitOtp: "",
      entryPaid: false,
      exitPaid: false
    });
  } catch (err) {
    await Slot.updateOne({ _id: freeSlot._id }, { $set: { state: "free", vacatedAt: null } });
    if (err?.code === 11000 && String(err?.message || "").includes("vehicleNumber")) {
      return res.status(409).json({ message: "vehicleNumber already has an active/previous booking" });
    }
    return res.status(500).json({ message: err.message || "Could not create booking" });
  }

  res.status(201).json({
    bookingId: booking._id,
    slotNumber: booking.slotNumber,
    vehicleType: booking.vehicleType,
    entryFeePaise: booking.entryFeePaise,
    otpExpiresAt,
    status: booking.status,
    entryPaid: booking.entryPaid,
    exitPaid: booking.exitPaid,
    startTime: booking.startTime,
    endTime: booking.endTime,
    message:
      `Reservation created. Pay total amount for ${Math.max(1, Math.ceil(mins / 60))} booked hour(s). Entry OTP is issued after payment.`
  });
});

router.post("/:bookingId/verify", async (req, res) => {
  const { bookingId } = req.params;
  const { otp, type } = req.body || {};
  try {
    const result = await verifyAndOpenGate({ bookingId, otp, type });
    res.json({ ...result, gate: type, action: "open" });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || "Verification failed" });
  }
});

module.exports = router;

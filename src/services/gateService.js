const Booking = require("../models/Booking");
const Slot = require("../models/Slot");
const { verifyOtp } = require("./otpService");
const {
  signalEntryGateAfterAppVerify,
  signalExitGateAfterAppVerify
} = require("./iotAppGateQueue");
const iotStateService = require("./iotStateService");

/** ₹20/hour, minimum one billable hour, rounded up (e.g. 70 min → 2 hours). */
function computeFlatExitFarePaise(booking, exitAt) {
  const enteredAt = booking.actualEnteredAt ? new Date(booking.actualEnteredAt) : null;
  if (!enteredAt) return { minutes: null, farePaise: null };
  const ms = Math.max(0, exitAt.getTime() - enteredAt.getTime());
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  const billableHours = Math.max(1, Math.ceil(minutes / 60));
  const HOURLY_PAISE = 2000; // ₹20 in paise
  return { minutes, farePaise: billableHours * HOURLY_PAISE };
}

function validateGateType(type) {
  const isEntry = type === "entry";
  const isExit = type === "exit";
  if (!isEntry && !isExit) {
    const err = new Error("type must be entry or exit");
    err.status = 400;
    throw err;
  }
  return { isEntry, isExit };
}

function validateBookingState(booking, isEntry) {
  if (new Date() > booking.otpExpiresAt) {
    const err = new Error("OTP expired");
    err.status = 400;
    throw err;
  }
  if (isEntry && !booking.entryPaid) {
    const err = new Error("Complete entry payment to receive an entry OTP");
    err.status = 402;
    throw err;
  }
  if (isEntry && booking.status !== "booked") {
    const err = new Error("Entry already completed or booking is not active");
    err.status = 409;
    throw err;
  }
  if (!isEntry && booking.status !== "entered") {
    const err = new Error("Exit allowed only after successful entry");
    err.status = 409;
    throw err;
  }
}

async function verifyAndOpenGate({ bookingId, otp, type, queueRemoteOpenFromApp: _legacy = false }) {
  const { isEntry, isExit } = validateGateType(type);
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    const err = new Error("Booking not found");
    err.status = 404;
    throw err;
  }
  validateBookingState(booking, isEntry);

  const hash = isEntry ? booking.entryOtpHash : booking.exitOtpHash;
  if (!hash) {
    const err = new Error(isEntry ? "Entry OTP not issued yet" : "Exit OTP not issued yet");
    err.status = 400;
    throw err;
  }
  const isValid = await verifyOtp(String(otp || ""), hash);
  if (!isValid) {
    const err = new Error("Invalid OTP");
    err.status = 401;
    throw err;
  }

  const now = new Date();
  if (isEntry) {
    booking.status = "entered";
    booking.actualEnteredAt = now;
    booking.entryOtpUsedAt = now;
    booking.entryOtpHash = "";
    booking.demoEntryOtp = "";
  } else {
    const { minutes, farePaise } = computeFlatExitFarePaise(booking, now);
    booking.exitDurationMinutes = minutes;
    booking.exitFarePaise = farePaise;
    booking.status = "exited";
    booking.actualExitedAt = now;
    booking.exitOtpUsedAt = now;
    booking.exitOtpHash = "";
    booking.demoExitOtp = "";
  }
  await booking.save();

  // ESP firmware polls /entry-gate-pending and /exit-gate-pending and expects a
  // short-lived token in JSON. Always queue it for keypad *and* app verification,
  // otherwise Mongo-only flags never satisfy the entry device's token check.
  if (isEntry) {
    signalEntryGateAfterAppVerify(booking._id);
    await iotStateService.setEntryGatePending(true);
  }
  if (isExit) {
    signalExitGateAfterAppVerify(booking._id);
    await iotStateService.setExitGatePending(true);
  }

  const slot = await Slot.findOne({ slotNumber: booking.slotNumber });
  if (slot) {
    if (isEntry) {
      slot.state = "occupied";
      slot.vacatedAt = null;
    } else {
      slot.state = "free";
      slot.vacatedAt = now;
    }
    await slot.save();
  }

  return {
    success: true,
    status: booking.status,
    entryPaid: booking.entryPaid,
    exitPaid: booking.exitPaid,
    otpExpiresAt: booking.otpExpiresAt,
    exitFarePaise: booking.exitFarePaise,
    exitDurationMinutes: booking.exitDurationMinutes
  };
}

module.exports = { verifyAndOpenGate };

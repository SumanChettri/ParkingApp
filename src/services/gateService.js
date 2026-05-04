const Booking = require("../models/Booking");
const Slot = require("../models/Slot");
const { verifyOtp } = require("./otpService");

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

async function verifyAndOpenGate({ bookingId, otp, type }) {
  const { isEntry } = validateGateType(type);
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
    booking.status = "exited";
    booking.actualExitedAt = now;
    booking.exitOtpUsedAt = now;
    booking.exitOtpHash = "";
    booking.demoExitOtp = "";
  }
  await booking.save();

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
    otpExpiresAt: booking.otpExpiresAt
  };
}

module.exports = { verifyAndOpenGate };

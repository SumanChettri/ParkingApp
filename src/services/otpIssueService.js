const { generateOtp, hashOtp } = require("./otpService");
const { otpBufferAfterEndMs, graceMinutes } = require("./pricing");
const { sendEntryOtpEmail, sendExitOtpEmail } = require("./emailService");
const Booking = require("../models/Booking");

function validEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

async function issueEntryOtpForBooking(booking) {
  const entryOtp = await generateUniqueOtp();
  booking.demoEntryOtp = entryOtp;
  booking.entryOtpHash = await hashOtp(entryOtp);
  booking.entryOtpUsedAt = null;
  const endMs = new Date(booking.endTime).getTime();
  const bufferMs = otpBufferAfterEndMs();
  booking.otpExpiresAt = new Date(Math.max(endMs + bufferMs, Date.now() + 30 * 60 * 1000));
  if (validEmail(booking.email)) {
    await sendEntryOtpEmail({
      to: booking.email.trim(),
      name: booking.name || "Guest",
      slotNumber: booking.slotNumber,
      entryOtp
    });
  }
}

async function issueExitOtpForBooking(booking) {
  const exitOtp = await generateUniqueOtp();
  booking.demoExitOtp = exitOtp;
  booking.exitOtpHash = await hashOtp(exitOtp);
  booking.exitOtpUsedAt = null;
  booking.otpExpiresAt = new Date(Date.now() + Math.max(otpBufferAfterEndMs(), 30 * 60 * 1000));
  if (validEmail(booking.email)) {
    await sendExitOtpEmail({
      to: booking.email.trim(),
      name: booking.name || "Guest",
      slotNumber: booking.slotNumber,
      exitOtp,
      graceMinutes: graceMinutes()
    });
  }
}

async function generateUniqueOtp(maxAttempts = 15) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const otp = generateOtp();
    const exists = await Booking.exists({
      $or: [{ demoEntryOtp: otp }, { demoExitOtp: otp }],
      otpExpiresAt: { $gt: new Date() }
    });
    if (!exists) return otp;
  }
  return generateOtp();
}

module.exports = { issueEntryOtpForBooking, issueExitOtpForBooking };

const crypto = require("crypto");
const express = require("express");
const Booking = require("../models/Booking");
const { computeExitQuote, totalAmountMinorForDuration } = require("../services/pricing");
const { skipPayment, paymentCurrency } = require("../services/paymentConfig");
const { getRazorpay } = require("../services/razorpayClient");
const { issueEntryOtpForBooking, issueExitOtpForBooking } = require("../services/otpIssueService");

const router = express.Router();

const MIN_RAZORPAY_INR = 100;

function verifyRazorpaySignature(orderId, paymentId, signature) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret || !signature) return false;
  const body = `${orderId}|${paymentId}`;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex").toLowerCase();
  const sig = String(signature).trim().toLowerCase();
  if (expected.length !== sig.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(sig, "utf8"));
  } catch {
    return false;
  }
}

function entryAmountForBooking(booking) {
  const snap = Number(booking.entryFeePaise);
  if (Number.isFinite(snap) && snap > 0) return snap;
  const startMs = new Date(booking.startTime).getTime();
  const endMs = new Date(booking.endTime).getTime();
  const mins = Math.max(15, Math.ceil((endMs - startMs) / 60000));
  return totalAmountMinorForDuration(booking.vehicleType, mins);
}

function razorpayErrMessage(err) {
  if (!err) return "Razorpay request failed";
  if (typeof err.error === "string") return err.error;
  if (err.error?.description) return err.error.description;
  if (err.error?.field && err.error?.description) return `${err.error.field}: ${err.error.description}`;
  return err.message || "Razorpay request failed";
}

router.post("/create-order", async (req, res) => {
  try {
    const { bookingId, phase } = req.body || {};
    if (!bookingId || !["entry", "exit"].includes(phase)) {
      return res.status(400).json({ message: "bookingId and phase (entry|exit) required" });
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (phase === "exit") {
      if (booking.status !== "entered") {
        return res.status(400).json({ message: "Vehicle must complete entry before exit payment" });
      }
      const quote = computeExitQuote(booking);
      const amountMinorRaw = quote.breakdown.totalMinor;
      if (amountMinorRaw <= 0) {
        return res.json({
          alreadyPaid: true,
          skipPayment: true,
          phase: "exit",
          amount: 0,
          currency: paymentCurrency(),
          quote,
          message: "No overstay fee — use Get exit code instead."
        });
      }
      if (booking.exitPaid) {
        return res.json({ alreadyPaid: true, skipPayment: true, phase: "exit", quote });
      }

      const currency = paymentCurrency();
      let amountMinor = amountMinorRaw;
      if (currency === "INR") {
        amountMinor = Math.max(amountMinor, MIN_RAZORPAY_INR);
      } else {
        amountMinor = Math.max(amountMinor, 1);
      }

      if (skipPayment()) {
        return res.json({
          skipPayment: true,
          keyId: null,
          orderId: null,
          amount: amountMinor,
          currency,
          phase,
          quote
        });
      }

      const rp = getRazorpay();
      if (!rp) {
        return res.status(503).json({
          message:
            "Razorpay keys missing. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in backend/.env, or SKIP_PAYMENT=true for demos."
        });
      }

      let receipt = `r_${String(booking._id).slice(-8)}_x${Date.now().toString(36)}`;
      if (receipt.length > 40) receipt = receipt.slice(0, 40);

      let order;
      try {
        order = await rp.orders.create({
          amount: amountMinor,
          currency,
          receipt,
          notes: {
            bookingId: String(booking._id),
            phase: "exit"
          }
        });
      } catch (rpErr) {
        console.error("Razorpay orders.create (exit)", rpErr);
        return res.status(503).json({ message: razorpayErrMessage(rpErr) });
      }

      booking.razorpayExitOrderId = order.id;
      await booking.save();

      return res.json({
        skipPayment: false,
        keyId: process.env.RAZORPAY_KEY_ID,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        phase,
        quote,
        businessName: process.env.RAZORPAY_BUSINESS_NAME || "Smart Parking",
        testMode: String(process.env.RAZORPAY_KEY_ID || "").startsWith("rzp_test_")
      });
    }

    /* phase === entry */
    if (booking.entryPaid) {
      return res.json({ alreadyPaid: true, skipPayment: true });
    }

    const currency = paymentCurrency();
    let amountMinor = entryAmountForBooking(booking);

    if (currency === "INR") {
      amountMinor = Math.max(amountMinor, MIN_RAZORPAY_INR);
    } else {
      amountMinor = Math.max(amountMinor, 1);
    }

    if (skipPayment()) {
      return res.json({
        skipPayment: true,
        keyId: null,
        orderId: null,
        amount: amountMinor,
        currency,
        phase,
        quote: null
      });
    }

    const rp = getRazorpay();
    if (!rp) {
      return res.status(503).json({
        message:
          "Razorpay keys missing. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in backend/.env, or SKIP_PAYMENT=true for demos."
      });
    }

    let receipt = `r_${String(booking._id).slice(-8)}_e${Date.now().toString(36)}`;
    if (receipt.length > 40) receipt = receipt.slice(0, 40);

    let order;
    try {
      order = await rp.orders.create({
        amount: amountMinor,
        currency,
        receipt,
        notes: {
          bookingId: String(booking._id),
          phase: "entry"
        }
      });
    } catch (rpErr) {
      console.error("Razorpay orders.create (entry)", rpErr);
      return res.status(503).json({ message: razorpayErrMessage(rpErr) });
    }

    booking.razorpayEntryOrderId = order.id;
    await booking.save();

    return res.json({
      skipPayment: false,
      keyId: process.env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      phase,
      quote: null,
      businessName: process.env.RAZORPAY_BUSINESS_NAME || "Smart Parking",
      testMode: String(process.env.RAZORPAY_KEY_ID || "").startsWith("rzp_test_")
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message || "Could not create order" });
  }
});

router.post("/verify", async (req, res) => {
  try {
    const { bookingId, phase, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!bookingId || !["entry", "exit"].includes(phase)) {
      return res.status(400).json({ message: "bookingId and phase required" });
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (skipPayment()) {
      if (phase === "entry") {
        if (booking.entryPaid) return res.json({ ok: true, devBypass: true });
        booking.entryPaid = true;
        await issueEntryOtpForBooking(booking);
      } else {
        if (booking.status !== "entered") {
          return res.status(400).json({ message: "Vehicle must complete entry before exit payment" });
        }
        const quote = computeExitQuote(booking);
        if (quote.breakdown.totalMinor <= 0) {
          return res.json({ ok: true, devBypass: true, message: "No overstay fee due" });
        }
        if (booking.exitPaid) return res.json({ ok: true, devBypass: true });
        booking.exitPaid = true;
        await issueExitOtpForBooking(booking);
      }
      await booking.save();
      return res.json({ ok: true, devBypass: true });
    }

    const rp = getRazorpay();
    if (!rp) {
      return res.status(503).json({
        message:
          "Razorpay not configured. Add RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET or set SKIP_PAYMENT=true."
      });
    }

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: "Razorpay payment fields required" });
    }

    if (phase === "exit") {
      if (booking.status !== "entered") {
        return res.status(400).json({ message: "Vehicle must complete entry before exit payment" });
      }
      const quote = computeExitQuote(booking);
      if (quote.breakdown.totalMinor <= 0) {
        return res.json({ ok: true, skipped: true, reason: "No overstay fee" });
      }
      if (booking.exitPaid) return res.json({ ok: true });

      const expectedOrder = booking.razorpayExitOrderId;
      if (expectedOrder && expectedOrder !== razorpay_order_id) {
        return res.status(400).json({ message: "Order id does not match booking (exit)" });
      }

      if (!verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
        return res.status(400).json({ message: "Invalid payment signature" });
      }

      const payment = await rp.payments.fetch(razorpay_payment_id);
      const okStatus = ["captured", "authorized"];
      if (!okStatus.includes(payment.status)) {
        return res.status(400).json({ message: `Payment not completed (status: ${payment.status})` });
      }
      if (String(payment.order_id) !== String(razorpay_order_id)) {
        return res.status(400).json({ message: "Payment does not match order" });
      }

      booking.exitPaid = true;
      booking.razorpayExitPaymentId = razorpay_payment_id;
      await issueExitOtpForBooking(booking);
      await booking.save();
      return res.json({ ok: true });
    }

    /* entry */
    const expectedOrder = booking.razorpayEntryOrderId;
    if (expectedOrder && expectedOrder !== razorpay_order_id) {
      return res.status(400).json({ message: "Order id does not match booking" });
    }

    if (!verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
      return res.status(400).json({ message: "Invalid payment signature" });
    }

    const payment = await rp.payments.fetch(razorpay_payment_id);
    const okStatus = ["captured", "authorized"];
    if (!okStatus.includes(payment.status)) {
      return res.status(400).json({ message: `Payment not completed (status: ${payment.status})` });
    }
    if (String(payment.order_id) !== String(razorpay_order_id)) {
      return res.status(400).json({ message: "Payment does not match order" });
    }

    if (booking.entryPaid) return res.json({ ok: true });
    booking.entryPaid = true;
    booking.razorpayEntryPaymentId = razorpay_payment_id;
    await issueEntryOtpForBooking(booking);
    await booking.save();

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message || "Verify failed" });
  }
});

router.get("/exit-quote/:bookingId", async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.bookingId);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    const quote = computeExitQuote(booking);
    const needsExitPayment = quote.breakdown.totalMinor > 0 && !booking.exitPaid;
    return res.json({
      ...quote,
      entryPaid: booking.entryPaid,
      exitPaid: booking.exitPaid,
      status: booking.status,
      requiresExitPayment: needsExitPayment
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Quote failed" });
  }
});

module.exports = { router };

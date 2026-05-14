function skipPayment() {
  const forceFake = String(process.env.FORCE_FAKE_PAYMENTS || "").toLowerCase() === "true";
  const wantDemoSkip = String(process.env.SKIP_PAYMENT || "").toLowerCase() === "true";
  if (forceFake || wantDemoSkip) return true;

  const hasRazorpay = Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
  if (hasRazorpay) return false;
  return true;
}

function paymentCurrency() {
  return (process.env.PAYMENT_CURRENCY || "INR").toUpperCase();
}

module.exports = { skipPayment, paymentCurrency };

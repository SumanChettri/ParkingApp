/** True only when SKIP_PAYMENT=true AND Razorpay keys are absent (local demo without checkout). If keys exist, checkout always runs — test (`rzp_test_*`) or live. */
function skipPayment() {
  const wantDemoSkip = String(process.env.SKIP_PAYMENT || "").toLowerCase() === "true";
  const hasRazorpay = Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
  if (hasRazorpay && wantDemoSkip) {
    console.warn(
      "[payments] SKIP_PAYMENT is ignored because RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set — using Razorpay checkout."
    );
  }
  if (hasRazorpay) return false;
  return wantDemoSkip;
}

function paymentCurrency() {
  return (process.env.PAYMENT_CURRENCY || "INR").toUpperCase();
}

module.exports = { skipPayment, paymentCurrency };

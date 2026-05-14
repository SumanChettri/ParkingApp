const crypto = require("crypto");

/**
 * Short-lived signals for ESP8266/ESP32 polling after the driver verifies OTP in the app.
 * In-memory only (single Node process / one Render dyno).
 */
const TTL_MS = 120000;

let pendingEntry = null;
let pendingExit = null;

function makePending(bookingId) {
  return {
    bookingId: String(bookingId),
    token: crypto.randomBytes(16).toString("hex"),
    expiresAt: Date.now() + TTL_MS
  };
}

function signalEntryGateAfterAppVerify(bookingId) {
  pendingEntry = makePending(bookingId);
}

function signalExitGateAfterAppVerify(bookingId) {
  pendingExit = makePending(bookingId);
}

function peekPending(kind) {
  const p = kind === "entry" ? pendingEntry : pendingExit;
  if (!p || Date.now() > p.expiresAt) {
    if (kind === "entry") pendingEntry = null;
    else pendingExit = null;
    return { open: false };
  }
  return {
    open: true,
    token: p.token,
    bookingId: p.bookingId
  };
}

function consumePending(kind, token) {
  const p = kind === "entry" ? pendingEntry : pendingExit;
  if (!p || Date.now() > p.expiresAt) {
    if (kind === "entry") pendingEntry = null;
    else pendingExit = null;
    return false;
  }
  if (String(token || "") !== p.token) return false;
  if (kind === "entry") pendingEntry = null;
  else pendingExit = null;
  return true;
}

function clearPendingExitMemory() {
  pendingExit = null;
}

function clearPendingEntryMemory() {
  pendingEntry = null;
}

/** Admin / bench test: entry ESP sees token + open */
function forceAdminEntryGateSignal() {
  pendingEntry = makePending("000000000000000000000001");
}

/** Admin / bench: exit ESP sees token + open like a real OTP unlock. */
function forceAdminExitGateSignal() {
  pendingExit = makePending("000000000000000000000002");
}

module.exports = {
  signalEntryGateAfterAppVerify,
  signalExitGateAfterAppVerify,
  peekPendingEntryGate: () => peekPending("entry"),
  peekPendingExitGate: () => peekPending("exit"),
  consumePendingEntryGate: (token) => consumePending("entry", token),
  consumePendingExitGate: (token) => consumePending("exit", token),
  clearPendingExitMemory,
  clearPendingEntryMemory,
  forceAdminEntryGateSignal,
  forceAdminExitGateSignal
};

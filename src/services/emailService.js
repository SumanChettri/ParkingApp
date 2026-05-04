const nodemailer = require("nodemailer");

function createTransporter() {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
  }
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
}

const transporter = createTransporter();

function mailConfigured() {
  return Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

async function sendEntryOtpEmail({ to, name, slotNumber, entryOtp }) {
  if (!mailConfigured() || !to) {
    console.log("Email skipped (no credentials or recipient).");
    return;
  }

  const html = `
    <h2>Smart Parking — Entry OTP</h2>
    <p>Hello ${name}, your bay <b>${slotNumber}</b> is reserved.</p>
    <p><b>Entry OTP</b> (enter on the <b>entry</b> ESP8266 keypad after the gate servo arms):</p>
    <p style="font-size:22px;font-weight:bold;letter-spacing:4px;">${entryOtp}</p>
    <p>Do not share this code. It is issued only after entry payment.</p>
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject: "Smart Parking — Entry gate OTP",
    html
  });
}

async function sendExitOtpEmail({ to, name, slotNumber, exitOtp, graceMinutes: gm }) {
  if (!mailConfigured() || !to) {
    console.log("Email skipped (no credentials or recipient).");
    return;
  }

  const html = `
    <h2>Smart Parking — Exit OTP</h2>
    <p>Hello ${name}, departure for bay <b>${slotNumber}</b> is cleared.</p>
    <p>Late stay beyond your booked window is billed after a <b>${gm ?? 10}-minute</b> grace period.</p>
    <p><b>Exit OTP</b> (enter on the <b>exit</b> ESP32 keypad; IR bays confirm clearance):</p>
    <p style="font-size:22px;font-weight:bold;letter-spacing:4px;">${exitOtp}</p>
    <p>Do not share this code. It is issued only after exit settlement.</p>
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject: "Smart Parking — Exit gate OTP",
    html
  });
}

module.exports = { sendEntryOtpEmail, sendExitOtpEmail };

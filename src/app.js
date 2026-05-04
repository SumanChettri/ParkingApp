const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const cors = require("cors");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { connectDB } = require("./config/db");
const Slot = require("./models/Slot");
const slotRoutes = require("./routes/slotRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const iotRoutes = require("./routes/iotRoutes");
const { router: paymentRouter } = require("./routes/paymentRoutes");

const app = express();
app.use(cors());

app.use(express.json());

app.use("/api/slots", slotRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/payments", paymentRouter);
app.use("/api/iot", iotRoutes);

app.get("/api/test", (req, res) => {
  res.json({
    success: true,
    message: "Backend working",
    time: new Date().toISOString()
  });
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.on("connection", (socket) => {
  socket.emit("connected", { ok: true });
});

async function seedSlots() {
  const existing = await Slot.countDocuments();
  if (existing > 0) return;
  const docs = [];
  for (let i = 1; i <= 6; i += 1) {
    docs.push({ slotNumber: i, sensorId: `IR-${i}`, state: "free" });
  }
  await Slot.insertMany(docs);
  console.log("Seeded 6 parking slots");
}

async function boot() {
  await connectDB();
  await seedSlots();
  const port = process.env.PORT || 5000;
  const host = process.env.HOST || "0.0.0.0";
  server.listen(port, host, () => console.log(`Backend listening on http://${host}:${port}`));
}

boot().catch((err) => {
  console.error(err);
  process.exit(1);
});

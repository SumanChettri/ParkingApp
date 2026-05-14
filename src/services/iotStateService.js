const IotState = require("../models/IotState");
const IOT_SINGLETON_KEY = IotState.IOT_SINGLETON_KEY || "global";

async function getDoc() {
  let doc = await IotState.findOne({ key: IOT_SINGLETON_KEY });
  if (!doc) {
    doc = await IotState.create({ key: IOT_SINGLETON_KEY });
  }
  return doc;
}

function recalcIrCounts(body) {
  let used = 0;
  for (let i = 1; i <= 6; i += 1) {
    const k = `ir${i}`;
    if (body && body[k] === true) used += 1;
  }
  return { irFreeCount: 6 - used, irUsedCount: used };
}

async function setExitGatePending(value) {
  await IotState.findOneAndUpdate(
    { key: IOT_SINGLETON_KEY },
    { $set: { exitGatePending: Boolean(value) } },
    { upsert: true, new: true }
  );
}

async function setEntryGatePending(value) {
  await IotState.findOneAndUpdate(
    { key: IOT_SINGLETON_KEY },
    { $set: { entryGatePending: Boolean(value) } },
    { upsert: true, new: true }
  );
}

async function updateIrFromBody(body) {
  const doc = await getDoc();
  const merged = {};
  for (let i = 1; i <= 6; i += 1) {
    const k = `ir${i}`;
    merged[k] = typeof body?.[k] === "boolean" ? body[k] : Boolean(doc[k]);
  }
  const counts = recalcIrCounts(merged);
  await IotState.findOneAndUpdate(
    { key: IOT_SINGLETON_KEY },
    { $set: { ...merged, ...counts } },
    { upsert: true, new: true }
  );
  return getDoc();
}

async function clearExitGatePending() {
  await setExitGatePending(false);
}

async function clearEntryGatePending() {
  await setEntryGatePending(false);
}

async function seedIotStateIfMissing() {
  const n = await IotState.countDocuments({ key: IOT_SINGLETON_KEY });
  if (n === 0) await IotState.create({ key: IOT_SINGLETON_KEY });
}

module.exports = {
  getDoc,
  setExitGatePending,
  setEntryGatePending,
  updateIrFromBody,
  clearExitGatePending,
  clearEntryGatePending,
  recalcIrCounts,
  seedIotStateIfMissing
};

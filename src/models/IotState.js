const mongoose = require("mongoose");

const IOT_SINGLETON_KEY = "global";

const iotStateSchema = new mongoose.Schema(
  {
    key: { type: String, default: IOT_SINGLETON_KEY, unique: true },
    exitGatePending: { type: Boolean, default: false },
    entryGatePending: { type: Boolean, default: false },
    ir1: { type: Boolean, default: false },
    ir2: { type: Boolean, default: false },
    ir3: { type: Boolean, default: false },
    ir4: { type: Boolean, default: false },
    ir5: { type: Boolean, default: false },
    ir6: { type: Boolean, default: false },
    irFreeCount: { type: Number, default: 6 },
    irUsedCount: { type: Number, default: 0 }
  },
  { timestamps: true }
);

const IotStateModel = mongoose.model("IotState", iotStateSchema);
IotStateModel.IOT_SINGLETON_KEY = IOT_SINGLETON_KEY;
module.exports = IotStateModel;

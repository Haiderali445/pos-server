const mongoose = require("mongoose");
const { softDeletePlugin } = require("./plugins/softDelete");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    userId: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    verified: {
      type: Boolean,
      default: false,
    },
    role: {
      type: String,
      enum: ["admin", "manager", "cashier"],
      default: "cashier",
    },
    permissions: {
      type: [String],
      default: [],
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

userSchema.plugin(softDeletePlugin);

// Unique user ID per tenant
userSchema.index({ tenantId: 1, userId: 1 }, { unique: true });

const User = mongoose.models.users || mongoose.model("users", userSchema);

module.exports = User;

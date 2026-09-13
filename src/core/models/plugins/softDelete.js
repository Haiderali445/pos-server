const { DEFAULT_TENANT_ID } = require("../../database/tenantManager");

function softDeletePlugin(schema) {
  schema.add({
    tenantId: {
      type: String,
      default: DEFAULT_TENANT_ID,
      index: true,
      trim: true,
      lowercase: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: String,
      default: null,
    },
  });

  const filterNonDeleted = function (next) {
    if (!this.getOptions().withDeleted) {
      this.where({ isDeleted: { $ne: true } });
    }
    next();
  };

  schema.pre("find", filterNonDeleted);
  schema.pre("findOne", filterNonDeleted);
  schema.pre("findOneAndUpdate", filterNonDeleted);
  schema.pre("countDocuments", filterNonDeleted);

  schema.methods.softDelete = async function (deletedBy = "system") {
    this.isDeleted = true;
    this.deletedAt = new Date();
    this.deletedBy = deletedBy;
    return this.save();
  };

  schema.methods.restore = async function () {
    this.isDeleted = false;
    this.deletedAt = null;
    this.deletedBy = null;
    return this.save();
  };
}

module.exports = { softDeletePlugin };

const Charge = require("../../core/models/Charge");
const { NotFoundError, BadRequestError } = require("../../core/errors/AppError");

class ChargesService {
  async getCharges({ tenantId = "default-store", search = "" } = {}) {
    const query = { tenantId };
    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), "i");
      query.$or = [{ description: regex }, { category: regex }];
    }
    return Charge.find(query).sort({ date: -1, createdAt: -1 });
  }

  async getChargeById(id, tenantId = "default-store") {
    const charge = await Charge.findOne({ _id: id, tenantId });
    if (!charge) throw new NotFoundError("Expense record not found");
    return charge;
  }

  async addCharge(data, tenantId = "default-store") {
    if (!data.description || data.amount === undefined || data.amount === null) {
      throw new BadRequestError("Expense description and amount are required");
    }

    return Charge.create({
      description: data.description.trim(),
      amount: Number(data.amount),
      category: data.category || "general",
      date: data.date ? new Date(data.date) : new Date(),
      tenantId,
    });
  }

  async editCharge(data, tenantId = "default-store") {
    const id = data._id || data.chargeId;
    if (!id) throw new BadRequestError("Expense ID is required for editing");

    const charge = await Charge.findOne({ _id: id, tenantId });
    if (!charge) throw new NotFoundError("Expense record not found");

    if (data.description) charge.description = data.description.trim();
    if (data.amount !== undefined) charge.amount = Number(data.amount);
    if (data.category) charge.category = data.category.trim();
    if (data.date) charge.date = new Date(data.date);

    await charge.save();
    return charge;
  }

  async deleteCharge(id, tenantId = "default-store", deletedBy = "system") {
    if (!id) throw new BadRequestError("Expense ID is required");
    const charge = await Charge.findOne({ _id: id, tenantId });
    if (!charge) throw new NotFoundError("Expense record not found");

    await charge.softDelete(deletedBy);
    return { message: "Expense record deleted successfully", charge };
  }
}

module.exports = ChargesService;

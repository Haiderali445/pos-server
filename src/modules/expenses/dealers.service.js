const Dealer = require("../../core/models/Dealer");
const { NotFoundError, BadRequestError } = require("../../core/errors/AppError");

class DealersService {
  async getDealers({ tenantId = "default-store", search = "" } = {}) {
    const query = { tenantId };
    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), "i");
      query.$or = [{ dealerName: regex }, { contactName: regex }, { shopName: regex }];
    }
    return Dealer.find(query).sort({ createdAt: -1 });
  }

  async getDealerById(id, tenantId = "default-store") {
    const dealer = await Dealer.findOne({ _id: id, tenantId });
    if (!dealer) throw new NotFoundError("Dealer not found");
    return dealer;
  }

  async addDealer(data, tenantId = "default-store") {
    if (!data.dealerName || !data.contactName || !data.shopName || !data.address) {
      throw new BadRequestError("Dealer name, contact person, shop name, and address are required");
    }

    return Dealer.create({
      dealerName: data.dealerName.trim(),
      contactName: data.contactName.trim(),
      shopName: data.shopName.trim(),
      address: data.address.trim(),
      products: data.products || "",
      tenantId,
    });
  }

  async editDealer(data, tenantId = "default-store") {
    const id = data._id || data.dealerId;
    if (!id) throw new BadRequestError("Dealer ID is required for editing");

    const dealer = await Dealer.findOne({ _id: id, tenantId });
    if (!dealer) throw new NotFoundError("Dealer not found");

    if (data.dealerName) dealer.dealerName = data.dealerName.trim();
    if (data.contactName) dealer.contactName = data.contactName.trim();
    if (data.shopName) dealer.shopName = data.shopName.trim();
    if (data.address) dealer.address = data.address.trim();
    if (data.products !== undefined) dealer.products = data.products;

    await dealer.save();
    return dealer;
  }

  async deleteDealer(id, tenantId = "default-store", deletedBy = "system") {
    if (!id) throw new BadRequestError("Dealer ID is required");
    const dealer = await Dealer.findOne({ _id: id, tenantId });
    if (!dealer) throw new NotFoundError("Dealer not found");

    await dealer.softDelete(deletedBy);
    return { message: "Dealer deleted successfully", dealer };
  }
}

module.exports = DealersService;

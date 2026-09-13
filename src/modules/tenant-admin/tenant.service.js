const bcrypt = require("bcrypt");
const User = require("../../core/models/User");
const Tenant = require("../../core/models/Tenant");
const { NotFoundError, BadRequestError, ConflictError } = require("../../core/errors/AppError");
const { appEvents } = require("../../core/events/eventEmitter");
const { EVENT_TYPES } = require("../../core/events/eventTypes");

class TenantService {
  constructor({ passwordHasher = bcrypt } = {}) {
    this.passwordHasher = passwordHasher;
  }

  async getAllUsers(tenantId = "default-store") {
    return User.find({ tenantId }).sort({ createdAt: -1 });
  }

  async adminCreateUser(data, tenantId = "default-store") {
    const { name, password, role = "cashier", active = true, permissions = [] } = data;

    if (!name || !password) {
      throw new BadRequestError("Name and password are required");
    }

    let finalUserId = data.userId && data.userId.trim()
      ? data.userId.trim().toLowerCase()
      : await this.generateCashierId(tenantId);

    const existing = await User.findOne({ tenantId, userId: finalUserId });
    if (existing) {
      throw new ConflictError(`User ID '${finalUserId}' already exists for this store`);
    }

    const validRoles = ["admin", "manager", "cashier"];
    const finalRole = validRoles.includes(role) ? role : "cashier";

    const passwordHash = await this.passwordHasher.hash(password, 12);

    const newUser = await User.create({
      name: name.trim(),
      userId: finalUserId,
      password: passwordHash,
      role: finalRole,
      permissions,
      active: active !== false,
      tenantId,
    });

    appEvents.emitEvent(EVENT_TYPES.USER_CREATED, {
      userId: newUser.userId,
      role: newUser.role,
      tenantId,
    });

    return {
      _id: newUser._id,
      userId: newUser.userId,
      name: newUser.name,
      role: newUser.role,
      active: newUser.active,
      permissions: newUser.permissions,
      createdAt: newUser.createdAt,
    };
  }

  async toggleUserStatus(userId, active, tenantId = "default-store") {
    if (!userId) throw new BadRequestError("User ID is required");

    const user = await User.findOne({ tenantId, userId: userId.trim().toLowerCase() });
    if (!user) throw new NotFoundError("User not found");

    user.active = Boolean(active);
    await user.save();
    return user;
  }

  async updateUserRole(userId, role, tenantId = "default-store") {
    if (!userId || !role) throw new BadRequestError("User ID and role are required");

    const validRoles = ["admin", "manager", "cashier"];
    if (!validRoles.includes(role.toLowerCase())) {
      throw new BadRequestError("Invalid role specified");
    }

    const user = await User.findOne({ tenantId, userId: userId.trim().toLowerCase() });
    if (!user) throw new NotFoundError("User not found");

    user.role = role.toLowerCase();
    await user.save();
    return user;
  }

  async deleteUser(userId, tenantId = "default-store") {
    if (!userId) throw new BadRequestError("User ID is required");

    const normalized = userId.trim().toLowerCase();
    if (normalized === "admin" || normalized === "0") {
      throw new BadRequestError("The master administrator account cannot be removed.");
    }

    const user = await User.findOne({ tenantId, userId: normalized });
    if (!user) throw new NotFoundError("User not found");

    await User.deleteOne({ tenantId, userId: normalized });

    appEvents.emitEvent(EVENT_TYPES.USER_DELETED, {
      userId: normalized,
      tenantId,
    });

    return { message: "User deleted successfully" };
  }

  async getTenantSettings(tenantId = "default-store") {
    let tenant = await Tenant.findOne({ tenantId });
    if (!tenant) {
      tenant = await Tenant.create({
        tenantId,
        name: "Hardware Point Store",
        taxStrategy: "zero",
        taxRate: 0,
        receiptTemplate: "thermal80mm",
        currency: "PKR",
      });
    }
    return tenant;
  }

  async updateTenantSettings(data, tenantId = "default-store") {
    let tenant = await Tenant.findOne({ tenantId });
    if (!tenant) {
      tenant = new Tenant({ tenantId });
    }

    if (data.name) tenant.name = data.name.trim();
    if (data.taxStrategy) tenant.taxStrategy = data.taxStrategy;
    if (data.taxRate !== undefined) tenant.taxRate = Number(data.taxRate);
    if (data.receiptTemplate) tenant.receiptTemplate = data.receiptTemplate;
    if (data.currency) tenant.currency = data.currency.trim();
    if (data.contactPhone !== undefined) tenant.contactPhone = data.contactPhone;
    if (data.address !== undefined) tenant.address = data.address;

    await tenant.save();
    return tenant;
  }

  async generateCashierId(tenantId) {
    let sequence = 1001;
    while (await User.findOne({ tenantId, userId: String(sequence) })) {
      sequence += 1;
    }
    return String(sequence);
  }
}

module.exports = TenantService;

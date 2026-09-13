const bcrypt = require("bcrypt");
const JoseTokenSigner = require("../../core/security/JoseTokenSigner");
const User = require("../../core/models/User");
const { BadRequestError, UnauthorizedError, ConflictError, NotFoundError } = require("../../core/errors/AppError");
const { appEvents } = require("../../core/events/eventEmitter");
const { EVENT_TYPES } = require("../../core/events/eventTypes");
const { ROLE_PERMISSIONS } = require("../../core/middlewares/requirePermission");

class AuthService {
  constructor({ tokenSigner = new JoseTokenSigner(), passwordHasher = bcrypt } = {}) {
    this.tokenSigner = tokenSigner;
    this.passwordHasher = passwordHasher;
  }

  async login({ userId, password, tenantId = "default-store" }) {
    const normalizedUserId = typeof userId === "string" ? userId.trim().toLowerCase() : "";

    if (!normalizedUserId || typeof password !== "string" || !password) {
      throw new UnauthorizedError("Invalid user ID or password");
    }

    const normalizedTenantId = (tenantId || "default-store").trim().toLowerCase();

    // Find active user by tenantId and userId (with password selected)
    const user = await User.findOne({
      tenantId: normalizedTenantId,
      userId: normalizedUserId,
      active: { $ne: false },
    }).select("+password");

    if (!user) {
      throw new UnauthorizedError("Invalid user ID or password");
    }

    let isValidPassword = false;
    try {
      isValidPassword = await this.passwordHasher.compare(password, user.password);
    } catch {
      isValidPassword = false;
    }

    if (!isValidPassword) {
      throw new UnauthorizedError("Invalid user ID or password");
    }

    const userRole = (user.role || "cashier").toLowerCase();
    const effectivePermissions = Array.isArray(user.permissions) && user.permissions.length > 0
      ? user.permissions
      : ROLE_PERMISSIONS[userRole] || [];

    const token = await this.tokenSigner.sign(
      {
        sub: user._id.toString(),
        userId: user.userId,
        role: userRole,
        tenantId: user.tenantId || normalizedTenantId,
        permissions: effectivePermissions,
      },
      process.env.JWT_SECRET || "pos-secret-key-change-in-production",
      { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
    );

    appEvents.emitEvent(EVENT_TYPES.USER_LOGGED_IN, {
      userId: user.userId,
      tenantId: user.tenantId,
    });

    return {
      token,
      user: {
        _id: user._id,
        userId: user.userId,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        active: user.active !== false,
        permissions: effectivePermissions,
      },
    };
  }

  async register({ name, password, tenantId = "default-store" }) {
    if (!name || !password) {
      throw new BadRequestError("Name and password are required");
    }

    const normalizedTenantId = (tenantId || "default-store").trim().toLowerCase();
    const isFirstUser = (await User.countDocuments({ tenantId: normalizedTenantId })) === 0;

    const normalizedUserId = isFirstUser
      ? "admin"
      : await this.generateCashierId(normalizedTenantId);

    const passwordHash = await this.passwordHasher.hash(password, 12);

    try {
      const user = await User.create({
        name: name.trim(),
        userId: normalizedUserId,
        password: passwordHash,
        role: isFirstUser ? "admin" : "cashier",
        tenantId: normalizedTenantId,
        active: true,
      });

      return {
        _id: user._id,
        userId: user.userId,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
      };
    } catch (error) {
      if (error.code === 11000) {
        throw new ConflictError("User ID collision during registration; please retry");
      }
      throw error;
    }
  }

  async resetPassword({ userId, name, newPassword, tenantId = "default-store" }) {
    if (!userId || !name || !newPassword) {
      throw new BadRequestError("User ID, name, and new password are required");
    }

    const normalizedTenantId = (tenantId || "default-store").trim().toLowerCase();
    const user = await User.findOne({
      tenantId: normalizedTenantId,
      userId: userId.trim().toLowerCase(),
    });

    if (!user || user.name.toLowerCase() !== name.trim().toLowerCase()) {
      throw new NotFoundError("User not found or name mismatch");
    }

    const passwordHash = await this.passwordHasher.hash(newPassword, 12);
    user.password = passwordHash;
    await user.save();
    return { success: true };
  }

  async generateCashierId(tenantId) {
    let sequence = 1001;
    while (await User.findOne({ tenantId, userId: String(sequence) })) {
      sequence += 1;
    }
    return String(sequence);
  }
}

module.exports = AuthService;

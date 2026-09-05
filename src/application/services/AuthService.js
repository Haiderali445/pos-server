class AuthService {
  constructor({ userRepository, passwordHasher, tokenSigner }) {
    this.userRepository = userRepository;
    this.passwordHasher = passwordHasher;
    this.tokenSigner = tokenSigner;
  }

  async register({ name, password }) {
    if (!name || !password) {
      const error = new Error("Name and password are required");
      error.statusCode = 400;
      throw error;
    }

    const isFirstUser = (await this.userRepository.count()) === 0;
    const normalizedUserId = isFirstUser
      ? "admin"
      : await this.generateCashierId();

    const passwordHash = await this.passwordHasher.hash(password, 12);

    try {
      const user = await this.userRepository.create({
      name: name.trim(),
      userId: normalizedUserId,
      password: passwordHash,
      role: isFirstUser ? "admin" : "cashier",
      active: true,
      });

      return {
        userId: user.userId,
        role: user.role,
        name: user.name,
      };
    } catch (error) {
      if (error.code === 11000) {
        const conflict = new Error("Registration collided with another user; retry");
        conflict.statusCode = 409;
        throw conflict;
      }
      throw error;
    }
  }

  async generateCashierId() {
    let sequence = 1001;

    while (await this.userRepository.findByUserId(String(sequence))) {
      sequence += 1;
    }

    return String(sequence);
  }

  async login({ userId, password }) {
    const normalizedUserId = typeof userId === "string"
      ? userId.trim().toLowerCase()
      : "";

    if (!normalizedUserId || typeof password !== "string" || !password) {
      const error = new Error("Invalid credentials");
      error.statusCode = 401;
      throw error;
    }

    const user = await this.userRepository.findByUserIdWithPassword(normalizedUserId);

    if (!user || user.active === false || typeof user.password !== "string") {
      const error = new Error("Invalid credentials");
      error.statusCode = 401;
      throw error;
    }

    let validPassword = false;

    try {
      validPassword = await this.passwordHasher.compare(password, user.password);
    } catch {
      validPassword = false;
    }

    if (!validPassword) {
      const error = new Error("Invalid credentials");
      error.statusCode = 401;
      throw error;
    }

    const token = await this.tokenSigner.sign(
      {
        sub: user._id.toString(),
        userId: user.userId,
        role: user.role || "cashier",
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
    );

    return { token, user: { ...user, password: undefined } };
  }

  async resetPassword({ userId, name, newPassword }) {
    if (!userId || !name || !newPassword) {
      const error = new Error("User ID, name, and new password are required");
      error.statusCode = 400;
      throw error;
    }

    const user = await this.userRepository.findByUserId(userId.trim().toLowerCase());

    if (!user || user.name !== name) {
      const error = new Error("User not found");
      error.statusCode = 404;
      throw error;
    }

    const passwordHash = await this.passwordHasher.hash(newPassword, 12);
    await this.userRepository.updatePassword(user.userId, passwordHash);
  }

  async getAllUsers() {
    return this.userRepository.findAll();
  }

  async adminCreateUser({ name, userId, password, role = "cashier", active = true }) {
    if (!name || !password) {
      const error = new Error("Name and password are required");
      error.statusCode = 400;
      throw error;
    }

    const finalUserId = userId && userId.trim()
      ? userId.trim().toLowerCase()
      : await this.generateCashierId();

    const existing = await this.userRepository.findByUserId(finalUserId);
    if (existing) {
      const conflict = new Error(`User ID '${finalUserId}' already exists`);
      conflict.statusCode = 409;
      throw conflict;
    }

    const validRoles = ["admin", "manager", "cashier"];
    const finalRole = validRoles.includes(role) ? role : "cashier";

    const passwordHash = await this.passwordHasher.hash(password, 12);

    const user = await this.userRepository.create({
      name: name.trim(),
      userId: finalUserId,
      password: passwordHash,
      role: finalRole,
      active: active !== false,
    });

    return {
      _id: user._id,
      userId: user.userId,
      name: user.name,
      role: user.role,
      active: user.active,
      createdAt: user.createdAt,
    };
  }

  async toggleUserStatus(userId, active) {
    if (!userId) {
      const error = new Error("User ID is required");
      error.statusCode = 400;
      throw error;
    }

    const user = await this.userRepository.updateActive(userId, active);
    if (!user) {
      const error = new Error("User not found");
      error.statusCode = 404;
      throw error;
    }

    return user;
  }

  async updateUserRole(userId, role) {
    if (!userId || !role) {
      const error = new Error("User ID and role are required");
      error.statusCode = 400;
      throw error;
    }

    const validRoles = ["admin", "manager", "cashier"];
    if (!validRoles.includes(role)) {
      const error = new Error("Invalid role specified");
      error.statusCode = 400;
      throw error;
    }

    const user = await this.userRepository.updateRole(userId, role);
    if (!user) {
      const error = new Error("User not found");
      error.statusCode = 404;
      throw error;
    }

    return user;
  }

  async deleteUser(userId) {
    if (!userId) {
      const error = new Error("User ID is required");
      error.statusCode = 400;
      throw error;
    }

    const user = await this.userRepository.deleteById(userId);
    if (!user) {
      const error = new Error("User not found");
      error.statusCode = 404;
      throw error;
    }

    return user;
  }
}

module.exports = AuthService;


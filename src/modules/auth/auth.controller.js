const AuthService = require("./auth.service");

function createAuthController(authService = new AuthService()) {
  const login = async (req, res, next) => {
    try {
      const { token, user } = await authService.login({
        ...req.body,
        tenantId: req.tenantId,
      });

      res.set("X-Auth-Token", token);
      return res.status(200).json({
        message: "Login success",
        token,
        user,
      });
    } catch (error) {
      next(error);
    }
  };

  const register = async (req, res, next) => {
    try {
      const user = await authService.register({
        ...req.body,
        tenantId: req.tenantId,
      });
      return res.status(201).json({
        message: "New user added successfully!",
        user,
      });
    } catch (error) {
      next(error);
    }
  };

  const resetPassword = async (req, res, next) => {
    try {
      await authService.resetPassword({
        ...req.body,
        tenantId: req.tenantId,
      });
      return res.status(200).json({ message: "Password reset successfully" });
    } catch (error) {
      next(error);
    }
  };

  return {
    login,
    register,
    resetPassword,
  };
}

module.exports = { createAuthController };

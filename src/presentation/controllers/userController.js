function createUserController({ authService }) {
  const loginController = async (req, res) => {
    try {
      const { token, user } = await authService.login(req.body);
      res.set("X-Auth-Token", token);
      return res.status(200).json({
        message: "Login success",
        token,
        user: {
          _id: user._id,
          userId: user.userId,
          name: user.name,
          role: user.role,
          active: user.active,
        },
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        error: error.statusCode === 401 ? "Incorrect user ID or password" : "Internal server error",
      });
    }
  };

  const registerController = async (req, res) => {
    try {
      const user = await authService.register(req.body);
      return res.status(201).json({
        message: "New user added successfully!",
        user,
      });
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message });
    }
  };

  const resetPasswordController = async (req, res) => {
    try {
      await authService.resetPassword(req.body);
      return res.status(200).json({ message: "Password reset successfully" });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ error: error.message });
    }
  };

  const getAllUsersController = async (req, res) => {
    try {
      const usersList = await authService.getAllUsers();
      return res.status(200).json(usersList);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch users" });
    }
  };

  const adminCreateUserController = async (req, res) => {
    try {
      const newUser = await authService.adminCreateUser(req.body);
      return res.status(201).json({
        message: "User account created successfully",
        user: newUser,
      });
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message });
    }
  };

  const toggleStatusController = async (req, res) => {
    try {
      const { userId, active } = req.body;
      const updatedUser = await authService.toggleUserStatus(userId, active);
      return res.status(200).json({
        message: `User status set to ${active ? "active" : "inactive"}`,
        user: updatedUser,
      });
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message });
    }
  };

  const updateRoleController = async (req, res) => {
    try {
      const { userId, role } = req.body;
      const updatedUser = await authService.updateUserRole(userId, role);
      return res.status(200).json({
        message: `User role updated to ${role}`,
        user: updatedUser,
      });
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message });
    }
  };

  const deleteUserController = async (req, res) => {
    try {
      const userId = req.params.userId || req.body.userId;
      await authService.deleteUser(userId);
      return res.status(200).json({ message: "User deleted successfully" });
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message });
    }
  };

  return {
    loginController,
    registerController,
    resetPasswordController,
    getAllUsersController,
    adminCreateUserController,
    toggleStatusController,
    updateRoleController,
    deleteUserController,
  };
}

module.exports = { createUserController };

const TenantService = require("./tenant.service");

function createTenantController(tenantService = new TenantService()) {
  const getAllUsers = async (req, res, next) => {
    try {
      const users = await tenantService.getAllUsers(req.tenantId);
      return res.status(200).json(users);
    } catch (error) {
      next(error);
    }
  };

  const adminCreateUser = async (req, res, next) => {
    try {
      const newUser = await tenantService.adminCreateUser(req.body, req.tenantId);
      return res.status(201).json({
        message: "User account created successfully",
        user: newUser,
      });
    } catch (error) {
      next(error);
    }
  };

  const toggleStatus = async (req, res, next) => {
    try {
      const { userId, active } = req.body;
      const updatedUser = await tenantService.toggleUserStatus(userId, active, req.tenantId);
      return res.status(200).json({
        message: `User status set to ${active ? "active" : "inactive"}`,
        user: updatedUser,
      });
    } catch (error) {
      next(error);
    }
  };

  const updateRole = async (req, res, next) => {
    try {
      const { userId, role } = req.body;
      const updatedUser = await tenantService.updateUserRole(userId, role, req.tenantId);
      return res.status(200).json({
        message: `User role updated to ${role}`,
        user: updatedUser,
      });
    } catch (error) {
      next(error);
    }
  };

  const deleteUser = async (req, res, next) => {
    try {
      const userId = req.params.userId || req.body.userId;
      const result = await tenantService.deleteUser(userId, req.tenantId);
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  const getTenantSettings = async (req, res, next) => {
    try {
      const settings = await tenantService.getTenantSettings(req.tenantId);
      return res.status(200).json(settings);
    } catch (error) {
      next(error);
    }
  };

  const updateTenantSettings = async (req, res, next) => {
    try {
      const updated = await tenantService.updateTenantSettings(req.body, req.tenantId);
      return res.status(200).json(updated);
    } catch (error) {
      next(error);
    }
  };

  return {
    getAllUsers,
    adminCreateUser,
    toggleStatus,
    updateRole,
    deleteUser,
    getTenantSettings,
    updateTenantSettings,
  };
}

module.exports = { createTenantController };

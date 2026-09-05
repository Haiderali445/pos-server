const express = require("express");
const { createUserController } = require("../controllers/userController");

function createUserRoutes({ authService }) {
  const router = express.Router();
  const {
    loginController,
    registerController,
    resetPasswordController,
    getAllUsersController,
    adminCreateUserController,
    toggleStatusController,
    updateRoleController,
    deleteUserController,
  } = createUserController({ authService });

  // Public authentication routes
  router.post("/login", loginController);
  router.post("/register", registerController);
  router.post("/reset-password", resetPasswordController);

  // Admin user management routes with aliases
  router.get("/all", getAllUsersController);
  router.get("/get-users", getAllUsersController);
  router.get("/get-all-users", getAllUsersController);
  router.get("/", getAllUsersController);

  router.post("/admin-create", adminCreateUserController);
  router.post("/add-user", adminCreateUserController);

  router.patch("/toggle-status", toggleStatusController);
  router.post("/toggle-status", toggleStatusController);

  router.patch("/update-role", updateRoleController);
  router.post("/update-role", updateRoleController);

  router.delete("/delete/:userId", deleteUserController);
  router.delete("/:userId", deleteUserController);
  router.post("/delete-user", deleteUserController);

  return router;
}

module.exports = createUserRoutes;

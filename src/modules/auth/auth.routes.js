const express = require("express");
const { createAuthController } = require("./auth.controller");
const { validateRequest } = require("../../core/middlewares/validateRequest");

function createAuthRoutes(authService) {
  const router = express.Router();
  const controller = createAuthController(authService);

  router.post(
    "/login",
    validateRequest({ body: { required: ["userId", "password"] } }),
    controller.login
  );

  router.post(
    "/register",
    validateRequest({ body: { required: ["name", "password"] } }),
    controller.register
  );

  router.post(
    "/reset-password",
    validateRequest({ body: { required: ["userId", "name", "newPassword"] } }),
    controller.resetPassword
  );

  return router;
}

module.exports = createAuthRoutes;

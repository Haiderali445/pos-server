const { BadRequestError } = require("../errors/AppError");

function validateRequest(validationRules = {}) {
  return (req, _res, next) => {
    const { body = {}, query = {}, params = {} } = validationRules;

    // Validate body required fields
    if (body.required && Array.isArray(body.required)) {
      for (const field of body.required) {
        if (req.body[field] === undefined || req.body[field] === null || req.body[field] === "") {
          return next(new BadRequestError(`Missing required field: '${field}' in request body`));
        }
      }
    }

    // Validate custom function if provided
    if (typeof validationRules.custom === "function") {
      try {
        const error = validationRules.custom(req);
        if (error) {
          return next(new BadRequestError(error));
        }
      } catch (err) {
        return next(new BadRequestError(err.message));
      }
    }

    next();
  };
}

module.exports = { validateRequest };

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function notFound(req, res, next) {
  next(new ApiError(404, `No route for ${req.method} ${req.originalUrl}`));
}

const DUPLICATE_FIELDS = {
  licensePlate: 'That number plate is already on the fleet',
  email: 'That email address is already registered',
  code: 'Booking reference clash, please retry',
};

function duplicateMessage(err) {
  const field = Object.keys(err.keyValue || {})[0];
  return DUPLICATE_FIELDS[field] || `Duplicate value for ${field || 'a field'}`;
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err.code === 11000) err = new ApiError(400, duplicateMessage(err));
  const status = err.status || (err.name === 'ValidationError' ? 400 : err.name === 'CastError' ? 400 : 500);
  if (status === 500) console.error(err);
  res.status(status).json({
    error: {
      message: status === 500 ? 'Internal server error' : err.message,
      details: err.details || (err.name === 'ValidationError' ? Object.values(err.errors).map((e) => e.message) : undefined),
    },
  });
}

module.exports = { ApiError, asyncHandler, notFound, errorHandler };

function errorHandler(error, _req, res, _next) {
  const status = error.statusCode || 500;
  if (status >= 500) {
    console.error(error);
  } else {
    console.warn(error.message);
  }
  res.status(status).json({
    message: error.message || "Internal server error"
  });
}

module.exports = { errorHandler };

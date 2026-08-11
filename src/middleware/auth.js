function requireApiKey(config) {
  return (req, res, next) => {
    if (req.path === "/api/webhooks/github") return next();
    if (!config.apiKey || req.method === "GET") return next();

    const provided = req.header("x-api-key");
    if (provided !== config.apiKey) {
      return res.status(401).json({ error: "Missing or invalid API key" });
    }

    return next();
  };
}

module.exports = { requireApiKey };

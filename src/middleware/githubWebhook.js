const { createHmac, timingSafeEqual } = require("crypto");

function verifyGitHubWebhook(config) {
  return (req, res, next) => {
    if (!config.githubWebhookSecret) return next();

    const signature = req.header("x-hub-signature-256");
    if (!signature?.startsWith("sha256=")) {
      return res.status(401).json({ error: "Missing GitHub webhook signature" });
    }

    const expected = `sha256=${createHmac("sha256", config.githubWebhookSecret)
      .update(req.rawBody || Buffer.from(""))
      .digest("hex")}`;

    const providedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);

    if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
      return res.status(401).json({ error: "Invalid GitHub webhook signature" });
    }

    return next();
  };
}

module.exports = { verifyGitHubWebhook };

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { config } = require("./config");

async function migrate() {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required for migrations");
  }

  const pool = new Pool({ connectionString: config.databaseUrl });
  const migrationPath = path.join(__dirname, "..", "db", "migrations", "001_init.sql");
  const sql = fs.readFileSync(migrationPath, "utf8");

  try {
    await pool.query(sql);
    console.log("Database migration complete");
  } finally {
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error(error);
  process.exit(1);
});

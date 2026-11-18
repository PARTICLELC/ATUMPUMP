import fs from "node:fs";

const file = "src/market_capture.mjs";
let source = fs.readFileSync(file, "utf8");

source = source.replace(
  'db.exec("PRAGMA foreign_keys = ON");',
  `db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 15000");
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA synchronous = NORMAL");`
);

const oldRegistration = `function registerToken(data, source) {
  if (!data?.mint) return;

  const now = Date.now();

  insertToken.run(
    data.mint,
    data.name ?? null,
    data.symbol ?? null,
    now,
    now,
    source,
    null,
    null,
    0
  );
}`;

const newRegistration = `const pendingRegistrations = new Map();

function registerToken(data, source) {
  if (!data?.mint) return;

  const now = Date.now();

  try {
    insertToken.run(
      data.mint,
      data.name ?? null,
      data.symbol ?? null,
      now,
      now,
      source,
      null,
      null,
      0
    );

    pendingRegistrations.delete(data.mint);
  } catch (error) {
    if (error.code === "ERR_SQLITE_ERROR" || error.errcode === 5) {
      pendingRegistrations.set(data.mint, { data, source });
      console.log("[DATABASE BUSY] Token registration queued:", data.mint);
      return;
    }

    throw error;
  }
}

function flushPendingRegistrations() {
  for (const [mint, item] of pendingRegistrations) {
    registerToken(item.data, item.source);
  }
}`;

if (!source.includes(oldRegistration)) {
  throw new Error("Original registerToken function not found.");
}

source = source.replace(oldRegistration, newRegistration);

source = source.replace(
  '  polling = true;\n  snapshotNumber++;',
  '  polling = true;\n  snapshotNumber++;\n  flushPendingRegistrations();'
);

source = source.replace(
  `      registerToken(data, "pumpportal");

      console.log(
        "[NEW TOKEN]",
        data.symbol ?? "UNKNOWN",
        data.mint
      );`,
  `      try {
        registerToken(data, "pumpportal");

        console.log(
          "[NEW TOKEN]",
          data.symbol ?? "UNKNOWN",
          data.mint
        );
      } catch (error) {
        console.log("[NEW TOKEN REGISTER ERROR]", error.message);
      }`
);

fs.writeFileSync(file, source);
console.log("[PATCHED] WAL mode enabled.");
console.log("[PATCHED] SQLite busy timeout: 15000 ms.");
console.log("[PATCHED] Busy token registrations are queued.");
console.log("[PATCHED] WebSocket registration errors cannot crash capture.");

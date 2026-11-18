import { DatabaseSync } from "node:sqlite";

const DB = new DatabaseSync("data/atumpump.sqlite");
DB.exec("PRAGMA busy_timeout = 15000;");

const query = DB.prepare(`
  SELECT id, mint, event_type, previous_pair_address,
         new_pair_address, event_at
  FROM pair_change_events
  ORDER BY id DESC
  LIMIT 20
`);

const stats = DB.prepare(`
  SELECT
    (SELECT COUNT(*) FROM pair_change_events) AS events,
    (SELECT COUNT(*) FROM pair_identity_history) AS identities,
    (SELECT COUNT(*) FROM pair_identity_history WHERE active = 1) AS active
`).get();

function render() {
  console.clear();
  console.log("⚡ ATUMPUMP — PAIR CHANGE MONITOR");
  console.log("==============================================");
  console.log(`Recorded events: ${stats.events}`);
  console.log(`Pair identities: ${stats.identities}`);
  console.log(`Active identities: ${stats.active}`);
  console.log("\nLATEST PAIR EVENTS");
  console.log("----------------------------------------------");

  const events = query.all();

  if (!events.length) {
    console.log("Waiting for the first pair-change event.");
  }

  for (const event of events) {
    console.log(`${event.id}. ${event.event_type} | ${event.mint}`);
    console.log(`   OLD: ${event.previous_pair_address ?? "NONE"}`);
    console.log(`   NEW: ${event.new_pair_address ?? "NONE"}`);
    console.log(`   TIME: ${new Date(event.event_at).toLocaleString()}`);
  }

  console.log("\nRefresh: 5 seconds | CTRL+C to exit");
}

render();
const timer = setInterval(render, 5000);

process.on("SIGINT", () => {
  clearInterval(timer);
  DB.close();
  process.exit(0);
});

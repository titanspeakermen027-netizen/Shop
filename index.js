require("dotenv").config();

const { client, registerAndStart } = require("./src/app");

if (!process.env.DISCORD_TOKEN) {
  console.error("[Shop] DISCORD_TOKEN is missing from .env");
  process.exit(1);
}

client.once("ready", async () => {
  try {
    await registerAndStart();
    console.log("[Shop] Production core initialized.");
  } catch (error) {
    console.error("[Shop] Startup initialization failed:", error);
    process.exit(1);
  }
});

process.on("unhandledRejection", (error) => {
  console.error("[Shop] Unhandled promise rejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("[Shop] Uncaught exception:", error);
  process.exit(1);
});

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error("[Shop] Discord login failed:", error);
  process.exit(1);
});

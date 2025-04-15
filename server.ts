import express from "express";
import dotenv from "dotenv";
import { handler } from "./index"; // Make sure this path is correct

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("✅ Telegram bot is ready.");
});

app.get("/run", async (req, res) => {
  try {
    await handler();
    res.send("Bot script ran successfully.");
  } catch (err) {
    console.error("Bot error: ", err);
    res.status(500).send("Bot run failed.");
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

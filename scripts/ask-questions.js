const fs = require("fs");
const path = require("path");
const hardQuestions = require("./hard-questions.js"); // adjust path if needed

const API_URL = "http://localhost:3000/api/chat";
const OUTPUT_FILE = path.join(__dirname, "qa-results.txt");

async function askBot(message, sessionId) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sessionId })
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

  return res.json();
}

async function run() {
  let sessionId = null;

  fs.writeFileSync(OUTPUT_FILE, "");

  for (let i = 0; i < hardQuestions.length; i++) {
    const question = hardQuestions[i];

    console.log(`Asking ${i + 1}/${hardQuestions.length}`);

    try {
      const data = await askBot(question, sessionId);
      sessionId = data.sessionId;

      const formatted = `${i + 1}) ${question}\nAnswer:\n${data.reply}\n\n`;

      fs.appendFileSync(OUTPUT_FILE, formatted);
    } catch (err) {
      console.error("Error:", err.message);
      fs.appendFileSync(
        OUTPUT_FILE,
        `${i + 1}) ${question}\nAnswer:\n[ERROR: ${err.message}]\n\n`
      );
    }
  }

  console.log("Done. Results saved to qa-results.txt");
}

run();
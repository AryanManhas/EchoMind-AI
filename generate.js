const axios = require("axios");
const fs = require("fs");
const path = require("path");

async function runAgent(task) {
  const prompt = `
You are a coding agent.

Return ONLY JSON:
{
  "actions": [
    { "type": "create|update|delete", "path": "file", "content": "code" }
  ]
}

Task: ${task}
`;

  try {
    const res = await axios.post("http://localhost:11434/api/generate", {
      model: "qwen2.5-coder:7b",
      prompt,
      stream: false,
      options: { temperature: 0 }
    });

    let output = res.data.response;

    // Extract JSON
    const start = output.indexOf("{");
    const end = output.lastIndexOf("}") + 1;
    const jsonString = output.substring(start, end);

    const data = JSON.parse(jsonString);

    for (const action of data.actions) {
      const filePath = path.join(__dirname, action.path);

      if (action.type === "create") {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, action.content);
        console.log("✅ Created:", action.path);
      }

      else if (action.type === "update") {
        if (fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, action.content);
          console.log("📝 Updated:", action.path);
        } else {
          console.log("⚠️ File not found for update:", action.path);
        }
      }

      else if (action.type === "delete") {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log("❌ Deleted:", action.path);
        } else {
          console.log("⚠️ File not found for deletion:", action.path);
        }
      }
    }

  } catch (err) {
    console.error("❌ Error:", err.message);
  }
}

// 👇 TAKE INPUT FROM TERMINAL
const task = process.argv.slice(2).join(" ");

if (!task) {
  console.log("❗ Provide a task");
  process.exit(1);
}

runAgent(task);
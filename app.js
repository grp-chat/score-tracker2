require("dotenv").config();
const express = require("express");
const path = require("path");
const http = require("http");
const axios = require("axios");
const { Server } = require("socket.io");

const atob = str => Buffer.from(str, "base64").toString("utf8");
const btoa = str => Buffer.from(str, "utf8").toString("base64");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ------------------------------
// ENV CONFIG
// ------------------------------
const PORT = process.env.PORT || 3000;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_PATH = process.env.GITHUB_PATH; // e.g. score-tracker.txt
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const COMMITTER_NAME = process.env.COMMITTER_NAME || "Score Tracker Bot";
const COMMITTER_EMAIL = process.env.COMMITTER_EMAIL || "no-reply@example.com";

if (!GITHUB_OWNER || !GITHUB_REPO || !GITHUB_PATH || !GITHUB_TOKEN) {
  console.error("\n❌ Missing GitHub ENV values!\n");
}

// ------------------------------
// AXIOS INSTANCE FOR GITHUB
// ------------------------------
const gh = axios.create({
  baseURL: "https://api.github.com",
  headers: {
    Authorization: `token ${GITHUB_TOKEN}`,
    "User-Agent": "score-tracker-app"
  },
  timeout: 15000
});

// ------------------------------
// EXPRESS
// ------------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname, "client")));

// ------------------------------
// GITHUB HELPERS
// ------------------------------
async function getFileFromGitHub() {
  const url = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PATH}`;
  const resp = await gh.get(url);
  return { content: resp.data.content, sha: resp.data.sha };
}

async function saveFileToGitHub(contentStr, message = "Update score-tracker") {
  const url = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PATH}`;

  let sha = undefined;
  try {
    const existing = await gh.get(url);
    sha = existing.data.sha;
  } catch (err) {
    sha = undefined;
  }

  const body = {
    message,
    content: btoa(contentStr),
    committer: {
      name: COMMITTER_NAME,
      email: COMMITTER_EMAIL
    }
  };

  if (sha) body.sha = sha;

  const resp = await gh.put(url, body);
  return resp.data;
}

// ------------------------------
// SOCKET.IO
// ------------------------------
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // ------------------------------------
  // 1️⃣ REQUEST LATEST DATA
  // ------------------------------------
  socket.on("request-latest-data", async () => {
    io.emit("operation:start", { message: "Reading data..." });

    try {
      const { content } = await getFileFromGitHub();
      let parsed = [];

      if (content) {
        try { parsed = JSON.parse(atob(content)); }
        catch { parsed = []; }
      }

      socket.emit("latest-data", parsed);
      io.emit("operation:end", { message: "Done" });
    } catch (err) {
      io.emit("operation:error", { message: err.message });
    }
  });

  // ------------------------------------
  // 2️⃣ SAVE DATA
  // ------------------------------------
  socket.on("save-data", async ({ data, message }) => {
    io.emit("operation:start", { message: "Saving data..." });

    try {
      await saveFileToGitHub(JSON.stringify(data, null, 2), message);
      io.emit("save-complete", { ok: true });
      io.emit("operation:end", { message: "Saved" });
    } catch (err) {
      io.emit("operation:error", { message: err.message });
    }
  });

  // ------------------------------------
  // 3️⃣ CLEAR DATA
  // ------------------------------------
  socket.on("clear-data", async () => {
    io.emit("operation:start", { message: "Clearing data..." });

    try {
      await saveFileToGitHub(JSON.stringify([], null, 2), "Clear data");
      io.emit("save-complete", { ok: true });
      io.emit("operation:end", { message: "Cleared" });
    } catch (err) {
      io.emit("operation:error", { message: err.message });
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// ------------------------------
// SPA FALLBACK
// ------------------------------
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "client", "index.html"));
});

// ------------------------------
// START SERVER
// ------------------------------
server.listen(PORT, () => {
  console.log(`\n🚀 Score Tracker running at http://localhost:${PORT}\n`);
});

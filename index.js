import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import pg from "pg";

const app = express();
const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true,
  },
  connectionStateRecovery: {},
});

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const ALLOWED_ROOMS = ["General", "Tech Talk", "Random", "Gaming"];

await pool.query(`
  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    username VARCHAR(100) NOT NULL,
    room VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

app.get("/", (req, res) => {
  res.send("<h1>Hello world 2</h1>");
});

io.on("connection", (socket) => {
  console.log("a user connected", socket.id);

  socket.on("join room", async ({ username, room }) => {
    try {
      if (!ALLOWED_ROOMS.includes(room)) {
        socket.emit("error message", "Room no válido");
        return;
      }

      socket.join(room);

      const result = await pool.query(
        `SELECT id, content, username, room, created_at
         FROM messages
         WHERE room = $1
         ORDER BY created_at ASC`,
        [room]
      );

      socket.emit("room history", result.rows);

      socket.to(room).emit("user joined", {
        username,
        room,
      });
    } catch (e) {
      console.error("Error joining room:", e);
      socket.emit("error message", "Error al cargar el room");
    }
  });

  socket.on("leave room", ({ room }) => {
    socket.leave(room);
  });

  socket.on("chat message", async ({ content, username, room }) => {
    try {
      if (!content || !username || !room) {
        socket.emit("error message", "Datos incompletos");
        return;
      }

      if (!ALLOWED_ROOMS.includes(room)) {
        socket.emit("error message", "Room no válido");
        return;
      }

      const result = await pool.query(
        `INSERT INTO messages (content, username, room)
         VALUES ($1, $2, $3)
         RETURNING id, content, username, room, created_at`,
        [content, username, room]
      );

      io.to(room).emit("chat message", result.rows[0]);
    } catch (e) {
      console.error("Error inserting message:", e);
      socket.emit("error message", "Error al enviar mensaje");
    }
  });

  socket.on("disconnect", () => {
    console.log("user disconnected", socket.id);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`server running on port ${PORT}`);
});
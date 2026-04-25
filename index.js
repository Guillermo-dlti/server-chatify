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
const roomUserCounts = new Map();

const getRoomUsers = (room) => {
  const usersMap = roomUserCounts.get(room);
  if (!usersMap) return [];
  return Array.from(usersMap.keys()).sort((a, b) => a.localeCompare(b));
};

const emitRoomUsers = (room) => {
  io.to(room).emit("room users", getRoomUsers(room));
};

const addUserToRoom = (room, username) => {
  const usersMap = roomUserCounts.get(room) ?? new Map();
  const currentCount = usersMap.get(username) ?? 0;
  usersMap.set(username, currentCount + 1);
  roomUserCounts.set(room, usersMap);
};

const removeUserFromRoom = (room, username) => {
  const usersMap = roomUserCounts.get(room);
  if (!usersMap) return;

  const currentCount = usersMap.get(username) ?? 0;
  if (currentCount <= 1) {
    usersMap.delete(username);
  } else {
    usersMap.set(username, currentCount - 1);
  }

  if (usersMap.size === 0) {
    roomUserCounts.delete(room);
  }
};

await pool.query(`
  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    username VARCHAR(100) NOT NULL,
    room VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

await pool.query(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
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

      if (!username || !username.trim()) {
        socket.emit("error message", "Username requerido");
        return;
      }

      const cleanUsername = username.trim();
      const previousRoom = socket.data.room;
      const previousUsername = socket.data.username;

      if (previousRoom && previousUsername) {
        socket.leave(previousRoom);
        removeUserFromRoom(previousRoom, previousUsername);
        emitRoomUsers(previousRoom);
      }

      await pool.query(
        `INSERT INTO users (username)
         VALUES ($1)
         ON CONFLICT (username) DO NOTHING`,
        [cleanUsername]
      );

      socket.join(room);
      socket.data.room = room;
      socket.data.username = cleanUsername;
      addUserToRoom(room, cleanUsername);
      emitRoomUsers(room);

      const result = await pool.query(
        `SELECT id, content, username, room, created_at
         FROM messages
         WHERE room = $1
         ORDER BY created_at ASC`,
        [room]
      );

      socket.emit("room history", result.rows);

      socket.to(room).emit("user joined", {
        username: cleanUsername,
        room,
      });
    } catch (e) {
      console.error("Error joining room:", e);
      socket.emit("error message", "Error al cargar el room");
    }
  });

  socket.on("leave room", ({ room }) => {
    socket.leave(room);

    if (socket.data.room === room && socket.data.username) {
      removeUserFromRoom(room, socket.data.username);
      emitRoomUsers(room);
      socket.data.room = null;
      socket.data.username = null;
    }
  });

  socket.on("chat message", async ({ content, username, room }) => {
    try {
      if (!content || !content.trim() || !username || !username.trim() || !room) {
        socket.emit("error message", "Datos incompletos");
        return;
      }

      if (!ALLOWED_ROOMS.includes(room)) {
        socket.emit("error message", "Room no válido");
        return;
      }

      const cleanContent = content.trim();
      const cleanUsername = username.trim();

      const result = await pool.query(
        `INSERT INTO messages (content, username, room, created_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING id, content, username, room, created_at`,
        [cleanContent, cleanUsername, room]
      );

      io.to(room).emit("chat message", result.rows[0]);
    } catch (e) {
      console.error("Error inserting message:", e);
      socket.emit("error message", "Error al enviar mensaje");
    }
  });

  socket.on("disconnect", () => {
    if (socket.data.room && socket.data.username) {
      removeUserFromRoom(socket.data.room, socket.data.username);
      emitRoomUsers(socket.data.room);
    }
    console.log("user disconnected", socket.id);
  });

  socket.on("typing", ({ username, room }) => {
    if (!username || !room) return;

    if (!ALLOWED_ROOMS.includes(room)) return;

    socket.to(room).emit("typing", {
      username,
      room,
    });
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`server running on port ${PORT}`);
});

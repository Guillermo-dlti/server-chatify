import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: 'http://localhost:5173/',
});

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// open the database file
const db = await open({
    filename: 'chat.db',
    driver: sqlite3.Database
});

// create our 'messages' table (you can ignore the 'client_offset' column for now)
await db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_offset TEXT UNIQUE,
      content TEXT
  );
`);

app.get('/', (req, res) => {
    res.send('<h1>Hello world2</h1>');
});

io.on('connection', async (socket) => {
    console.log('a user connected', socket.id);

    if (!socket.recovered) {
        // if the connection state recovery was not successful
        try {
            await db.each('SELECT id, content FROM messages WHERE id > ?',
                [socket.handshake.auth.serverOffset || 0],
                (_err, row) => {
                    socket.emit('chat message', row.content, row.id);
                }
            )
        } catch (e) {
            // something went wrong
        }
    }

    socket.on('chat message', async (msg) => {
        console.log('message: ' + msg);
        let result;
        try {
            // store the message in the database
            result = await db.run('INSERT INTO messages (content) VALUES (?)', msg);
        } catch (e) {
            // TODO handle the failure
            return;
        }
        // include the offset with the message
        io.emit('chat message', msg, result.lastID);
    });

    socket.on('disconnect', () => {
        console.log('user disconnected', socket.id);
    });
    connectionStateRecovery: {

    }
});

server.listen(3000, () => {
    console.log('server running at http://localhost:3000');
});
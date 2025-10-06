// server.js
require('dotenv').config();

const app = require('./src/app');
const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;

// Crear servidor HTTP
const server = http.createServer(app);

// Configurar Socket.IO
const io = new Server(server, {
    cors: {
        origin: "http://localhost:5173", // Tu frontend
        methods: ["GET", "POST"],
        credentials: true
    }
});

// Middleware de autenticación para Socket.IO
io.use((socket, next) => {
    const token = socket.handshake.auth.token;

    if (!token) {
        return next(new Error('Authentication error'));
    }

    try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        socket.userId = decoded.id;
        next();
    } catch (err) {
        next(new Error('Invalid token'));
    }
});

// Manejar conexiones
io.on('connection', (socket) => {
    console.log(`✅ Usuario conectado: ${socket.userId}`);

    // Unir al usuario a su sala personal
    socket.join(`user-${socket.userId}`);

    socket.on('disconnect', () => {
        console.log(`❌ Usuario desconectado: ${socket.userId}`);
    });
});

// Hacer io accesible globalmente
global.io = io;

// Iniciar servidor
server.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
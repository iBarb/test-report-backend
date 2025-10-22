const express = require("express");
const cors = require("cors");
const sequelize = require("./config/db");

const authMiddleware = require("./middleware/auth");

const authRoutes = require("./routes/auth.routes");
const projectRoutes = require("./routes/projects.routes");
const fileRoutes = require("./routes/files.routes");
const reportRoutes = require("./routes/reports.routes");
const exportRoutes = require("./routes/exports.routes");
const notificationRoutes = require("./routes/notifications.routes");

const app = express();

// Configuración de CORS
app.use(cors({
  origin: "http://localhost:5173", // o el dominio de tu frontend en producción
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true // si necesitas enviar cookies o headers de autenticación
}));


app.use(express.json());

// Rutas
app.use("/auth", authRoutes);
app.use("/projects", projectRoutes);
app.use("/files", fileRoutes);
app.use("/reports", reportRoutes);
// app.use("/exports", exportRoutes);
app.use("/notifications", notificationRoutes);

const db = require('./models/associations');

// sequelize.sync({ force: true })
sequelize.sync({ alter: true })
  .then(() => console.log("✅ Tablas sincronizadas"))
  .catch(err => console.error("❌ Error al sincronizar:", err));

module.exports = app; 

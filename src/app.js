const express = require("express");
const sequelize = require("./config/db");

const authRoutes = require("./routes/auth.routes");
const projectRoutes = require("./routes/projects.routes");
const roleRoutes = require("./routes/roles.routes");
const fileRoutes = require("./routes/files.routes");
const reportRoutes = require("./routes/reports.routes");
const exportRoutes = require("./routes/exports.routes");
const notificationRoutes = require("./routes/notifications.routes");

const app = express();
app.use(express.json());

// Rutas
app.use("/auth", authRoutes);
app.use("/projects", projectRoutes);
app.use("/roles", roleRoutes);
app.use("/files", fileRoutes);
app.use("/reports", reportRoutes);
// app.use("/exports", exportRoutes);
app.use("/notifications", notificationRoutes);

sequelize.sync({ alter: true })
  .then(() => console.log("✅ Tablas sincronizadas"))
  .catch(err => console.error("❌ Error al sincronizar:", err));

module.exports = app;

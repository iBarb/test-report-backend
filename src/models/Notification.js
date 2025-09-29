const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Notification = sequelize.define("Notification", {
    notification_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    user_id: { type: DataTypes.INTEGER, allowNull: false },
    type: { type: DataTypes.STRING(50) }, // sistema, error, nuevo reporte
    message: { type: DataTypes.TEXT },
    status: { type: DataTypes.STRING(50) }, // pendiente, leído
    is_deleted: { type: DataTypes.BOOLEAN, defaultValue: false },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
    tableName: "Notification",
    timestamps: false,
});

module.exports = Notification;

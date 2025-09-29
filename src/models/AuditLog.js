const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const AuditLog = sequelize.define("AuditLog", {
    audit_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    entity: { type: DataTypes.STRING(100) },
    action: { type: DataTypes.STRING(50) }, // CREATE, UPDATE, DELETE
    old_value: { type: DataTypes.JSON },
    new_value: { type: DataTypes.JSON },
    changed_by: { type: DataTypes.INTEGER, allowNull: false },
    changed_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
    tableName: "AuditLog",
    timestamps: false,
});

module.exports = AuditLog;

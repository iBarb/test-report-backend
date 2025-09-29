const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ReportHistory = sequelize.define("ReportHistory", {
    history_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    report_id: { type: DataTypes.INTEGER, allowNull: false },
    version: { type: DataTypes.INTEGER },
    content: { type: DataTypes.TEXT },
    prompt: { type: DataTypes.TEXT },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    created_by: { type: DataTypes.INTEGER, allowNull: false },
}, {
    tableName: "ReportHistory",
    timestamps: false,
});

module.exports = ReportHistory;

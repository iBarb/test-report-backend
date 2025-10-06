const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Report = sequelize.define("Report", {
    report_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    file_id: { type: DataTypes.INTEGER, allowNull: false },
    generated_by: { type: DataTypes.INTEGER, allowNull: false },
    title: { type: DataTypes.STRING(200) },
    content: { type: DataTypes.TEXT },
    prompt: { type: DataTypes.TEXT },
    status: { type: DataTypes.STRING(50) }, // draft, finalized
    is_deleted: { type: DataTypes.BOOLEAN, defaultValue: false },
    duration: { type: DataTypes.INTEGER },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
    tableName: "Report",
    timestamps: false,
});

module.exports = Report;

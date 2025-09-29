const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ExportedDocument = sequelize.define("ExportedDocument", {
    export_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    report_id: { type: DataTypes.INTEGER, allowNull: false },
    format: { type: DataTypes.STRING(50) }, // PDF, DOCX, HTML
    file_path: { type: DataTypes.STRING(500) },
    is_deleted: { type: DataTypes.BOOLEAN, defaultValue: false },
    generated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
    tableName: "ExportedDocument",
    timestamps: false,
});

module.exports = ExportedDocument;

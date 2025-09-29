const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const UploadedFile = sequelize.define("UploadedFile", {
    file_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    project_id: { type: DataTypes.INTEGER, allowNull: false },
    user_id: { type: DataTypes.INTEGER, allowNull: false },
    file_name: { type: DataTypes.STRING(255), allowNull: false },
    file_type: { type: DataTypes.STRING(50) },
    storage_path: { type: DataTypes.STRING(500) },
    is_deleted: { type: DataTypes.BOOLEAN, defaultValue: false },
    uploaded_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
    tableName: "UploadedFile",
    timestamps: false,
});

module.exports = UploadedFile;

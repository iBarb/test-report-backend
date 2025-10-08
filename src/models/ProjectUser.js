const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ProjectUser = sequelize.define("ProjectUser", {
    project_user_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    project_id: { type: DataTypes.INTEGER, allowNull: false },
    user_id: { type: DataTypes.INTEGER, allowNull: false },
    permissions: { type: DataTypes.STRING(255) },
    is_deleted: { type: DataTypes.BOOLEAN, defaultValue: false },
    joined_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
    tableName: "ProjectUser",
    timestamps: false,
});

module.exports = ProjectUser;

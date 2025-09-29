const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Role = sequelize.define("Role", {
    role_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(50), allowNull: false },
    is_deleted: { type: DataTypes.BOOLEAN, defaultValue: false },
}, {
    tableName: "Role",
    timestamps: false,
});

module.exports = Role;

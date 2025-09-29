const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const LoginTracking = sequelize.define("LoginTracking", {
    login_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    user_id: { type: DataTypes.INTEGER, allowNull: false },
    ip_address: { type: DataTypes.STRING(45) },
    user_agent: { type: DataTypes.STRING(255) },
    login_time: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
    tableName: "LoginTracking",
    timestamps: false,
});

module.exports = LoginTracking;

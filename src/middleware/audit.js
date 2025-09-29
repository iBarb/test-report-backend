const AuditLog = require("../models/AuditLog");

module.exports = async (entity, action, oldValue, newValue, userId) => {
    try {
        await AuditLog.create({
            entity,
            action,
            old_value: oldValue,
            new_value: newValue,
            changed_by: userId,
            changed_at: new Date(),
        });
    } catch (err) {
        console.error("Error audit:", err);
    }
};

const Notification = require("../models/Notification");

class NotificationService {
    /**
     * Envía notificación al usuario y la guarda en BD
     * @param {number} userId - ID del usuario
     * @param {string} type - Tipo de notificación
     * @param {string} message - Mensaje
     * @param {object} metadata - Datos adicionales (opcional)
     */
    static async sendNotification(userId, type, message, metadata = {}) {
        try {
            // 1. Guardar en base de datos
            const notification = await Notification.create({
                user_id: userId,
                type,
                message,
                status: "pendiente",
                is_deleted: false,
            });

            // 2. Enviar por Socket.IO si hay conexión activa
            if (global.io) {
                global.io.to(`user-${userId}`).emit("notification", {
                    notification_id: notification.notification_id,
                    type,
                    message,
                    created_at: notification.created_at,
                    ...metadata
                });

                console.log(`📨 Notificación enviada a usuario ${userId}: ${type}`);
            }

            return notification;
        } catch (error) {
            console.error("Error enviando notificación:", error);
            throw error;
        }
    }

    /**
     * Notificación de reporte completado
     */
    static async reportCompleted(userId, reportId, title) {
        return this.sendNotification(
            userId,
            "reporte_completado",
            `Tu reporte "${title}" ha sido generado exitosamente.`,
            { report_id: reportId, title }
        );
    }

    /**
     * Notificación de reporte fallido
     */
    static async reportFailed(userId, reportId, title, error) {
        return this.sendNotification(
            userId,
            "reporte_fallido",
            `Error al generar el reporte "${title}": ${error}`,
            { report_id: reportId, title, error }
        );
    }

    /**
     * Notificación de reporte en progreso
     */
    static async reportInProgress(userId, reportId, title) {
        return this.sendNotification(
            userId,
            "reporte_progreso",
            `Tu reporte "${title}" está siendo generado...`,
            { report_id: reportId, title }
        );
    }
}

module.exports = NotificationService;
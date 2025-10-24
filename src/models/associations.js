// associations.js
// Importar todos los modelos
const User = require('./User');
const Project = require('./Project');
const ProjectUser = require('./ProjectUser');
const UploadedFile = require('./UploadedFile');
const Report = require('./Report');
const ReportHistory = require('./ReportHistory');
const ExportedDocument = require('./ExportedDocument');
const Notification = require('./Notification');
const AuditLog = require('./AuditLog');
const LoginTracking = require('./LoginTracking');

// ========== USER RELATIONS ==========

// User - LoginTracking (1:N)
User.hasMany(LoginTracking, {
    foreignKey: 'user_id',
    as: 'loginHistory'
});
LoginTracking.belongsTo(User, {
    foreignKey: 'user_id',
    as: 'user'
});

// User - Notification (1:N)
User.hasMany(Notification, {
    foreignKey: 'user_id',
    as: 'notifications'
});
Notification.belongsTo(User, {
    foreignKey: 'user_id',
    as: 'user'
});

// User - AuditLog (1:N)
User.hasMany(AuditLog, {
    foreignKey: 'changed_by',
    as: 'auditLogs'
});
AuditLog.belongsTo(User, {
    foreignKey: 'changed_by',
    as: 'changedByUser'
});

// ========== PROJECT RELATIONS ==========

// Project - ProjectUser (N:M a través de tabla intermedia)
Project.belongsToMany(User, {
    through: ProjectUser,
    foreignKey: 'project_id',
    otherKey: 'user_id',
    as: 'users'
});
User.belongsToMany(Project, {
    through: ProjectUser,
    foreignKey: 'user_id',
    otherKey: 'project_id',
    as: 'projects'
});

// Relaciones directas con ProjectUser para acceso a la tabla intermedia
Project.hasMany(ProjectUser, {
    foreignKey: 'project_id',
    as: 'projectUsers'
});
ProjectUser.belongsTo(Project, {
    foreignKey: 'project_id',
    as: 'project'
});

User.hasMany(ProjectUser, {
    foreignKey: 'user_id',
    as: 'projectUsers'
});
ProjectUser.belongsTo(User, {
    foreignKey: 'user_id',
    as: 'user'
});

// Project - UploadedFile (1:N)
Project.hasMany(UploadedFile, {
    foreignKey: 'project_id',
    as: 'files'
});
UploadedFile.belongsTo(Project, {
    foreignKey: 'project_id',
    as: 'project'
});

// ========== UPLOADED FILE RELATIONS ==========

// UploadedFile - User (N:1)
UploadedFile.belongsTo(User, {
    foreignKey: 'user_id',
    as: 'uploadedBy'
});
User.hasMany(UploadedFile, {
    foreignKey: 'user_id',
    as: 'uploadedFiles'
});

// UploadedFile - Report (1:N)
UploadedFile.hasMany(Report, {
    foreignKey: 'file_id',
    as: 'reports'
});
ReportHistory.belongsTo(UploadedFile, {
    foreignKey: 'file_id',
    as: 'file'
});
Report.belongsTo(UploadedFile, {
    foreignKey: 'file_id',
    as: 'file'
});

// ========== REPORT RELATIONS ==========

// Report - User (N:1 - generado por)
Report.belongsTo(User, {
    foreignKey: 'generated_by',
    as: 'generator'
});
User.hasMany(Report, {
    foreignKey: 'generated_by',
    as: 'generatedReports'
});

// Report - ReportHistory (1:N)
Report.hasMany(ReportHistory, {
    foreignKey: 'report_id',
    as: 'history'
});
ReportHistory.belongsTo(Report, {
    foreignKey: 'report_id',
    as: 'report'
});

// Report - ExportedDocument (1:N)
Report.hasMany(ExportedDocument, {
    foreignKey: 'report_id',
    as: 'exports'
});
ExportedDocument.belongsTo(Report, {
    foreignKey: 'report_id',
    as: 'report'
});

// ========== REPORT HISTORY RELATIONS ==========

// ReportHistory - User (N:1 - creado por)
ReportHistory.belongsTo(User, {
    foreignKey: 'created_by',
    as: 'creator'
});
User.hasMany(ReportHistory, {
    foreignKey: 'created_by',
    as: 'reportHistories'
});

// Exportar todos los modelos con relaciones configuradas
module.exports = {
    User,
    Project,
    ProjectUser,
    UploadedFile,
    Report,
    ReportHistory,
    ExportedDocument,
    Notification,
    AuditLog,
    LoginTracking
};
const express = require("express");
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const UploadedFile = require("../models/UploadedFile");
const Report = require("../models/Report");
const ReportHistory = require("../models/ReportHistory");

const auth = require("../middleware/auth");
const audit = require("../middleware/audit");

const router = express.Router();

// 📌 Configuración de Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// 🔹 Función auxiliar: validar formato de archivo
const isValidFormat = (filename) => {
    const allowedExtensions = [".xml", ".json", ".html", ".csv", ".txt", ".log"];
    return allowedExtensions.includes(path.extname(filename).toLowerCase());
};


// 🔹 Función auxiliar: procesar respuesta de Gemini
const processGeminiResponse = (text) => {
    if (text.includes("[ERROR]")) {
        const cleanText = text.replace(/\[ERROR\].*/i, "").trim();
        return { isError: true, content: cleanText };
    }
    return { isError: false, content: text };
};


// 🔹 Prompt base
const buildPrompt = (fileContent, userPrompt = "") => `
Eres un asistente experto en pruebas de software y en la norma ISO/IEC/IEEE 29119-3. Tu tarea es procesar un archivo de resultados de pruebas:
${fileContent}

Instrucciones:
Verifica que el archivo tenga un formato compatible con herramientas de testing, como XML, JSON, HTML, CSV, TXT o logs.

Si el formato no es válido, devuelve únicamente:
[ERROR] (Indica por qué no se aceptó el archivo)

Si el Formato es aceptado 
Extrae los datos relevantes y genera únicamente la información siguiendo los formatos de ISO/IEC/IEEE 29119-3.

[TEL]
{
  "documentApprovalHistory": { "preparedBy": "" },
  "documentRevisionHistory": [
    { "date": "", "documentVersion": "", "revisionDescription": "", "author": "" }
  ],
  "introduction": "Breve definición de Test Execution Log según ISO/IEC/IEEE 29119-3: documento que registra la ejecución de casos de prueba, incluyendo resultados, defectos y observaciones.",
  "testExecutionLog": [
    { "testCaseId": "", "testCaseDescription": "", "status": "", "executionStart": "", "executionEnd": "", "durationMs": , "tester": "", "defectId": , "comments": "" }
  ]
}

[TIR]
{
  "documentApprovalHistory": { "preparedBy": "" },
  "documentRevisionHistory": [
    { "date": "", "documentVersion": "", "revisionDescription": "", "author": "" }
  ],
  "introduction": "Plantilla de Informe de Incidente de Prueba (Test Incident Report) para registrar incidentes durante los diferentes niveles de prueba según ISO/IEC/IEEE 29119-3.",
  "testIncidentReports": [
    {
      "generalInformation": {
        "projectName": "",
        "testLevel": "Unitario|Integración|Sistema|Rendimiento|Aceptación|Otro",
        "incidentDate": "",
        "incidentNumber": "",
        "testCaseId": "",
        "application": "",
        "buildVersion": ""
      },
      "incidentDetails": {
        "dateTime": "",
        "originatorAndTitle": "",
        "environmentInformation": "",
        "incidentDescription": "",
        "expectedResults": "",
        "actualResults": "",
        "variance": "",
        "severity": "Alto|Medio|Bajo",
        "priority": "Alto|Medio|Bajo",
        "risk": "",
        "incidentStatus": "Abierto|Aprobado para resolución|Corregido|Reevaluado y confirmado|Cerrado|Rechazado|Retirado"
      }
    }
  ]
}

Instrucción adicional del usuario:
${userPrompt || "Genera un reporte técnico estándar"}
`;

/**
 * 📌 1. Generar Report a partir de archivo + prompt
 */
router.post("/generate", auth, async (req, res) => {
    try {
        const { file_id, title, prompt } = req.body;

        const file = await UploadedFile.findByPk(file_id);
        if (!file) return res.status(404).json({ error: "Archivo no encontrado" });

        if (!isValidFormat(file.file_name)) {
            return res.status(400).json({ error: `[ERROR] Formato de archivo no permitido: ${file.file_name}` });
        }

        const fileContent = fs.readFileSync(file.storage_path, "utf-8");

        // Crear Report base
        const report = await Report.create({
            file_id: file.file_id,
            generated_by: req.user.id,
            title: title || `Reporte generado ${new Date().toISOString()}`,
            content: "",
            status: "draft",
        });

        const fullPrompt = buildPrompt(fileContent, prompt);
        const result = await model.generateContent(fullPrompt);
        const geminiText = result.response.text();

        const processed = processGeminiResponse(geminiText);

        if (processed.isError) {
            return res.status(409).json({
                message: "Error en el contenido del archivo",
                content: processed.content || null
            });
        }

        // Crear versión inicial en ReportHistory
        const history = await ReportHistory.create({
            report_id: report.report_id,
            version: 1,
            prompt: prompt || null,
            content: processed.content,
            created_by: req.user.id,
        });

        await report.update({ content: processed.content });
        await audit("Report", "CREATE", null, report.toJSON(), req.user.id);

        res.json({ message: "Reporte generado", report, history });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error al generar reporte" });
    }
});

/**
 * 📌 2. Listar reportes de un proyecto
 */
router.get("/project/:project_id", auth, async (req, res) => {
    try {
        const reports = await Report.findAll({
            where: { is_deleted: false },
            include: [
                {
                    model: UploadedFile,
                    where: { project_id: req.params.project_id },
                },
            ],
        });
        res.json(reports);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error al listar reportes" });
    }
});

/**
 * 📌 3. Ver detalle de un reporte
 */
router.get("/:report_id", auth, async (req, res) => {
    try {
        const report = await Report.findByPk(req.params.report_id);
        if (!report) return res.status(404).json({ error: "Reporte no encontrado" });
        res.json(report);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error al obtener reporte" });
    }
});

/**
 * 📌 4. Editar reporte con nuevo archivo o prompt
 */
router.put("/:report_id", auth, async (req, res) => {
    try {
        const { title, status, prompt, file_id } = req.body;
        const report = await Report.findByPk(req.params.report_id);
        if (!report) return res.status(404).json({ error: "Reporte no encontrado" });

        // Caso 1: Solo actualizar título/estado
        if (!prompt && !file_id) {
            await report.update({ title, status });
            return res.json({ message: "Reporte actualizado", report });
        }

        let fileContent = report.content;

        // Caso 2: Re-generar con nuevo archivo
        if (file_id) {
            const file = await UploadedFile.findByPk(file_id);
            if (!file) return res.status(404).json({ error: "Archivo no encontrado" });
            if (!isValidFormat(file.file_name)) {
                return res.status(400).json({ error: `[ERROR] Formato de archivo no permitido: ${file.file_name}` });
            }
            fileContent = fs.readFileSync(file.storage_path, "utf-8");
            await report.update({ file_id });
        }

        const fullPrompt = buildPrompt(fileContent, prompt);
        const result = await model.generateContent(fullPrompt);
        const geminiText = result.response.text();

        const processed = processGeminiResponse(geminiText);

        if (processed.isError) {
            return res.status(409).json({
                message: "Error en el contenido del archivo",
                content: processed.content || null
            });
        }

        // Calcular nueva versión
        const lastHistory = await ReportHistory.findOne({
            where: { report_id: report.report_id },
            order: [["version", "DESC"]],
        });
        const newVersion = (lastHistory?.version || 0) + 1;

        const history = await ReportHistory.create({
            report_id: report.report_id,
            version: newVersion,
            prompt: prompt || null,
            content: processed.content,
            created_by: req.user.id,
        });

        await report.update({
            title: title || report.title,
            status: status || report.status,
            content: processed.content,
            prompt: prompt || report.prompt,
        });

        res.json({ message: "Reporte actualizado con nueva versión y archivo", report, history });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error al editar reporte" });
    }
});

/**
 * 📌 5. Listar historial de un reporte
 */
router.get("/:report_id/history", auth, async (req, res) => {
    try {
        const history = await ReportHistory.findAll({
            where: { report_id: req.params.report_id },
            order: [["version", "ASC"]],
        });
        res.json(history);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error al obtener historial" });
    }
});

module.exports = router;

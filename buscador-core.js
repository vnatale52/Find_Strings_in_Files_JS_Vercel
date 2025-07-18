const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const xlsx = require('xlsx');

const _getContextSnippets = (fullText, searchString, contextChars) => {
    const snippets = [];
    const textLower = fullText.toLowerCase();
    const searchStringLower = searchString.toLowerCase();
    let lastPos = 0;

    while (true) {
        const pos = textLower.indexOf(searchStringLower, lastPos);
        if (pos === -1) break;

        const foundText = fullText.substring(pos, pos + searchString.length);
        let snippet;
        
        if (contextChars > 0) {
            const startContext = Math.max(0, pos - contextChars);
            const endContext = Math.min(fullText.length, pos + searchString.length + contextChars);
            const preContext = fullText.substring(startContext, pos).replace(/\r?\n/g, ' ');
            const postContext = fullText.substring(pos + searchString.length, endContext).replace(/\r?\n/g, ' ');
            snippet = `  └─ Contexto: ...${preContext} >>>${foundText}<<< ${postContext}...`;
        } else {
            snippet = `  └─ Ocurrencia exacta: >>>${foundText}<<<`;
        }

        snippets.push(snippet);
        lastPos = pos + 1;
    }
    return snippets;
};

const procesarPdf = async (fileObject, listaStrings, contextChars) => {
    const hallazgos = [], problemas = [];
    const nombreBase = fileObject.originalname;
    try {
        const data = await pdf(fileObject.buffer);
        const pageText = data.text;
        if (!pageText || !pageText.trim()) {
            return [hallazgos, problemas];
        }
        for (const stringBuscado of listaStrings) {
            const snippets = _getContextSnippets(pageText, stringBuscado, contextChars);
            if (snippets.length > 0) {
                hallazgos.push(`\nArchivo: '${nombreBase}' (PDF) -> Encontrado: '${stringBuscado}'`);
                hallazgos.push(...snippets);
                hallazgos.push('');
            }
        }
    } catch (e) {
        problemas.push(`Archivo: '${nombreBase}' -> ERROR: No se pudo procesar. Razón: ${e.message}`);
    }
    return [hallazgos, problemas];
};

const procesarDocx = async (fileObject, listaStrings, contextChars) => {
    const hallazgos = [], problemas = [];
    const nombreBase = fileObject.originalname;
    try {
        const { value } = await mammoth.extractRawText({ buffer: fileObject.buffer });
        for (const stringBuscado of listaStrings) {
            const snippets = _getContextSnippets(value, stringBuscado, contextChars);
            if (snippets.length > 0) {
                hallazgos.push(`\nArchivo: '${nombreBase}' -> Encontrado: '${stringBuscado}'`);
                hallazgos.push(...snippets);
                hallazgos.push('');
            }
        }
    } catch (e) {
        problemas.push(`Archivo: '${nombreBase}' -> ERROR: No se pudo procesar. Razón: ${e.message}`);
    }
    return [hallazgos, problemas];
};

const procesarExcel = async (fileObject, listaStrings, contextChars) => {
    const hallazgos = [], problemas = [];
    const nombreBase = fileObject.originalname;
    try {
        const workbook = xlsx.read(fileObject.buffer);
        for (const nombreHoja of workbook.SheetNames) {
            const hoja = workbook.Sheets[nombreHoja];
            const data = xlsx.utils.sheet_to_json(hoja, { header: 1, defval: "" });
            for (let filaIdx = 0; filaIdx < data.length; filaIdx++) {
                for (let colIdx = 0; colIdx < data[filaIdx].length; colIdx++) {
                    const valorCelda = String(data[filaIdx][colIdx]);
                    if (valorCelda && valorCelda.trim()) {
                        for (const stringBuscado of listaStrings) {
                            const snippets = _getContextSnippets(valorCelda, stringBuscado, contextChars);
                            if (snippets.length > 0) {
                                const celdaRef = `${xlsx.utils.encode_col(colIdx)}${filaIdx + 1}`;
                                hallazgos.push(`\nArchivo: '${nombreBase}', Hoja: '${nombreHoja}', Celda: ${celdaRef} -> Encontrado: '${stringBuscado}'`);
                                hallazgos.push(...snippets);
                                hallazgos.push('');
                            }
                        }
                    }
                }
            }
        }
    } catch (e) {
        problemas.push(`Archivo: '${nombreBase}' -> ERROR: No se pudo procesar. Razón: ${e.message}`);
    }
    return [hallazgos, problemas];
};

const procesarTxt = async (fileObject, listaStrings, contextChars) => {
    const hallazgos = [], problemas = [];
    const nombreBase = fileObject.originalname;
    try {
        const contenido = fileObject.buffer.toString('utf-8');
        const lineas = contenido.split(/\r?\n/);
        for (let i = 0; i < lineas.length; i++) {
            const linea = lineas[i];
            if (!linea.trim()) continue;
            for (const stringBuscado of listaStrings) {
                const snippets = _getContextSnippets(linea, stringBuscado, contextChars);
                if (snippets.length > 0) {
                    hallazgos.push(`\nArchivo: '${nombreBase}', Línea: ${i + 1} -> Encontrado: '${stringBuscado}'`);
                    hallazgos.push(...snippets);
                    hallazgos.push('');
                }
            }
        }
    } catch (e) {
        problemas.push(`Archivo: '${nombreBase}' -> ERROR: No se pudo procesar. Razón: ${e.message}`);
    }
    return [hallazgos, problemas];
};

const generarInforme = async (archivos, listaStrings, contextChars = 240) => {
    let hallazgosTotales = [], archivosProblematicos = [], archivosIgnorados = [];
    let archivosProcesados = 0;
    const setArchivosConProblemas = new Set();
    const extensionesSoportadas = ['.pdf', '.docx', '.xlsx', '.xls', '.txt'];
    const path = require('path');

    for (const file of archivos) {
        const nombreArchivo = file.originalname;
        const extension = path.extname(nombreArchivo).toLowerCase();
        
        if (extensionesSoportadas.includes(extension)) {
            archivosProcesados++;
            let hallazgos = [], problemas = [];
            
            if (extension === '.pdf') [hallazgos, problemas] = await procesarPdf(file, listaStrings, contextChars);
            else if (extension === '.docx') [hallazgos, problemas] = await procesarDocx(file, listaStrings, contextChars);
            else if (['.xlsx', '.xls'].includes(extension)) [hallazgos, problemas] = await procesarExcel(file, listaStrings, contextChars);
            else if (extension === '.txt') [hallazgos, problemas] = await procesarTxt(file, listaStrings, contextChars);
            
            hallazgosTotales.push(...hallazgos);
            archivosProblematicos.push(...problemas);
            if (problemas.length > 0) {
                setArchivosConProblemas.add(nombreArchivo);
            }
        } else {
            archivosIgnorados.push(nombreArchivo);
        }
    }
    
    const totalConProblemas = setArchivosConProblemas.size;
    const totalSinProblemas = archivosProcesados - totalConProblemas;
    
    let output = [];
    output.push("=".repeat(30) + " INFORME DE BÚSQUEDA " + "=".repeat(30));
    output.push(`Textos Buscados: [${listaStrings.join(', ')}]`);
    output.push(`Cantidad de Caracteres de Contexto anteriores y posteriores al texto hallado: ${contextChars}`);
    output.push(`Extensiones Soportadas: ${extensionesSoportadas.join(', ')}`);
    output.push("=".repeat(79));
    
    output.push("\n--- OCURRENCIAS HALLADAS ---");
    if (hallazgosTotales.length > 0) {
        output.push(...hallazgosTotales);
    } else {
        output.push("No se encontraron ocurrencias de los textos buscados.");
    }

    output.push("\n\n--- ARCHIVOS PROCESADOS CON PROBLEMAS O ADVERTENCIAS ---");
    if (archivosProblematicos.length > 0) {
        output.push(...archivosProblematicos);
    } else {
        output.push("Todos los archivos soportados fueron analizados sin errores.");
    }

    output.push("\n\n--- ARCHIVOS NO SOPORTADOS E IGNORADOS ---");
    output.push(`Total: ${archivosIgnorados.length}\n`);
    if (archivosIgnorados.length > 0) {
        archivosIgnorados.sort().forEach(archivo => output.push(`- ${archivo}`));
    } else {
        output.push("No se encontraron archivos con formatos no soportados.");
    }
    
    output.push("\n\n" + "=".repeat(33) + " RESUMEN FINAL " + "=".repeat(33));
    output.push(`TOTAL DE ARCHIVOS SELECCIONADOS: ${archivos.length}`);
    output.push(`  - TOTAL DE ARCHIVOS PROCESADOS SIN PROBLEMAS: ${totalSinProblemas}`);
    output.push(`  - TOTAL DE ARCHIVOS PROCESADOS CON PROBLEMAS O ADVERTENCIAS: ${totalConProblemas}`);
    output.push(`  - TOTAL DE ARCHIVOS NO SOPORTADOS E IGNORADOS: ${archivosIgnorados.length}`);
    
    return output.join('\n');
};

module.exports = { generarInforme };
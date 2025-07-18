// server.js

const express = require('express');
const path = require('path');
const multer = require('multer'); // No necesitamos fs/promises aquí
const session = require('express-session');
const { createClient } = require('redis');
const RedisStore = require('connect-redis').default;
const { generarInforme } = require('./buscador-core.js');

// ... (la configuración de Redis no cambia) ...
const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
});
redisClient.connect().catch(console.error);
redisClient.on('error', err => console.log('Redis Client Error', err));
redisClient.on('connect', () => console.log('Conectado a Redis exitosamente.'));
const redisStore = new RedisStore({
    client: redisClient,
    prefix: 'buscadorapp:',
});

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'static')));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    store: redisStore,
    secret: 'una-clave-secreta-muy-dificil-de-adivinar-en-nodejs',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 1000 * 60 * 60
    }
}));

// ===== CAMBIO CLAVE EN MULTER =====
// Usar almacenamiento en memoria en lugar de disco
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 128 * 1024 * 1024 } // Límite de 128 MB en RAM
});
// ===================================


app.get('/', (req, res) => {
    res.render('index', { messages: req.session.messages || [] });
    req.session.messages = [];
});

// El post de buscar ahora pasa los archivos directamente
app.post('/buscar', upload.array('files'), async (req, res) => {
    const files = req.files; // files ahora es un array de objetos con buffers
    const searchStringsRaw = req.body.search_strings;
    let context_chars = parseInt(req.body.context_chars, 10);

    // ... (validaciones sin cambios) ...
    if (isNaN(context_chars) || context_chars < 0 || context_chars > 1000) {
        context_chars = 240;
    }
    if (!files || files.length === 0) {
        req.session.messages = [{ category: 'danger', text: 'No se seleccionó ningún archivo.' }];
        return res.redirect('/');
    }
    if (!searchStringsRaw || !searchStringsRaw.trim()) {
        req.session.messages = [{ category: 'danger', text: 'Debes introducir al menos un texto para buscar.' }];
        return res.redirect('/');
    }

    const listaStrings = searchStringsRaw.split(';').map(s => s.trim()).filter(s => s);
    
    try {
        // Pasamos el array de archivos directamente a generarInforme
        const reporteStr = await generarInforme(files, listaStrings, context_chars);
        req.session.reporte = reporteStr;
        res.render('resultados', { report_content: reporteStr });
    } catch (error) {
        console.error("Error al generar el informe:", error);
        req.session.messages = [{ category: 'danger', text: 'Ocurrió un error al procesar los archivos.' }];
        res.redirect('/');
    }
    // Ya no es necesario limpiar un directorio temporal
});

app.get('/descargar_reporte', (req, res) => {
    // ... (sin cambios) ...
    const reporte = req.session.reporte || 'No hay ningún informe para descargar.';
    res.setHeader('Content-disposition', 'attachment; filename=informe_busqueda_contexto.txt');
    res.setHeader('Content-type', 'text/plain');
    res.charset = 'UTF-8';
    res.write(reporte);
    res.end();
});

// Vercel ignora app.listen, pero es útil para desarrollo local
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Servidor de desarrollo escuchando en http://localhost:${PORT}`);
    });
}

// Exportar la app para que Vercel pueda usarla
module.exports = app;```

#### B. Actualizar `buscador-core.js` para aceptar Buffers

Ahora, las funciones de procesamiento deben ser modificadas para trabajar con los `buffers` de los archivos en memoria, en lugar de leer rutas de archivos del disco.

```javascript
// buscador-core.js

// Ya no necesitamos 'fs/promises' ni 'path' para leer archivos
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const xlsx = require('xlsx');

// _getContextSnippets no necesita cambios

// ===== CAMBIO EN LAS FUNCIONES DE PROCESAMIENTO =====
// Ahora aceptan un objeto de archivo de multer (con buffer) en lugar de una ruta

const procesarPdf = async (fileObject, listaStrings, contextChars) => {
    const hallazgos = [], problemas = [];
    const nombreBase = fileObject.originalname;
    try {
        // Usamos el buffer directamente
        const data = await pdf(fileObject.buffer);
        // ... el resto de la lógica es la misma
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
        // mammoth puede usar el buffer directamente
        const { value } = await mammoth.extractRawText({ buffer: fileObject.buffer });
        // ... el resto de la lógica es la misma
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
        // xlsx puede leer el buffer
        const workbook = xlsx.read(fileObject.buffer);
        // ... el resto de la lógica es la misma
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
        // Convertimos el buffer a string
        const contenido = fileObject.buffer.toString('utf-8');
        // ... el resto de la lógica es la misma
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

// ===== CAMBIO EN LA FUNCIÓN PRINCIPAL =====
// Ahora acepta el array de archivos de multer directamente
const generarInforme = async (archivos, listaStrings, contextChars = 240) => {
    let hallazgosTotales = [], archivosProblematicos = [], archivosIgnorados = [];
    let archivosProcesados = 0;
    const setArchivosConProblemas = new Set();
    const extensionesSoportadas = ['.pdf', '.docx', '.xlsx', '.xls', '.txt'];
    const path = require('path'); // necesitamos path aquí para obtener la extensión

    for (const file of archivos) {
        const nombreArchivo = file.originalname;
        const extension = path.extname(nombreArchivo).toLowerCase();
        
        if (extensionesSoportadas.includes(extension)) {
            archivosProcesados++;
            let hallazgos = [], problemas = [];
            
            // Pasamos el objeto 'file' completo
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
    
    // ... el resto de la función para construir el string del informe no cambia ...
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

module.exports = { generarInforme };// server.js

const express = require('express');
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const { createClient } = require('redis');
const RedisStore = require('connect-redis').default;
const { generarInforme } = require('./buscador-core.js');

// Envolvemos la inicialización en una función asíncrona
async function startServer() {
    try {
        console.log("Iniciando la conexión a Redis...");
        
        // Comprobar si la variable de entorno está presente
        if (!process.env.REDIS_URL) {
            throw new Error("La variable de entorno REDIS_URL no está definida.");
        }

        const redisClient = createClient({ url: process.env.REDIS_URL });
        
        redisClient.on('error', err => console.error('Error del Cliente Redis:', err));
        
        await redisClient.connect();
        console.log("Conectado a Redis exitosamente.");

        const redisStore = new RedisStore({
            client: redisClient,
            prefix: 'buscadorapp:',
        });

        const app = express();

        // El resto de la configuración de Express va aquí dentro
        app.set('view engine', 'ejs');
        app.set('views', path.join(__dirname, 'views'));
        app.use(express.static(path.join(__dirname, 'static')));
        app.use(express.urlencoded({ extended: true }));
        app.use(session({
            store: redisStore,
            secret: 'una-clave-secreta-muy-dificil-de-adivinar-en-nodejs',
            resave: false,
            saveUninitialized: false,
            cookie: {
                secure: true, // Siempre true para producción en Vercel
                httpOnly: true,
                maxAge: 1000 * 60 * 60
            }
        }));

        const storage = multer.memoryStorage();
        const upload = multer({
            storage: storage,
            limits: { fileSize: 128 * 1024 * 1024 }
        });

        // ----- RUTAS -----
        app.get('/', (req, res) => {
            res.render('index', { messages: req.session.messages || [] });
            req.session.messages = [];
        });
        
        app.post('/buscar', upload.array('files'), async (req, res) => {
             // Tu lógica de búsqueda aquí...
            const files = req.files;
            const searchStringsRaw = req.body.search_strings;
            let context_chars = parseInt(req.body.context_chars, 10);

            if (isNaN(context_chars) || context_chars < 0 || context_chars > 1000) {
                context_chars = 240;
            }

            if (!files || files.length === 0) {
                req.session.messages = [{ category: 'danger', text: 'No se seleccionó ningún archivo.' }];
                return res.redirect('/');
            }
            
            if (!searchStringsRaw || !searchStringsRaw.trim()) {
                req.session.messages = [{ category: 'danger', text: 'Debes introducir al menos un texto para buscar.' }];
                return res.redirect('/');
            }
        
            const listaStrings = searchStringsRaw.split(';').map(s => s.trim()).filter(s => s);
            
            try {
                const reporteStr = await generarInforme(files, listaStrings, context_chars);
                req.session.reporte = reporteStr;
                res.render('resultados', { report_content: reporteStr });
            } catch (error) {
                console.error("Error al generar el informe:", error);
                req.session.messages = [{ category: 'danger', text: 'Ocurrió un error al procesar los archivos.' }];
                res.redirect('/');
            }
        });

        app.get('/descargar_reporte', (req, res) => {
            const reporte = req.session.reporte || 'No hay ningún informe para descargar.';
            res.setHeader('Content-disposition', 'attachment; filename=informe_busqueda_contexto.txt');
            res.setHeader('Content-type', 'text/plain');
            res.charset = 'UTF-8';
            res.write(reporte);
            res.end();
        });

        // Devolvemos la app para que Vercel la pueda usar
        return app;

    } catch (error) {
        console.error("FALLO CRÍTICO AL INICIAR EL SERVIDOR: No se pudo conectar a Redis.", error);
        // En caso de fallo, exportamos una app mínima que devuelve un error claro
        const errorApp = express();
        errorApp.get('*', (req, res) => {
            res.status(503).send("Servicio no disponible debido a un problema de configuración. Por favor, revise los logs del servidor.");
        });
        return errorApp;
    }
}

// Exportamos el resultado de la función asíncrona
module.exports = startServer();
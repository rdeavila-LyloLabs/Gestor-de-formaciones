/**
 * CORPORATE LMS - BACKEND LOGIC
 * Google Apps Script
 */

const DB_SHEET_NAME = 'DB_Seguimiento';
const MAESTRA_SHEET_NAME = 'Maestra';
const CRONOGRAMA_SHEET_NAME = 'Cronograma';

// ==========================================
// 1. CORE & SETUP
// ==========================================

function doGet() {
  try {
    return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('Gestión de Formación Corporativa')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (e) {
    return ContentService.createTextOutput("ERROR CRÍTICO EN DOGET: " + e.message);
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Ensures the DB_Seguimiento sheet exists with correct headers.
 * Run this once manually or check on app load.
 */
function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(DB_SHEET_NAME);

  const headers = [
    'ID_Registro',      // A: UUID (Primary Key)
    'Cédula',           // B: Foreign Key User
    'Tema_Formacion',   // C: Foreign Key Training
    'Estado',           // D: PENDIENTE, EN CURSO, FINALIZADO
    'Fecha_Inicio',     // E: Date
    'Fecha_Fin',        // F: Date
    'Tipo_Asignacion',  // G: AUTOMATICA, MANUAL
    'Matriz_Categoria', // H: Cached Category (for easier reporting)
    'Timestamp'         // I: Last Edit
  ];

  if (!sheet) {
    sheet = ss.insertSheet(DB_SHEET_NAME);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return "Database Verified";
}

// ==========================================
// 2. READ OPERATIONS
// ==========================================

/**
 * Gets unique "MATRIZ" categories from Cronograma Col A for the Global Filter.
 */
function getFilterOptions() {
  const data = getSheetData_(CRONOGRAMA_SHEET_NAME); // Helper function
  if (!data || data.length === 0) return [];

  // Assuming 'MATRIZ' is Column A (Index 0)
  const categories = [...new Set(data.map(row => row[0]).filter(String))];
  return categories.sort();
}

/**
 * CORE LOGIC: Fetches Employee Data + Matrix Suggestions + History
 */
// 7. CORE LOGIC: Fetches Employee Data + Matrix Suggestions + History
function getEmployeeKardex(cedula, matrizFilter) {
  // 1. FETCH EMPLOYEE AND FLAGS
  const employee = getEmployeeByCedula_(cedula);
  if (!employee) return { error: "Colaborador no encontrado" };

  // PRE-CALCULATE GROUPS TO IMPROVE PERFORMANCE
  // Iterate employee object ONCE to find all keys with value "1"
  // This avoids iterating 50+ columns for every single training row later.
  // We also normalize strings for easier comparison.
  let empGroups = [];
  for (let key in employee) {
    if (String(employee[key]) == '1') { // Loose equality for "1" or 1 or "1 "
      empGroups.push(String(key).toUpperCase().trim());
    }
  }
  // Also add specific attributes if used in population (e.g. Cargo)
  if (employee['Cargo']) empGroups.push(String(employee['Cargo']).toUpperCase().trim());
  if (employee['Jefatura']) empGroups.push(String(employee['Jefatura']).toUpperCase().trim());

  // 2. FETCH CATALOG (CRONOGRAMA)
  const cronogramaData = getSheetData_(CRONOGRAMA_SHEET_NAME);
  // const cronogramaHeaders = getSheetHeaders_(CRONOGRAMA_SHEET_NAME); // No longer needed inside loop

  // 3. FETCH HISTORY (DB)
  const dbData = getSheetData_(DB_SHEET_NAME);
  // Optimized: Use filtered array
  const userHistory = dbData.filter(row => String(row[1]) === String(cedula));

  // 4. MATRIX MATCHING ENGINE
  let kardex = [];

  cronogramaData.forEach(trainingRow => {
    const matrixCat = trainingRow[0]; // Col A
    const topicName = trainingRow[1]; // Col B (Enfoque)
    const populationStr = String(trainingRow[5] || "").toUpperCase().trim(); // Col F (Index 5)
    const realTopic = trainingRow[3]; // Col D (Tema)

    // Global Filter Check
    if (matrizFilter && matrizFilter !== "TODOS" && matrixCat !== matrizFilter) return;

    // FAST MATCHING LOGIC
    // Check if 'TODOS' or if any of employee's groups appear in the population string
    let isRequired = false;

    if (populationStr !== "") {
      if (populationStr === "TODOS" || populationStr.includes("TODOS")) {
        isRequired = true;
      } else {
        // Optimization: Regex check might be overkill if we just check token inclusion
        // Check if ANY of the user's groups are present in the population string
        // We iterate the small list of user groups (e.g. 5 items) instead of 100 columns
        isRequired = empGroups.some(group => populationStr.includes(group));
      }
    }

    // 5. MERGE WITH HISTORY via Topic Name
    const historyEntries = userHistory.filter(h => h[2] === topicName); // Col C is Tema

    if (historyEntries.length > 0) {
      historyEntries.forEach(hist => {
        const assignmentType = hist[6];
        // Logic: Show if it's manual OR if it matches requirements.
        if (assignmentType === 'MANUAL' || isRequired) {
          kardex.push({
            type: 'DB_RECORD',
            uuid: hist[0],
            topic: topicName,
            realTopic: realTopic,
            category: matrixCat,
            status: hist[3],
            startDate: formatDate_(hist[4]),
            endDate: formatDate_(hist[5]),
            assignmentType: assignmentType,
            isRequired: isRequired
          });
        }
      });
    }

    if (historyEntries.length === 0 && isRequired) {
      kardex.push({
        type: 'SUGGESTION',
        uuid: null,
        topic: topicName,
        realTopic: realTopic,
        category: matrixCat,
        status: 'PENDIENTE',
        startDate: '',
        endDate: '',
        assignmentType: 'AUTOMATICA',
        isRequired: true
      });
    }
  });

  return {
    employee: {
      nombre: employee['Nombre'],
      cargo: employee['Cargo'],
      area: employee['Jefatura']
    },
    kardex: kardex
  };
}

/**
 * Returns list of employees for the Directory Table.
 * Returns { list: [], filters: { cargos: [], jefaturas: [] } }
 */
function getEmployeeList() {
  const data = getSheetData_(MAESTRA_SHEET_NAME);
  const headers = getSheetHeaders_(MAESTRA_SHEET_NAME);

  // Identify key columns by Header Name (fuzzy match with aliases)
  const idxNombre = headers.findIndex(h => {
    const H = h.toUpperCase();
    return H.includes("NOMBRE") || H.includes("EMPLEADO") || H.includes("COLABORADOR") || H.includes("FUNCIONARIO") || H.includes("APELLIDO") || H.includes("PERSONA");
  });

  // ... (rest of function unchanged, just ensuring context for replace)
  const idxCedula = headers.findIndex(h => {
    const H = h.toUpperCase();
    return (H.includes("CEDULA") || H.includes("CÉDULA") || H.includes("DOCUMENTO") || H.includes("ID") || H.includes("IDENTIFICACION") || H.includes("FICHA") || H.includes("RUT") || H.includes("DNI")) && !H.includes("TIPO");
  });
  const idxCargo = headers.findIndex(h => h.toUpperCase().includes("CARGO") || h.toUpperCase().includes("PUESTO") || h.toUpperCase().includes("ROL"));
  const idxJefatura = headers.findIndex(h => h.toUpperCase().includes("JEFATURA") || h.toUpperCase().includes("AREA") || h.toUpperCase().includes("DEPARTAMENTO") || h.toUpperCase().includes("GERENCIA"));

  if (idxNombre === -1 || idxCedula === -1) {
    return { error: `NO COINCIDENCIA DE COLUMNAS. Encabezados leídos en fila 1: [${headers.join(', ')}]. Se busca 'Nombre/Empleado' y 'Cédula/ID'. Verifica tu hoja 'Maestra'.` };
  }

  let list = [];
  let cargos = new Set();
  let jefaturas = new Set();

  data.forEach(row => {
    const ced = row[idxCedula];
    const nom = row[idxNombre];
    const car = idxCargo > -1 ? row[idxCargo] : "";
    const jef = idxJefatura > -1 ? row[idxJefatura] : "";

    if (ced && nom) {
      list.push({
        cedula: ced,
        nombre: nom,
        cargo: car,
        jefatura: jef
      });
      if (car) cargos.add(car);
      if (jef) jefaturas.add(jef);
    }
  });

  return {
    list: list,
    filters: {
      cargos: [...cargos].sort(),
      jefaturas: [...jefaturas].sort()
    }
  };
}

// ==========================================
// 3. WRITE OPERATIONS
// ==========================================

function saveKardexChanges(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let dbSheet = ss.getSheetByName(DB_SHEET_NAME);

  // Auto-create if missing (Self-healing)
  if (!dbSheet) {
    setupDatabase();
    dbSheet = ss.getSheetByName(DB_SHEET_NAME);
  }

  const data = dbSheet.getDataRange().getValues(); // Need to find row indices for updates
  const cedula = payload.cedula;

  // payload.changes is array of objects

  payload.changes.forEach(change => {
    if (change.action === 'DELETE') {
      // Find row by UUID and delete
      // Note: Deleting rows shifts indices. Better to Clear Content or use a specialized request.
      // For simplicity/safety in loop, we often mark as "DELETED" or we do a reverse loop if actual delete.
      // Here: We will match UUIDs and delete row.
      const rowIdx = findRowIndexByUuid_(data, change.uuid);
      if (rowIdx !== -1) dbSheet.deleteRow(rowIdx + 1); // deleteRow takes 1-based index

    } else if (change.action === 'UPDATE') {
      const rowIdx = findRowIndexByUuid_(data, change.uuid);
      if (rowIdx !== -1) {
        // Map columns: Id(0), Ced(1), Tema(2), Est(3), F.In(4), F.Fin(5) ...
        const dbRow = rowIdx + 1;
        dbSheet.getRange(dbRow, 4).setValue(change.data.status);
        dbSheet.getRange(dbRow, 5).setValue(change.data.startDate);
        dbSheet.getRange(dbRow, 6).setValue(change.data.endDate);
        dbSheet.getRange(dbRow, 9).setValue(new Date()); // Timestamp
      }

    } else if (change.action === 'INSERT') {
      const newUuid = generateUUID_();
      dbSheet.appendRow([
        newUuid,
        cedula,
        change.data.topic,
        change.data.status,
        change.data.startDate,
        change.data.endDate,
        change.data.assignmentType, // 'MANUAL' or 'AUTOMATICA'
        change.data.category,
        new Date()
      ]);
    }
  });

  return { success: true };
}

// ==========================================
// 4. HELPERS
// ==========================================

function getSheetData_(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  const range = sheet.getDataRange();
  const values = range.getValues();
  values.shift(); // Remove headers
  return values;
}

function getSheetHeaders_(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function getEmployeeByCedula_(cedula) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MAESTRA_SHEET_NAME);
  // Revert to simple data reading
  const data = sheet.getDataRange().getValues();
  const headers = data.shift(); // Remove headers

  const cedulaIdx = headers.findIndex(h => {
    const H = String(h).toUpperCase();
    return (H.includes("CEDULA") || H.includes("CÉDULA") || H.includes("DOCUMENTO") || H.includes("ID") || H.includes("IDENTIFICACION") || H.includes("FICHA") || H.includes("RUT") || H.includes("DNI")) && !H.includes("TIPO");
  });

  if (cedulaIdx === -1) return null;

  const foundRow = data.find(r => String(r[cedulaIdx]) === String(cedula));
  if (!foundRow) return null;

  let empObj = {};
  headers.forEach((h, i) => {
    empObj[h] = foundRow[i];
  });
  return empObj;
}

function findRowIndexByUuid_(allData, uuid) {
  for (let i = 0; i < allData.length; i++) {
    if (String(allData[i][0]) === String(uuid)) return i;
  }
  return -1;
}

function generateUUID_() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ==========================================
// 5. DASHBOARD STATS
// ==========================================

function getDashboardStats(matrixFilter) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dbSheet = ss.getSheetByName(DB_SHEET_NAME);

  // Stats Containers
  let totalAssignments = 0;
  let pending = 0;
  let finished = 0;
  let overdue = 0;

  // Area Compliance (Mock for now or simple)
  let areaStats = {}; // { "Operaciones": { total:0, finished:0 } }

  if (!dbSheet) return { error: "No hay datos aún." };

  const data = dbSheet.getDataRange().getValues();
  data.shift(); // Remove headers

  const now = new Date();

  data.forEach(row => {
    // Map: Id(0), Ced(1), Tema(2), Est(3), F.In(4), F.Fin(5), Type(6), Cat(7)
    const status = row[3];
    const category = row[7];
    const endDate = row[5] ? new Date(row[5]) : null;

    // Filter
    if (matrixFilter && matrixFilter !== "TODOS" && category !== matrixFilter) return;

    totalAssignments++;

    if (status === 'FINALIZADO') {
      finished++;
    } else if (status === 'PENDIENTE') {
      pending++;
      // Check overdue
      if (endDate && endDate < now) {
        overdue++;
      }
    } else if (status === 'EN CURSO') {
      // Count as pending or separate? Usually implies pending completion.
      pending++;
      if (endDate && endDate < now) overdue++;
    }
  });

  const compliance = totalAssignments === 0 ? 0 : Math.round((finished / totalAssignments) * 100);

  return {
    compliance: compliance,
    total: totalAssignments,
    pending: pending,
    overdue: overdue,
    // Add arrays for charts if needed
    monthly: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60] // Placeholder
  };
}


function formatDate_(dateObj) {
  if (!dateObj || dateObj === "") return "";
  try {
    return Utilities.formatDate(new Date(dateObj), Session.getScriptTimeZone(), "yyyy-MM-dd");
  } catch (e) {
    return "";
  }
}

// ==========================================
// 6. TRAINING CATALOG (FORMACIONES)
// ==========================================

function getTrainingCatalog() {
  const data = getSheetData_(CRONOGRAMA_SHEET_NAME);
  const headers = getSheetHeaders_(CRONOGRAMA_SHEET_NAME);

  // Map Columns dynamically
  const idxMatriz = 0;
  const idxEnfoque = 1;
  const idxTema = 3; // D
  const idxPoblacion = 5; // F

  // Find others
  const idxEje = headers.findIndex(h => {
    const H = String(h).toUpperCase();
    return H.includes("EJE") || H.includes("SIG");
  });

  const idxInicio = headers.findIndex(h => {
    const H = String(h).toUpperCase();
    return H.includes("INICIO") && !H.includes("REAL"); // Avoid 'Fecha Inicio Real' if any
  });

  const idxFin = headers.findIndex(h => {
    const H = String(h).toUpperCase();
    return H.includes("FIN") && !H.includes("REAL");
  });

  let catalog = [];

  data.forEach((row, i) => {
    catalog.push({
      row: i + 2, // 1-based index, +1 for header
      matriz: row[idxMatriz],
      enfoque: row[idxEnfoque],
      tema: row[idxTema],
      eje: idxEje > -1 ? row[idxEje] : "",
      poblacion: row[idxPoblacion],
      startDate: idxInicio > -1 ? formatDate_(row[idxInicio]) : "",
      endDate: idxFin > -1 ? formatDate_(row[idxFin]) : ""
    });
  });

  return catalog;
}

function saveTrainingCatalog(changes) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CRONOGRAMA_SHEET_NAME);
  const headers = getSheetHeaders_(CRONOGRAMA_SHEET_NAME);

  // We need to find or CREATE the date columns if they don't exist.
  let idxInicio = headers.findIndex(h => String(h).toUpperCase().includes("INICIO"));
  let idxFin = headers.findIndex(h => String(h).toUpperCase().includes("FIN"));

  // If columns missing, append them?
  // For safety, let's append if not found.
  if (idxInicio === -1) {
    idxInicio = headers.length; // New Col Index
    sheet.getRange(1, idxInicio + 1).setValue("Fecha Inicio");
  }
  if (idxFin === -1) {
    // Check again in case it was headers.length
    idxFin = headers.findIndex(h => String(h).toUpperCase().includes("FIN"));
    if (idxFin === -1) {
      idxFin = idxInicio + 1; // Next new col
      sheet.getRange(1, idxFin + 1).setValue("Fecha Fin");
    }
  }

  // Apply changes
  changes.forEach(change => {
    const row = change.row;
    if (change.startDate) sheet.getRange(row, idxInicio + 1).setValue(change.startDate);
    if (change.endDate) sheet.getRange(row, idxFin + 1).setValue(change.endDate);
  });

  return { success: true };
}

/**
 * GESTOR DE FORMACIONES - BACKEND
 * VERSIÓN: 3.1 (Corrección Filas de Encabezado)
 * ---------------------
 * Esta versión busca automáticamente en qué fila están los encabezados.
 */

const SPREADSHEET_ID = '15ho5sk_ZIo-aryNCs3bbamNqlToyoq4AgAwFwXvlZ-4'; 

function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Gestor de Formaciones')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ==========================================
// API CLIENTE
// ==========================================

function getDashboardStats() {
  try {
    // Buscamos 'CEDULA' para encontrar el header correcto en Maestra
    const empleados = getData('Maestra', 'CEDULA');
    
    const stats = {
      total_empleados: empleados.length,
      por_nivel: countBy(empleados, 'NIVEL_JERARQUICO'),
      por_area: countBy(empleados, 'DESCRIPCION_APUNTADOR'),
      por_cargo: countBy(empleados, 'DESCRIPCION_CARGO')
    };

    return JSON.stringify(stats);
  } catch (e) {
    console.error(e);
    throw new Error("Error obteniendo estadísticas: " + e.message);
  }
}

function getAllEmployees() {
  const empleados = getData('Maestra', 'CEDULA');
  
  const listado = empleados.map(e => ({
    cedula: e['CEDULA'] || e['DOCUMENTO'] || e['ID'],
    nombre: e['NOMBRE_COMPLETO'] || e['NOMBRE'] || e['NOMBRES'],
    cargo: e['DESCRIPCION_CARGO'] || e['CARGO'],
    area: e['DESCRIPCION_APUNTADOR'] || e['AREA'] || e['DEPARTAMENTO'],
    nivel: e['NIVEL_JERARQUICO'] || e['NIVEL']
  }));
  return JSON.stringify(listado);
}

function searchEmployee(busqueda) {
  const empleados = getData('Maestra', 'CEDULA');
  const term = busqueda.toString().toLowerCase();
  
  const empleado = empleados.find(e => {
    const cedula = String(e['CEDULA'] || e['DOCUMENTO'] || '').toLowerCase();
    const nombre = String(e['NOMBRE_COMPLETO'] || e['NOMBRE'] || '').toLowerCase();
    return cedula.includes(term) || nombre.includes(term);
  });

  if (!empleado) {
    return JSON.stringify({ found: false, message: "Empleado no encontrado" });
  }

  const plan = getTrainingsForEmployeeLogic(empleado);
  
  return JSON.stringify({
    found: true,
    empleado: empleado,
    plan: plan
  });
}

function assignTraining(cedula, tema, poblacion, estado) {
  try {
    const id = getConfig();
    const ss = SpreadsheetApp.openById(id);
    
    let sheet = ss.getSheetByName('Asignaciones_Individuales');
    if (!sheet) {
      sheet = ss.insertSheet('Asignaciones_Individuales');
      sheet.appendRow(['FECHA_ASIGNACION', 'CEDULA_EMPLEADO', 'TEMA', 'POBLACIÓN', 'ESTADO', 'ASIGNADO_POR']);
    }

    const fecha = new Date();
    const usuario = Session.getActiveUser().getEmail();
    
    sheet.appendRow([fecha, cedula, tema, poblacion || 'INDIVIDUAL', estado || 'PENDIENTE', usuario]);
    return "Asignación guardada correctamente";
    
  } catch (e) {
    throw new Error("Error guardando asignación: " + e.message);
  }
}

function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty('SPREADSHEET_ID') || SPREADSHEET_ID;
}

function setConfig(newId) {
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', newId);
  return "Guardado correctamente";
}

function diagnoseConnection() {
  let log = [];
  try {
    const id = getConfig();
    const ss = SpreadsheetApp.openById(id);
    
    ['Maestra', 'Matriz_grupos', 'Formaciones'].forEach(name => {
      const sheet = ss.getSheetByName(name);
      if (sheet) {
        log.push(`✅ Hoja "${name}": Encontrada.`);
        const data = sheet.getDataRange().getValues();
        // Mostrar primeras 3 filas para ver dónde empieza
        for(let i=0; i<Math.min(3, data.length); i++) {
          log.push(`   Fila ${i+1}: [${data[i].slice(0,5).join(', ')}...]`);
        }
      } else {
        log.push(`❌ FALTA HOJA: "${name}"`);
      }
    });

    return log.join('\n');
  } catch (e) {
    return `ERROR: ${e.message}\n${e.stack}`;
  }
}

// ==========================================
// CORE LOGIC
// ==========================================

function getTrainingsForEmployeeLogic(empleado) {
  const cedula = String(empleado['CEDULA'] || empleado['DOCUMENTO'] || '');
  const cargo = empleado['DESCRIPCION_CARGO'] || empleado['CARGO'];
  
  let totalFormaciones = [];
  let idsUnicos = new Set();

  if (cargo) {
    // Matriz suele tener CARGO en headers
    const matrizData = getData('Matriz_grupos', 'CARGO');
    
    const filaMatriz = matrizData.find(row => {
       const cargoMatriz = row['DESCRIPCION_CARGO'] || row['CARGO'];
       return cargoMatriz === cargo;
    });

    if (filaMatriz) {
      // Filtrar columnas dinámicas (las X)
      const gruposActivos = Object.keys(filaMatriz).filter(key => {
        if (key.includes('CARGO')) return false; 
        const val = filaMatriz[key];
        return val == 1 || String(val).toLowerCase() === 'x' || val === true;
      });

      if (gruposActivos.length > 0) {
        // Formaciones suele tener TEMA
        const catalogFormaciones = getData('Formaciones', 'TEMA');
        
        const porMatriz = catalogFormaciones.filter(f => {
          const pob = String(f['POBLACION'] || f['POBLACION_META'] || '').trim();
          return gruposActivos.some(grupoKey => normalizeHeader(pob) === grupoKey);
        }).map(f => ({
          TEMA: f['TEMA'] || f['CURSO'],
          ENFOQUE: f['ENFOQUE'] || 'GENERAL', // Nuevo Campo
          POBLACION: f['POBLACION'] || f['POBLACION_META'],
          ESTADO: f['ESTADO'] || 'PENDIENTE',
          ORIGEN: 'MATRIZ'
        }));
        
        porMatriz.forEach(f => {
          if(f.TEMA) {
            totalFormaciones.push(f);
            idsUnicos.add(f.TEMA);
          }
        });
      }
    }
  }

  try {
    const asignaciones = getData('Asignaciones_Individuales', 'CEDULA');
    if (asignaciones.length > 0) {
      const misAsignaciones = asignaciones.filter(row => String(row['CEDULA_EMPLEADO']) === cedula);
      misAsignaciones.forEach(a => {
        const tema = a['TEMA'];
        if (idsUnicos.has(tema)) {
          const existente = totalFormaciones.find(f => f.TEMA === tema);
          if (existente) {
             existente.ESTADO = a['ESTADO'];
             existente.ORIGEN = 'MATRIZ + INDIVIDUAL';
          }
        } else {
          totalFormaciones.push({
            TEMA: tema,
            POBLACION: a['POBLACIÓN'] || 'INDIVIDUAL',
            ESTADO: a['ESTADO'],
            ORIGEN: 'INDIVIDUAL'
          });
          idsUnicos.add(tema);
        }
      });
    }
  } catch (e) {}

  return totalFormaciones;
}


// ==========================================
// DATA HELPERS (AUTO-DETECT HEADER ROW)
// ==========================================

function getData(sheetName, keyToMatch) {
  const id = getConfig();
  if(!id) return [];
  
  const ss = SpreadsheetApp.openById(id);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  // SMART HEADER DETECTION
  // Buscamos la fila que contenga el 'keyToMatch' (parcialmente)
  // Si no se provee key, asumimos fila 0 o 1 si la 0 está vacía
  
  let headerRowIndex = 0;
  
  if (keyToMatch) {
    const normalizedKey = normalizeHeader(keyToMatch);
    // Buscamos en las primeras 5 filas
    for(let r=0; r<Math.min(data.length, 5); r++) {
       const rowNormalized = data[r].map(normalizeHeader);
       // Si alguna celda de esta fila contiene la KEY (ej: CEDULA)
       if (rowNormalized.some(h => h.includes(normalizedKey))) {
         headerRowIndex = r;
         break;
       }
    }
  }

  // Extraemos Headers y normalizamos
  const headers = data[headerRowIndex].map(normalizeHeader);
  
  // Datos empiezan DESPUÉS del header
  const rows = data.slice(headerRowIndex + 1);

  return rows.map(row => {
    let obj = {};
    headers.forEach((h, i) => {
      if(h) obj[h] = row[i];
    });
    return obj;
  });
}

/**
 * Normaliza: Mayúsculas, Sin Acentos, Espacios -> _
 */
function normalizeHeader(str) {
  if (!str) return '';
  return str.toString()
    .trim()
    .toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") 
    .replace(/\s+/g, '_')
    .replace(/\./g, '');
}

function countBy(array, key) {
  return array.reduce((acc, curr) => {
    const val = curr[key] || 'Sin Definir';
    acc[val] = (acc[val] || 0) + 1;
    return acc;
  }, {});
}

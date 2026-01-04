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
    const empleados = getData('Maestra', 'CEDULA');
    const matriz = getData('Matriz_grupos', 'CARGO');
    const formaciones = getData('Formaciones', 'TEMA');
    const asignaciones = getData('Asignaciones_Individuales', 'TEMA');
    
    // --- 1. CALCULO GLOBAL DE FORMACIONES ---
    // (Lógica espejo de getTrainingCatalog pero sumando globalmente)
    
    const global = { asignado: 0, pendiente: 0, vencido: 0, completado: 0, total: 0 };
    // Audit set para controlar duplicados (Cedula + Tema)
    const auditMatrix = new Set();
    
    // A. MAPEAR REGLAS MATRIZ (Cargo -> Set de Temas)
    const reglasPorCargo = {};
    matriz.forEach(row => {
        const cargo = row['DESCRIPCION_CARGO'] || row['CARGO'];
        if (cargo) {
            const grupos = Object.keys(row).filter(k => {
                if (k.includes('CARGO')) return false;
                const v = row[k];
                return v == 1 || String(v).toLowerCase() === 'x' || v === true; 
            });
            
            const temas = new Set();
            formaciones.forEach(f => {
                const pob = String(f['POBLACION'] || f['POBLACION_META'] || '').trim();
                if (grupos.some(g => normalizeHeader(pob) === g)) {
                    temas.add(f['TEMA'] || f['CURSO']);
                }
            });
            reglasPorCargo[cargo] = temas;
        }
    });
    
    // B. SUMAR DEMANDA BASE (MATRIZ)
    empleados.forEach(emp => {
         if(emp['ESTADO'] && emp['ESTADO'] !== 'ACTIVO') return;
         const cargo = emp['DESCRIPCION_CARGO'] || emp['CARGO'];
         const cedula = String(emp['CEDULA'] || emp['DOCUMENTO']);
         
         if (reglasPorCargo[cargo]) {
             reglasPorCargo[cargo].forEach(tema => {
                 global.total++;
                 global.pendiente++;
                 auditMatrix.add(cedula + '_' + tema); // Marcamos combinación única
             });
         }
    });

    // C. AJUSTAR CON INDIVIDUAL (+ Overrides)
    asignaciones.forEach(row => {
        const tema = row['TEMA'];
        const cedula = String(row['CEDULA_EMPLEADO']);
        let estado = row['ESTADO'] || 'PENDIENTE';
        
        // Calcular Vencido
        const fechaFin = row['FECHA_FIN'] ? new Date(row['FECHA_FIN']) : null;
        const hoy = new Date();
        hoy.setHours(0,0,0,0);
        
        if (estado !== 'COMPLETADO' && fechaFin && fechaFin < hoy) {
            estado = 'VENCIDO';
        } else if (estado === 'PENDIENTE') {
            estado = 'ASIGNADO';
        }

        const key = cedula + '_' + tema;
        
        if (auditMatrix.has(key)) {
            // Era de Matriz (ya contado como pendiente) -> Ajustar
            if (estado === 'COMPLETADO') {
                global.pendiente--;
                global.completado++;
            } else if (estado === 'VENCIDO') {
                global.pendiente--;
                global.vencido++;
            } else if (estado === 'ASIGNADO') {
                global.pendiente--;
                global.asignado++;
            }
        } else {
            // Es Nuevo (Individual puro)
            global.total++;
            if (estado === 'ASIGNADO') global.asignado++;
            if (estado === 'PENDIENTE') global.pendiente++;
            if (estado === 'VENCIDO') global.vencido++;
            if (estado === 'COMPLETADO') global.completado++;
        }
    });

    const stats = {
      total_empleados: empleados.length,
      por_nivel: countBy(empleados, 'NIVEL_JERARQUICO'),
      por_area: countBy(empleados, 'DESCRIPCION_APUNTADOR'),
      por_cargo: countBy(empleados, 'DESCRIPCION_CARGO'),
      // Nuevas Stats Globales
      kpi: {
          total_asignaciones: global.total,
          completadas: global.completado,
          pendientes: global.pendiente,
          vencidas: global.vencido,
          asignadas_manual: global.asignado,
          cumplimiento: global.total > 0 ? Math.round((global.completado / global.total) * 100) : 0
      }
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

function getTrainingCatalog() {
  const formaciones = getData('Formaciones', 'TEMA');
  const asignaciones = getData('Asignaciones_Individuales', 'TEMA');
  const empleados = getData('Maestra', 'CEDULA');  // Necesitamos saber cuántos empleados hay por cargo
  const matriz = getData('Matriz_grupos', 'CARGO'); // Necesitamos las reglas
  
  // 1. Mapa de Cargos -> Temas (Matrix Rules)
  // Cacheamos qué temas aplican a qué cargo según la matriz
  const reglasPorCargo = {};
  
  matriz.forEach(row => {
    const cargo = row['DESCRIPCION_CARGO'] || row['CARGO'];
    if (cargo) {
        // Obtenemos los grupos marcados con X
        const gruposActivos = Object.keys(row).filter(key => {
            if (key.includes('CARGO')) return false; 
            const val = row[key];
            return val == 1 || String(val).toLowerCase() === 'x' || val === true;
        });
        
        // Mapeamos Grupos -> Temas
        // Esto es un poco costoso O(N*M), optimizamos filtrando formaciones una vez
        const temasDelCargo = new Set();
        formaciones.forEach(f => {
            const pob = String(f['POBLACION'] || f['POBLACION_META'] || '').trim();
            // Normalizamos para comparar con los headers de matriz que ya estan normalizados por getData
            if (gruposActivos.some(grupoKey => normalizeHeader(pob) === grupoKey)) {
                temasDelCargo.add(f['TEMA'] || f['CURSO']);
            }
        });
        
        reglasPorCargo[cargo] = temasDelCargo;
    }
  });

  // 2. Inicializar Stats con la Demanda Base (Matrix)
  const stats = {};
  const initStat = () => ({ asignado: 0, pendiente: 0, vencido: 0, completado: 0, total: 0, audit: new Set() }); // audit para evitar doble conteo si hay overlaps extraños

  // Recorremos empleados activos
  empleados.forEach(emp => {
     if(emp['ESTADO'] && emp['ESTADO'] !== 'ACTIVO') return; // Solo activos
     
     const cargo = emp['DESCRIPCION_CARGO'] || emp['CARGO'];
     const cedula = String(emp['CEDULA'] || emp['DOCUMENTO']);
     
     if (reglasPorCargo[cargo]) {
         reglasPorCargo[cargo].forEach(tema => {
             if (!stats[tema]) stats[tema] = initStat();
             // Asumimos PENDIENTE por defecto si está en matriz
             stats[tema].total++;
             stats[tema].pendiente++; 
             stats[tema].audit.add(cedula + '_MATRIX'); // Marcamos que este empleado ya cuentan por matriz
         });
     }
  });

  // 3. Ajustar con Asignaciones Individuales (Overrides y Adicionales)
  asignaciones.forEach(row => {
    const tema = row['TEMA'];
    const cedula = String(row['CEDULA_EMPLEADO']);
    let estado = row['ESTADO'] || 'PENDIENTE';
    
    // Logica Vencido
    const fechaFin = row['FECHA_FIN'] ? new Date(row['FECHA_FIN']) : null;
    const hoy = new Date();
    hoy.setHours(0,0,0,0);
    
    if (estado !== 'COMPLETADO' && fechaFin && fechaFin < hoy) {
        estado = 'VENCIDO';
    } else if (estado === 'PENDIENTE') {
        estado = 'ASIGNADO'; 
    }
    
    if (!stats[tema]) stats[tema] = initStat();
    
    // Check si este usuario ya contaba por matriz
    if (stats[tema].audit.has(cedula + '_MATRIX')) {
        // Ya estaba contado como PENDIENTE de Matriz.
        // Si el estado individual es diferente, ajustamos.
        // Matriz por defecto suma 1 a Total y 1 a Pendiente.
        
        if (estado === 'COMPLETADO') {
            stats[tema].pendiente--;
            stats[tema].completado++;
        } else if (estado === 'VENCIDO') {
            stats[tema].pendiente--;
            stats[tema].vencido++;
        } else if (estado === 'ASIGNADO') {
            // Ya estaba pendiente, ahora es Asignado (Manual)
            stats[tema].pendiente--;
            stats[tema].asignado++;
        }
        // Si sigue pendiente (y no vencido), no hacemos nada, ya cuenta como pendiente.
    } else {
        // Es una asignación PURAMENTE individual (no estaba en su matriz)
        // Ojo: Si ya lo procesamos antes en este loop (duplicados en hoja asignaciones), no sumar
        // Simplificación: Asumimos 1 fila por emp por tema.
        stats[tema].total++;
        if (estado === 'ASIGNADO') stats[tema].asignado++;
        if (estado === 'PENDIENTE') stats[tema].pendiente++;
        if (estado === 'VENCIDO') stats[tema].vencido++;
        if (estado === 'COMPLETADO') stats[tema].completado++;
    }
  });
  
  // 4. Formatear Salida
  const result = new Map();
  formaciones.forEach(f => {
    const nombre = f['TEMA'] || f['CURSO'];
    if(nombre && !result.has(nombre)) {
        const s = stats[nombre] || initStat();
        const pct = s.total > 0 ? Math.round((s.completado / s.total) * 100) : 0;
        
        result.set(nombre, {
            tema: nombre,
            enfoque: f['ENFOQUE'] || 'GENERAL',
            stats: {
                asignada: s.asignado, 
                pendiente: s.pendiente, 
                vencida: s.vencido,
                cumplimiento: pct 
            }
        });
    }
  });
  
  return JSON.stringify(Array.from(result.values()));
}

function assignTrainingBulk(cedulas, tema, fechaInicio, fechaFin, link, estado) {
  try {
    const id = getConfig();
    const ss = SpreadsheetApp.openById(id);
    
    let sheet = ss.getSheetByName('Asignaciones_Individuales');
    if (!sheet) {
      sheet = ss.insertSheet('Asignaciones_Individuales');
      // Headers V4.0
      sheet.appendRow(['FECHA_ASIGNACION', 'CEDULA_EMPLEADO', 'TEMA', 'POBLACIÓN', 'ESTADO', 'ASIGNADO_POR', 'FECHA_INICIO', 'FECHA_FIN', 'LINK']);
    }

    // Verificar si faltan columnas (Migración V4)
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (headers.length < 9) {
       // Si es una versión vieja, agregamos los headers faltantes
       sheet.getRange(1, 7).setValue('FECHA_INICIO');
       sheet.getRange(1, 8).setValue('FECHA_FIN');
       sheet.getRange(1, 9).setValue('LINK');
    }

    const fechaAsig = new Date();
    const usuario = Session.getActiveUser().getEmail();
    
    // Procesamiento Masivo
    let rows = [];
    cedulas.forEach(cedula => {
       rows.push([
         fechaAsig, 
         cedula, 
         tema, 
         'INDIVIDUAL', 
         estado || 'ASIGNADO', 
         usuario,
         fechaInicio || '',
         fechaFin || '',
         link || ''
       ]);
    });
    
    // Escritura en bloque para performance
    if(rows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    }
    
    return `Se asignó correctamente a ${rows.length} empleados.`;
    
  } catch (e) {
    throw new Error("Error guardando asignación: " + e.message);
  }
}

// Mantenemos retrocompatibilidad por si acaso, pero la UI nueva usará assignTrainingBulk
function assignTraining(cedula, tema, poblacion, estado) {
  return assignTrainingBulk([cedula], tema, '', '', '', estado);
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
        let estado = a['ESTADO'];
        
        // Logica de Vencimiento logic (V4.1)
        const fechaFin = a['FECHA_FIN'] ? new Date(a['FECHA_FIN']) : null;
        const hoy = new Date();
        // Reset hora para comparar solo fechas
        hoy.setHours(0,0,0,0);
        
        if (estado !== 'COMPLETADO' && fechaFin && fechaFin < hoy) {
            estado = 'VENCIDO';
        } else if (estado === 'PENDIENTE') {
            // Usuario prefiere ver "ASIGNADO" si fue una asignación manual
            estado = 'ASIGNADO';
        }

        if (idsUnicos.has(tema)) {
          const existente = totalFormaciones.find(f => f.TEMA === tema);
          if (existente) {
             existente.ESTADO = estado;
             existente.ORIGEN = 'MATRIZ + INDIVIDUAL';
          }
        } else {
          totalFormaciones.push({
            TEMA: tema,
            POBLACION: a['POBLACIÓN'] || 'INDIVIDUAL',
            ESTADO: estado,
            ORIGEN: 'INDIVIDUAL',
            ENFOQUE: a['ENFOQUE'] || 'ESPECÍFICO' // Intentar recuperar enfoque si existe
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

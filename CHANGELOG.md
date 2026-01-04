# Changelog

## [3.1] - 2026-01-04
### Fixed
*   **Detección de Cabeceras**: Se agregó lógica para detectar automáticamente la fila de encabezados en Sheets, permitiendo que la tabla comience en filas distintas a la 1.
*   **Normalización**: Mejorada la limpieza de acentos y mayúsculas en nombres de columnas.

## [3.0] - 2026-01-04
### Added
*   **Normalización de Datos**: Sistema robusto para leer columnas ignorando diferencias de "Case" o acentos (ej: "Cédula" vs "CEDULA").
*   **Diagnóstico**: Función `diagnoseConnection` para reportar estado de hojas.

## [2.1] - 2026-01-04
### Added
*   **Botón de Diagnóstico**: Interfaz en el frontend para ejecutar pruebas de conexión.

## [2.0] - 2026-01-04
### Added
*   **Directorio de Empleados**: Vista de tabla completa.
*   **Asignación Manual**: Funcionalidad de escritura en hoja 'Asignaciones_Individuales'.
*   **Reportes**: Gráficos detallados por Área y Nivel.

## [1.0] - 2026-01-04
*   Lanzamiento inicial (Dashboard y Matriz de Formación).

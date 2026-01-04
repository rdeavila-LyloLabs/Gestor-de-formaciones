# Guía de Despliegue: Gestor de Formaciones

Sigue estos pasos para poner en marcha tu aplicación web en Google Workspace.

## Requisitos Previos
Tener un Google Sheet con las siguientes 3 pestañas (nombres exactos):
1.  **Maestra**: Debe tener columnas `Cédula`, `Nombre Completo`, `Descripción Cargo`, `Descripción Jefatura`, `Nivel Jerarquico`.
2.  **Matriz_grupos**: Filas con `Descripción Cargo` y columnas con los nombres de los Grupos (Ej: `LÍDERES`, `OPERATIVOS`). Marcar con `1` o `X` las intersecciones.
3.  **Formaciones**: Debe tener columnas `TEMA`, `POBLACIÓN`, `ESTADO`.

## Paso 1: Configurar Apps Script
1.  Abre tu Google Sheet.
2.  Ve al menú **Extensiones** > **Apps Script**.
3.  Se abrirá una nueva pestaña con el editor de código.

## Paso 2: Copiar el Código
### Archivo Code.gs
1.  Borra cualquier código que haya en el archivo `Código.gs` (o `Code.gs`) por defecto.
2.  Copia todo el contenido del archivo `Code.gs` que he generado.
3.  **(YA CONFIGURADO)** He insertado directamente el ID de tu hoja (`15ho5sk...`) en el código.

### Archivo Index.html
1.  Haz clic en el botón **+** (junto a Archivos) > **HTML**.
2.  Nombra el archivo como `Index` (respetando la mayúscula inicial).
3.  Borra el contenido por defecto.
4.  Copia y pega todo el código del archivo `Index.html` que he generado.

## Paso 3: Publicar la Web App (CRÍTICO)
> [!IMPORTANT]
> Si no configuras esto bien, verás el error "No se pudo abrir el archivo".

1.  Haz clic en el botón azul **Implementar** (o *Deploy*) > **Nueva implementación**.
2.  En la ventana, haz clic en el icono de engranaje (Tipo) y selecciona **Aplicación web**.
3.  Configura EXACTAMENTE así:
    *   **Descripción**: `Version 1`
    *   **Ejecutar como**: `Yo` (Esto es vital para evitar errores de permisos, significa que el script usa TU cuenta para leer el Sheet).
    *   **Quién tiene acceso**: `Cualquier usuario de [Tu Organización]` (o `Cualquier usuario` si quieres acceso público). **NUNCA pongas "Solo yo"**.
4.  Haz clic en **Implementar**.
5.  Copia la **URL de la aplicación web**.

---

## Actualización a Versión 2 (CRÍTICO)

Si ya tenías la app desplegada y quieres ver los cambios nuevos (Directorio y Asignación):

1.  Copia y pega el **NUEVO código** en `Code.gs` e `Index.html`.
2.  Ve a **Implementar** > **Gestionar implementaciones**.
3.  Haz clic en el icono de **Lápiz (Editar Implementation)**.
4.  En "Versión", selecciona **"Nueva versión"**.
5.  Haz clic en **Implementar**.

> **Nota:** Al usar nuevas funciones de escritura, es posible que la primera vez que intentes asignar una formación te pida **Autorizar permisos** nuevamente. Acepta todo.

### Error: "No se pudo abrir el archivo"
Si ya verificaste los permisos del Paso 3 y sigue fallando:

1.  **Problema de Múltiples Cuentas (Muy Común):**
    Google tiene un bug conocido cuando tienes varias cuentas de Google abiertas en el mismo navegador (ej: Personal y Trabajo).
    *   **Solución:** Abre una ventana de **Incógnito**, inicia sesión SOLO con la cuenta dueña del script y prueba el link ahí.

2.  **Permisos de Despliegue:**
    *   Ve a **Implementar** > **Gestionar implementaciones**.
    *   Edita y asegura que **Quién tiene acceso** NO sea "Solo yo".

# Custom Chrome MCP Server 

**Tu puente inteligente entre la IA y el Navegador.**

Este servidor MCP (Model Context Protocol) permite a asistentes como Claude, Roo Code o Windsurf interactuar con Google Chrome de una manera **natural y potente**. A diferencia de otras herramientas de automatización, esta solución se conecta a tu navegador real, permitiéndote usar tus sesiones iniciadas, cookies y extensiones sin ser detectado.

---

##  ¿Por qué usar esto?

*   ** Navegación "Humana":** Usa tu perfil de Chrome real. Si ya estás logueado en LinkedIn, Gmail o tu ERP corporativo, la IA también lo estará.
*   ** Indetectable:** Tecnologías avanzadas de anti-detección y "Shadow Profile" para evitar bloqueos en sitios complejos.
*   ** Herramientas Robustas:** Más de 40 herramientas optimizadas para extracción de datos (scraping), automatización de formularios y análisis visual.
*   ** Rápido y Seguro:** Ejecuta scripts y capturas de pantalla de manera segura, truncando salidas gigantes para no saturar a la IA.

---

##  Instalación Rápida

### Para Usuarios (VS Code / Roo Code / Claude Desktop)

Simplemente agrega esto a tu configuración de `mcpServers` (archivo `mcp.json`):

```json
{
  "mcpServers": {
    "custom-chrome-mcp": {
      "command": "npx",
      "args": ["-y", "@eddym06/custom-chrome-mcp", "--port=9223"]
    }
  }
}
```

¡Y listo! Al reiniciar tu asistente, tendrás acceso a herramientas como `launch_chrome_with_profile`, `get_html`, `click`, `type`, etc.

---

##  Guía de Uso Simplificada

### 1. Iniciar el Navegador
La primera vez, pide a la IA:
> *"Lanza Chrome con mi perfil por default"*

Esto usará la herramienta `launch_chrome_with_profile` para abrir una ventana de Chrome controlable sin cerrar tus otras ventanas.

### 2. Navegar y Analizar
Puedes pedir cosas como:
*   *"Ve a amazon.com y busca laptops"*
*   *"Analiza el HTML de esta página"* (Usa `get_html` optimizado)
*   *"Toma una captura de pantalla"*

### 3. Interactuar
La IA puede hacer clic, escribir y rellenar formularios por ti de manera inteligente, esperando a que los elementos carguen.

---

##  Herramientas Destacadas

| Categoría | Herramientas Clave | Descripción |
|-----------|-------------------|-------------|
| **Navegación** | `browser_action`, `manage_tabs` | Control total de pestañas, recargas y movimiento. |
| **Análisis** | `get_html`, `screenshot`, `get_page_metrics` | Ve lo que ve el usuario. `get_html` incluye selectores inteligentes. |
| **Interacción** | `perform_interaction`, `execute_script` | Clics, escritura y ejecución de JS seguro. |
| **Red** | `capture_network`, `resend_request` | (Avanzado) Analiza tráfico y repite peticiones API. |

---

##  Preguntas Frecuentes

**¿Necesito cerrar mi Chrome?**
No. Gracias a la tecnología "Shadow Profile", el servidor crea una copia segura de tu perfil temporalmente. Puedes seguir usando tu Chrome normal mientras la IA trabaja en paralelo.

**¿Funciona en Mac y Linux?**
¡Sí! El sistema es totalmente multiplataforma.

**Me aparece "Tool disabled by user"**
Esto es un tema de seguridad de tu editor (VS Code). Generalmente se soluciona reiniciando la ventana (`Ctrl+R`) y aprobando los nuevos permisos cuando la IA intenta usar una herramienta.

---

##  Para Desarrolladores

Si quieres contribuir o correrlo localmente:

1.  Clona el repositorio.
2.  Instala dependencias: `npm install`
3.  Construye: `npm run build`
4.  Inicia: `npm start`

---
*Desarrollado con  por @eddym06*

# Custom Chrome MCP 🚀

Cross-platform Model Context Protocol (MCP) server for advanced Chrome browser automation and control. Works on Windows, macOS, and Linux.

## 📦 Quick Install for VS Code

Add this to your `mcp.json` config file:

```json
{
  "mcpServers": {
    "custom-chrome-mcp": {
      "command": "npx",
      "args": ["-y", "@eddym06/custom-chrome-mcp", "--port=9222"]
    }
  }
}
```

## 🌍 Platform Support

- ✅ **Windows** - Full support with robocopy-based Shadow Profile
- ✅ **macOS** - Full support with rsync-based Shadow Profile  
- ✅ **Linux** - Full support with rsync-based Shadow Profile

## ✨ Características Principales

### 🔌 Conexión a Chrome Existente
- **Conecta a tu Chrome ya abierto** con `--remote-debugging-port=9222`
- **Usa tus sesiones activas** (Google, Facebook, etc.)
- **Sin detección de automatización** porque usas tu navegador real
- **Mantén tus extensiones y configuración**

### 🛡️ Anti-Detección Avanzada
- Oculta `navigator.webdriver`
- Spoof de plugins y permisos
- User-Agent personalizable
- Timezone y geolocalización configurable
- Scripts anti-detección automáticos

### 🔒 Shadow Profile System
- **Bypasses Chrome's Default profile debugging restriction**
- Platform-specific cloning (robocopy on Windows, rsync on Unix)
- Automatic encryption key preservation
- Skips cache folders for fast copying

### ⚙️ Gestión Completa de Service Workers
- Listar todos los Service Workers registrados
- Inspeccionar, actualizar y desregistrar workers
- Iniciar/detener Service Workers
- Gestión de caché de Service Workers
- Skip waiting y control total

### 🍪 Gestión de Sesiones
- Exportar/importar sesiones completas
- Gestión de cookies (get, set, delete)
- localStorage y sessionStorage
- Persistencia de sesiones entre ejecuciones

### 📸 Captura Avanzada
- Screenshots (fullpage, áreas específicas)
- Exportar a PDF
- Obtener HTML completo
- Métricas de página
- Árbol de accesibilidad

### 🎯 Automatización Inteligente
- Delays human-like automáticos
- Wait for selectors
- Navegación completa (back, forward, reload)
- Multi-tab management
- Ejecución de JavaScript custom

## 📦 Instalación

### Desde GitHub Packages

1. Crea un archivo `.npmrc` en tu proyecto:
```bash
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
@eddym06:registry=https://npm.pkg.github.com
```

2. Instala el paquete:
```bash
npm install @eddym06/custom-chrome-mcp
```

### Desde el código fuente
```bash
git clone https://github.com/Eddym06/devTools-Advance-mcp.git
cd custom-chrome-mcp
npm install
npm run build
```
npm install -g custom-chrome-mcp
```

### Desarrollo local
```bash
cd custom-chrome-mcp
npm install
npm run build
```

## 🚀 Uso Rápido

### 1. Lanza Chrome con debugging habilitado

**Windows:**
```powershell
start chrome --remote-debugging-port=9222
```

**macOS:**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 &
```

**Linux:**
```bash
google-chrome --remote-debugging-port=9222 &
```

### 2. Configura el MCP en VS Code

Agrega en tu `mcp.json` o configuración de Cline/Claude:

```json
{
  "mcpServers": {
    "custom-chrome-mcp": {
      "command": "npx",
      "args": ["custom-chrome-mcp", "--port=9222"]
    }
  }
}
```

### 3. ¡Empieza a usar!

El MCP se conectará automáticamente a tu Chrome y tendrás acceso a 44 herramientas organizadas en 6 categorías.

## 🛠️ Herramientas Disponibles

### Navegación & Tabs (8 herramientas)
- `navigate` - Navegar a URL
- `go_back` / `go_forward` - Historial
- `reload` - Recargar página
- `list_tabs` - Listar pestañas
- `create_tab` - Crear pestaña
- `close_tab` - Cerrar pestaña
- `switch_tab` - Cambiar de pestaña
- `get_url` - Obtener URL actual

### Interacción con Página (8 herramientas)
- `click` - Hacer click en elemento
- `type` - Escribir texto
- `get_text` - Obtener texto
- `get_attribute` - Obtener atributo
- `execute_script` - Ejecutar JavaScript
- `scroll` - Hacer scroll
- `wait_for_selector` - Esperar elemento
- `select_option` - Seleccionar opción

### Anti-Detección (5 herramientas)
- `enable_stealth_mode` - Activar modo stealth
- `set_user_agent` - Cambiar user agent
- `set_viewport` - Configurar viewport
- `set_geolocation` - Configurar ubicación
- `set_timezone` - Configurar zona horaria

### Service Workers (9 herramientas)
- `list_service_workers` - Listar workers
- `get_service_worker` - Obtener detalles
- `unregister_service_worker` - Desregistrar
- `update_service_worker` - Actualizar
- `start_service_worker` - Iniciar
- `stop_service_worker` - Detener
- `inspect_service_worker` - Inspeccionar
- `skip_waiting` - Skip waiting
- `get_sw_caches` - Obtener cachés

### Captura (5 herramientas)
- `screenshot` - Captura de pantalla
- `get_html` - Obtener HTML
- `print_to_pdf` - Exportar a PDF
- `get_page_metrics` - Métricas de página
- `get_accessibility_tree` - Árbol a11y

### Sesiones & Cookies (9 herramientas)
- `get_cookies` - Obtener cookies
- `set_cookie` - Establecer cookie
- `delete_cookie` - Eliminar cookie
- `clear_cookies` - Limpiar cookies
- `get_local_storage` - Obtener localStorage
- `set_local_storage` - Establecer item
- `clear_local_storage` - Limpiar storage
- `export_session` - Exportar sesión
- `import_session` - Importar sesión

## 💡 Ejemplos de Uso

### Ejemplo 1: Navegar y hacer screenshot
```typescript
// Navegar a una URL
await mcp.call('navigate', { url: 'https://example.com' });

// Esperar que cargue un elemento
await mcp.call('wait_for_selector', { selector: '#content' });

// Tomar screenshot full page
await mcp.call('screenshot', { fullPage: true, format: 'png' });
```

### Ejemplo 2: Activar modo stealth y navegar
```typescript
// Activar modo stealth
await mcp.call('enable_stealth_mode', {});

// Navegar a Google
await mcp.call('navigate', { url: 'https://google.com' });

// Escribir en el buscador
await mcp.call('type', { 
  selector: 'input[name="q"]', 
  text: 'model context protocol' 
});

// Hacer click en buscar
await mcp.call('click', { selector: 'input[type="submit"]' });
```

### Ejemplo 3: Exportar sesión
```typescript
// Exportar sesión actual (cookies, localStorage, etc.)
const result = await mcp.call('export_session', {});
console.log(result.session);

// Guardar en archivo
fs.writeFileSync('session.json', JSON.stringify(result.session));

// Importar en otra sesión
const sessionData = fs.readFileSync('session.json', 'utf8');
await mcp.call('import_session', { sessionData });
```

### Ejemplo 4: Gestionar Service Workers
```typescript
// Listar todos los service workers
const workers = await mcp.call('list_service_workers', {});
console.log(workers.workers);

// Actualizar un service worker específico
await mcp.call('update_service_worker', { 
  scopeURL: 'https://example.com/' 
});

// Ver cachés
const caches = await mcp.call('get_sw_caches', {});
console.log(caches.caches);
```

## 🔧 Configuración Avanzada

### Puerto personalizado
```json
{
  "custom-chrome-mcp": {
    "command": "npx",
    "args": ["custom-chrome-mcp", "--port=9333"]
  }
}
```

### Variables de entorno
Puedes configurar:
- `CHROME_PORT` - Puerto de debugging (default: 9222)

## 🎯 Ventajas sobre otros MCPs

| Característica | Custom Chrome MCP | chrome-devtools-mcp | playwright-mcp |
|----------------|-------------------|---------------------|----------------|
| Conecta a Chrome existente | ✅ | ❌ | ❌ |
| Usa sesiones reales | ✅ | ❌ | ❌ |
| Anti-detección | ✅ | ❌ | ⚠️ |
| Service Workers | ✅ | ⚠️ | ⚠️ |
| Exportar/importar sesiones | ✅ | ❌ | ❌ |
| Delays human-like | ✅ | ❌ | ⚠️ |
| Multi-tab | ✅ | ✅ | ✅ |
| Screenshots | ✅ | ✅ | ✅ |

## 🐛 Troubleshooting

### Error: Failed to connect to Chrome
**Solución:** Asegúrate de que Chrome está corriendo con `--remote-debugging-port=9222`

```powershell
# Verifica que el puerto está abierto
netstat -an | findstr 9222
```

### Chrome detecta automatización
**Solución:** Usa `enable_stealth_mode` antes de navegar a sitios sensibles

```typescript
await mcp.call('enable_stealth_mode', {});
```

### Service Workers no aparecen
**Solución:** Los Service Workers solo funcionan con HTTPS o localhost. Usa un servidor local:

```bash
python -m http.server 8000
# Luego navega a http://localhost:8000
```

## 📝 Desarrollo

### Estructura del proyecto
```
custom-chrome-mcp/
├── src/
│   ├── index.ts              # Servidor MCP principal
│   ├── chrome-connector.ts   # Conexión a Chrome
│   ├── tools/
│   │   ├── navigation.ts     # Navegación
│   │   ├── interaction.ts    # Interacción
│   │   ├── anti-detection.ts # Anti-detección
│   │   ├── service-worker.ts # Service Workers
│   │   ├── capture.ts        # Capturas
│   │   └── session.ts        # Sesiones
│   ├── utils/
│   │   └── helpers.ts        # Utilidades
│   └── types/
│       └── index.ts          # Tipos TypeScript
├── package.json
└── tsconfig.json
```

### Comandos
```bash
npm run build    # Compilar TypeScript
npm run dev      # Modo desarrollo (watch)
npm run lint     # Lint código
npm run format   # Formatear código
```

### Añadir nuevas herramientas

1. Crea un nuevo archivo en `src/tools/`
2. Define tus herramientas usando el patrón:

```typescript
export function createMyTools(connector: ChromeConnector) {
  return [
    {
      name: 'my_tool',
      description: 'Descripción de la herramienta',
      inputSchema: z.object({
        param: z.string().describe('Parámetro')
      }),
      handler: async ({ param }: any) => {
        // Implementación
        return { success: true };
      }
    }
  ];
}
```

3. Importa y añade en [index.ts](src/index.ts)

## 📄 Licencia

MIT © 2026 Eddy M

## 🤝 Contribuciones

¡Las contribuciones son bienvenidas! Por favor:

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/amazing-feature`)
3. Commit tus cambios (`git commit -m 'Add amazing feature'`)
4. Push a la rama (`git push origin feature/amazing-feature`)
5. Abre un Pull Request

## 🙏 Agradecimientos

- [Model Context Protocol](https://modelcontextprotocol.io/) - El protocolo que hace esto posible
- [chrome-remote-interface](https://github.com/cyrus-and/chrome-remote-interface) - Cliente CDP para Node.js
- La comunidad de Chrome DevTools

## 📧 Soporte

Si encuentras algún problema o tienes preguntas:
- Abre un issue en GitHub
- Consulta la documentación de MCP
- Revisa los ejemplos en este README

---

**Hecho con ❤️ para automatizar Chrome de forma inteligente**

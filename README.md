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

### ⏱️ Timeouts Inteligentes
- **Timeouts configurables por operación**: La IA decide el timeout según complejidad
- Defaults optimizados: 10-60 segundos según la herramienta
- Prevención de cuelgues en operaciones pesadas
- HAR exports: hasta 60s para archivos grandes
- Inyección CSS/JS: 10-15s para scripts complejos
- Parámetro `timeoutMs` en todas las herramientas críticas

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

El MCP se conectará automáticamente a tu Chrome y tendrás acceso a **84 herramientas** organizadas en **15 categorías**.

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

### Captura (7 herramientas)
- `screenshot` - Captura de pantalla
- `get_html` - Obtener HTML
- `print_to_pdf` - Exportar a PDF
- `get_page_metrics` - Métricas de página
- `get_accessibility_tree` - Árbol a11y completo
- `get_accessibility_snapshot` - Snapshot Playwright-style

### Network Interception (8 herramientas)
- `enable_network_interception` - Activar interceptación de requests
- `list_intercepted_requests` - Listar requests interceptados
- `modify_intercepted_request` - Modificar request (headers, URL, body)
- `fail_intercepted_request` - Bloquear request (ads, tracking)
- `continue_intercepted_request` - Continuar sin modificar
- `disable_network_interception` - Desactivar interceptación

### Network Response Interception (4 herramientas)
- `enable_response_interception` - Activar interceptación de respuestas
- `list_intercepted_responses` - Listar respuestas interceptadas
- `modify_intercepted_response` - Modificar respuesta (body, headers, status)
- `disable_response_interception` - Desactivar interceptación

### Request/Response Mocking (4 herramientas)
- `create_mock_endpoint` - Crear endpoint falso (mock API responses)
- `list_mock_endpoints` - Listar mocks activos
- `delete_mock_endpoint` - Eliminar mock específico
- `clear_all_mocks` - Limpiar todos los mocks

### WebSocket Interception (5 herramientas)
- `enable_websocket_interception` - Activar interceptación de WebSockets
- `list_websocket_connections` - Listar conexiones WS activas
- `list_websocket_messages` - Ver mensajes WS (sent/received)
- `send_websocket_message` - Inyectar mensaje en WebSocket
- `disable_websocket_interception` - Desactivar interceptación WS

### HAR Recording & Replay (3 herramientas)
- `start_har_recording` - Iniciar grabación HAR (HTTP Archive)
- `stop_har_recording` - Detener y obtener HAR data
- `export_har_file` - Exportar HAR a archivo .har

### Advanced Request Patterns (1 herramienta)
- `add_advanced_interception_pattern` - Patrón avanzado (status code, size, duration, content-type, action)

### CSS/JS Injection Pipeline (5 herramientas)
- `inject_css_global` - Inyectar CSS en todas las páginas
- `inject_js_global` - Inyectar JavaScript en todas las páginas
- `list_injected_scripts` - Listar inyecciones activas
- `remove_injection` - Remover inyección específica
- `clear_all_injections` - Limpiar todas las inyecciones

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
console.log(workers);

// Actualizar un service worker
await mcp.call('update_service_worker', { 
  scopeURL: 'https://example.com/' 
});
```

### Ejemplo 5: Interceptar y modificar requests
```typescript
// Activar interceptación para archivos JS y CSS
await mcp.call('enable_network_interception', {
  patterns: ['*.js', '*.css', '*analytics*']
});

// Listar requests interceptados
const intercepted = await mcp.call('list_intercepted_requests', {});
console.log('Intercepted:', intercepted.interceptedRequests);

// Bloquear un request de analytics
await mcp.call('fail_intercepted_request', {
  requestId: 'some-request-id',
  errorReason: 'BlockedByClient'
});

// Modificar headers de un request
await mcp.call('modify_intercepted_request', {
  requestId: 'another-request-id',
  modifiedHeaders: {
    'User-Agent': 'Custom Agent',
    'X-Custom-Header': 'Value'
  }
});

// Desactivar cuando termines
await mcp.call('disable_network_interception', {});
```

### Ejemplo 6: Obtener árbol de accesibilidad
```typescript
// Obtener snapshot estilo Playwright (fácil de leer)
const snapshot = await mcp.call('get_accessibility_snapshot', {
  interestingOnly: true  // Solo botones, links, inputs, etc.
});
console.log(snapshot.snapshot);

// Obtener árbol completo (más detallado)
const fullTree = await mcp.call('get_accessibility_tree', {
  depth: 5,  // Profundidad máxima
  includeIgnored: false
});
console.log(`Total nodes: ${fullTree.totalNodes}`);
```

### Ejemplo 7: Interceptar y modificar respuestas
```typescript
// Activar interceptación de RESPUESTAS (no solo requests)
// timeoutMs: La IA puede aumentarlo si espera muchas requests
await mcp.call('enable_response_interception', {
  patterns: ['*api.example.com/*'],
  resourceTypes: ['XHR', 'Fetch'],
  timeoutMs: 15000  // 15s para APIs lentas
});

// Esperar a que se intercepte una respuesta
const responses = await mcp.call('list_intercepted_responses', {});
console.log('Intercepted responses:', responses.interceptedResponses);

// Modificar el body de una respuesta JSON
await mcp.call('modify_intercepted_response', {
  requestId: 'response-id',
  modifiedBody: JSON.stringify({ modified: true, data: [1, 2, 3] }),
  modifiedStatusCode: 200,
  modifiedHeaders: {
    'Content-Type': 'application/json',
    'X-Modified': 'true'
  },
  timeoutMs: 20000  // 20s para respuestas grandes
});
```

### Ejemplo 8: Mock API endpoints
```typescript
// Crear un mock endpoint para API
// timeoutMs: Para endpoints complejos con lógica pesada
await mcp.call('create_mock_endpoint', {
  urlPattern: '*api.example.com/users*',
  responseBody: JSON.stringify([
    { id: 1, name: 'John Doe', email: 'john@example.com' },
    { id: 2, name: 'Jane Smith', email: 'jane@example.com' }
  ]),
  statusCode: 200,
  headers: {
    'Content-Type': 'application/json',
    'X-Mock': 'true'
  },
  latency: 500,  // Simular 500ms de latencia
  method: 'GET',
  timeoutMs: 12000  // 12s para registrar el mock
});

// Navegar y la API será interceptada automáticamente
await mcp.call('navigate', { url: 'https://example.com' });

// Ver estadísticas de mocks
const mocks = await mcp.call('list_mock_endpoints', {});
console.log('Active mocks:', mocks.mocks);

// Limpiar cuando termines
await mcp.call('clear_all_mocks', {});
```

### Ejemplo 9: WebSocket interception
```typescript
// Activar interceptación de WebSockets
await mcp.call('enable_websocket_interception', {
  urlPattern: 'wss://example.com/socket'
});

// Listar conexiones WebSocket activas
const connections = await mcp.call('list_websocket_connections', {});
console.log('Active WebSockets:', connections.connections);

// Ver mensajes enviados y recibidos
const messages = await mcp.call('list_websocket_messages', {
  direction: 'all',
  limit: 50
});
console.log('WS Messages:', messages.messages);

// Inyectar un mensaje falso
await mcp.call('send_websocket_message', {
  requestId: 'ws-connection-id',
  message: JSON.stringify({ type: 'ping', timestamp: Date.now() })
});
```

### Ejemplo 10: HAR recording
```typescript
// Iniciar grabación de tráfico de red en formato HAR
await mcp.call('start_har_recording', {});

// Navegar y realizar acciones
await mcp.call('navigate', { url: 'https://example.com' });
await mcp.call('click', { selector: 'button.load-data' });
await new Promise(resolve => setTimeout(resolve, 3000));

// Detener y obtener HAR data
const harData = await mcp.call('stop_har_recording', {});
console.log(`Captured ${harData.entriesCount} requests`);

// Exportar a archivo
// timeoutMs: Importante aumentarlo si el HAR es muy grande (>50MB)
await mcp.call('export_har_file', {
  filename: 'recording.har',
  outputDir: './recordings',
  timeoutMs: 90000  // 90s para exportar HARs muy grandes
});
```

### Ejemplo 11: Advanced request patterns
```typescript
// Crear patrón avanzado: bloquear imágenes grandes
await mcp.call('add_advanced_interception_pattern', {
  name: 'block-large-images',
  resourceType: 'Image',
  minSize: 500000,  // > 500KB
  action: 'block'
});

// Crear patrón: delay requests lentos
await mcp.call('add_advanced_interception_pattern', {
  name: 'delay-slow-apis',
  urlPattern: '*slow-api.com/*',
  statusCodeMin: 200,
  statusCodeMax: 299,
  action: 'delay',
  delayMs: 2000
});

// Patrón: log requests específicos
await mcp.call('add_advanced_interception_pattern', {
  name: 'log-analytics',
  urlPattern: '*analytics*',
  method: 'POST',
  action: 'log'
});
```

### Ejemplo 12: CSS/JS injection pipeline
```typescript
// Inyectar CSS globalmente (se aplica a TODAS las páginas)
// timeoutMs: Aumentar si el CSS es muy grande o complejo
await mcp.call('inject_css_global', {
  css: `
    body {
      background-color: #f0f0f0 !important;
    }
    .ad-banner {
      display: none !important;
    }
  `,
  name: 'dark-mode-and-no-ads',
  timeoutMs: 8000  // 8s para CSS pequeño
});

// Inyectar JavaScript que se ejecuta ANTES de cualquier script de la página
// timeoutMs: Critical para JS complejos con validación de sintaxis
await mcp.call('inject_js_global', {
  javascript: `
    // Interceptar fetch para logging
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
      console.log('Fetch intercepted:', args[0]);
      return originalFetch.apply(this, args);
    };
    
    // Agregar funciones helper globales
    window.myCustomHelper = function() {
      console.log('Helper function available globally!');
    };
  `,
  name: 'fetch-interceptor',
  runImmediately: true,
  timeoutMs: 18000  // 18s para JS complejo con validación
});

// Listar inyecciones activas
const injections = await mcp.call('list_injected_scripts', {});
console.log('Active injections:', injections.injections);

// Remover una inyección específica
await mcp.call('remove_injection', {
  identifier: 'injection-id-here'
});

// O limpiar todas
await mcp.call('clear_all_injections', {});
```
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
| Response Interception | ✅ | ❌ | ⚠️ |
| API Mocking | ✅ | ❌ | ⚠️ |
| WebSocket Interception | ✅ | ❌ | ❌ |
| HAR Recording | ✅ | ❌ | ⚠️ |
| CSS/JS Injection | ✅ | ❌ | ⚠️ |
| Delays human-like | ✅ | ❌ | ⚠️ |
| Multi-tab | ✅ | ✅ | ✅ |
| Screenshots | ✅ | ✅ | ✅ |
| Total herramientas | **84** | ~20 | ~30 |

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

## 📚 Documentación Adicional

- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** - Solución de problemas comunes
  - Herramientas no disponibles (click, type, etc.)
  - Congelamiento de páginas
  - Errores de conexión
  - Problemas con sitios protegidos
  
- **[NETWORK_FREEZE_FIX.md](NETWORK_FREEZE_FIX.md)** - Solución al problema de páginas que se quedan cargando indefinidamente al interceptar tráfico

- **[EXAMPLE_INTERCEPT_REPLICATE.md](EXAMPLE_INTERCEPT_REPLICATE.md)** - Ejemplo completo de cómo interceptar y replicar tráfico de red (caso de uso común)

- **[CONDITIONAL_DESCRIPTIONS.md](CONDITIONAL_DESCRIPTIONS.md)** - Descripciones condicionales de todas las herramientas para mejor selección por IA

- **[USAGE_GUIDE.md](USAGE_GUIDE.md)** - Guía de uso detallada

- **[TEST_WORKFLOW.md](TEST_WORKFLOW.md)** - Flujo de pruebas y validación

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

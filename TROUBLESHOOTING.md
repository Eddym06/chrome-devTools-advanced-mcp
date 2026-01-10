# 🔧 Troubleshooting Guide

## 🚨 Problema: "Las herramientas de click/type no están disponibles"

### Síntoma

GitHub Copilot reporta:
```
Las herramientas de clic, escritura y manipulación del DOM (click, type, wait_for_load_state) 
NO están habilitadas en tu configuración actual.
```

### Causa

El MCP server **SÍ incluye todas las herramientas**, pero la configuración de GitHub Copilot/MCP no las está exponiendo correctamente.

### ✅ Solución

#### Opción 1: Verificar configuración de GitHub Copilot (Recomendado)

1. **Abre la configuración de GitHub Copilot MCP:**
   - VS Code: `Settings` → `GitHub Copilot` → `MCP Servers`
   - O edita directamente: `~/.config/github-copilot/mcp-servers.json` (Linux/Mac) o `%APPDATA%\GitHub Copilot\mcp-servers.json` (Windows)

2. **Verifica que la configuración sea correcta:**

```json
{
  "mcpServers": {
    "custom-chrome-mcp": {
      "command": "node",
      "args": ["C:\\ruta\\a\\custom-chrome-mcp\\dist\\index.js"],
      "env": {},
      "disabled": false
    }
  }
}
```

3. **Reinicia VS Code** después de cambiar la configuración

#### Opción 2: Usar instalación npm global

```bash
# Instalar globalmente
npm install -g @eddym06/custom-chrome-mcp

# Configurar en GitHub Copilot
{
  "mcpServers": {
    "custom-chrome-mcp": {
      "command": "custom-chrome-mcp",
      "args": [],
      "disabled": false
    }
  }
}
```

#### Opción 3: Verificar que el servidor esté corriendo

```bash
# Desde el directorio del proyecto
npm run build
node dist/index.js --port=9222
```

Si ves errores, el servidor no se está iniciando correctamente.

### Verificación

Después de aplicar la solución, deberías ver **84 herramientas** disponibles, incluyendo:

**Interacción (8 herramientas):**
- ✅ `click`
- ✅ `type`
- ✅ `get_text`
- ✅ `get_attribute`
- ✅ `execute_script`
- ✅ `scroll`
- ✅ `wait_for_selector`
- ✅ `select_option`

Para verificar, pide a Copilot:
```
Lista todas las herramientas disponibles del MCP custom-chrome-mcp
```

---

## 🚨 Problema: "Google/Apple.com se queda cargando indefinidamente"

### Síntoma

Al activar intercepción de red y navegar a un sitio, la página se congela y nunca termina de cargar.

### Causa

Cuando habilitas `enable_network_interception` o `enable_response_interception`, **TODOS los requests/responses quedan pausados** esperando que los proceses manualmente.

### ✅ Solución Rápida

Usa el parámetro `autoContinue: true`:

```javascript
// ✅ Para logging/inspección SIN bloquear
await mcp.call('enable_network_interception', {
  patterns: ['*'],
  autoContinue: true  // 🎯 Continúa automáticamente
});
```

**Ver documentación completa:** [NETWORK_FREEZE_FIX.md](NETWORK_FREEZE_FIX.md)

---

## 🚨 Problema: "Connection refused" o "Cannot connect to Chrome"

### Síntoma

```
Error: Connection refused
Unable to connect to Chrome at localhost:9222
```

### Causa

Chrome no está ejecutándose con remote debugging habilitado.

### ✅ Solución

#### Windows:
```bash
# Cerrar Chrome completamente
taskkill /F /IM chrome.exe

# Iniciar con remote debugging
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\chrome-debug"
```

#### macOS:
```bash
# Cerrar Chrome
killall "Google Chrome"

# Iniciar con remote debugging
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug
```

#### Linux:
```bash
# Cerrar Chrome
pkill chrome

# Iniciar con remote debugging
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug
```

#### Verificar conexión:
```bash
# Debería mostrar JSON con información de Chrome
curl http://localhost:9222/json
```

---

## 🚨 Problema: "403 Forbidden" al intentar capturar tráfico de sitios protegidos

### Síntoma

Apple.com, Facebook, sitios bancarios bloquean la captura o navegación.

### Causa

Estos sitios detectan automatización y bloquean requests.

### ✅ Solución

Usa modo stealth **ANTES** de navegar:

```javascript
// 1. Activar stealth primero
await mcp.call('enable_stealth_mode', {});

// 2. Configurar user agent realista
await mcp.call('set_user_agent', {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0'
});

// 3. Ahora navegar
await mcp.call('navigate', {
  url: 'https://apple.com',
  timeout: 60000
});
```

---

## 🚨 Problema: "Request timeout" al interceptar tráfico

### Síntoma

```
Error: Operation timeout after 10000ms
```

### Causa

El timeout por defecto (10 segundos) es muy corto para sitios lentos o con mucho tráfico.

### ✅ Solución

Aumenta el timeout:

```javascript
await mcp.call('enable_response_interception', {
  patterns: ['*'],
  timeoutMs: 60000,  // 60 segundos
  autoContinue: true
});
```

---

## 🚨 Problema: "Mock endpoints no funcionan" o "Conflicto con intercepción"

### Síntoma

```
Error: Conflict detected: Response interception is already active
```

### Causa

No puedes usar `create_mock_endpoint` y `enable_response_interception` simultáneamente.

### ✅ Solución

**Escenario 1: Quieres interceptar y modificar**
```javascript
// Usa intercepción de respuestas
await mcp.call('enable_response_interception', {
  patterns: ['*api*'],
  autoContinue: false
});

// Modifica respuestas interceptadas
await mcp.call('modify_intercepted_response', {
  requestId: 'xxx',
  modifiedBody: '{"data": "modified"}'
});
```

**Escenario 2: Quieres mockear APIs sin servidor real**
```javascript
// Usa mocks (no necesitas servidor)
await mcp.call('create_mock_endpoint', {
  urlPattern: '*api/users*',
  responseBody: '{"users": []}',
  statusCode: 200
});
```

**Limpieza antes de cambiar de modo:**
```javascript
// Limpiar interceptación
await mcp.call('disable_response_interception', {});

// Limpiar mocks
await mcp.call('clear_all_mocks', {});
```

---

## 🚨 Problema: "`execute_script` retorna `[object Object]`"

### Síntoma

Al ejecutar JavaScript, el resultado es `[object Object]` en vez de datos útiles.

### Causa

Estás retornando objetos DOM no serializables.

### ✅ Solución

Serializa explícitamente:

```javascript
// ❌ MAL - Retorna DOM node
await mcp.call('execute_script', {
  script: 'return document.querySelector("button");'
});

// ✅ BIEN - Serializa propiedades
await mcp.call('execute_script', {
  script: `
    const btn = document.querySelector("button");
    return {
      tag: btn.tagName,
      text: btn.textContent,
      classes: Array.from(btn.classList)
    };
  `
});
```

---

## 🚨 Problema: "No se pueden interceptar WebSockets"

### Síntoma

Mensajes WebSocket no aparecen en `list_websocket_messages`.

### Causa

La intercepción de WebSockets debe habilitarse **ANTES** de que se establezca la conexión.

### ✅ Solución

```javascript
// 1. Habilitar ANTES de navegar
await mcp.call('enable_websocket_interception', {});

// 2. LUEGO navegar a la página con WebSockets
await mcp.call('navigate', {
  url: 'https://example.com/chat'
});

// 3. Esperar que se establezcan conexiones
await new Promise(r => setTimeout(r, 2000));

// 4. Ver conexiones
const { connections } = await mcp.call('list_websocket_connections', {});

// 5. Ver mensajes
const { messages } = await mcp.call('list_websocket_messages', {
  connectionId: connections[0].id
});
```

---

## 🚨 Problema: "HAR recording vacío"

### Síntoma

`stop_har_recording` retorna HAR con 0 entries.

### Causa

No se generó tráfico después de iniciar la grabación.

### ✅ Solución

```javascript
// 1. Iniciar grabación
await mcp.call('start_har_recording', {});

// 2. GENERAR TRÁFICO (navegación/clicks)
await mcp.call('navigate', { url: 'https://example.com' });
await mcp.call('click', { selector: 'button' });

// Esperar que termine el tráfico
await new Promise(r => setTimeout(r, 3000));

// 3. Detener grabación
const { entries } = await mcp.call('stop_har_recording', {});
console.log(`Capturados ${entries.length} requests`);
```

---

## 📞 Obtener Ayuda Adicional

Si ninguna solución funciona:

1. **Verifica la versión:**
   ```bash
   npm list @eddym06/custom-chrome-mcp
   # Debería ser >= 1.1.1
   ```

2. **Revisa logs del MCP:**
   - VS Code: `Output` → `GitHub Copilot MCP`
   - Terminal: Ver stderr del proceso node

3. **Prueba conexión manual:**
   ```bash
   node dist/index.js --port=9222
   # Debería conectarse sin errores
   ```

4. **Reporta el issue:**
   - GitHub: https://github.com/Eddym06/devTools-Advance-mcp/issues
   - Incluye: versión, sistema operativo, logs completos

---

## 📚 Ver También

- [NETWORK_FREEZE_FIX.md](NETWORK_FREEZE_FIX.md) - Solución al congelamiento de páginas
- [README.md](README.md) - Documentación completa
- [USAGE_GUIDE.md](USAGE_GUIDE.md) - Guía de uso detallada
- [CONDITIONAL_DESCRIPTIONS.md](CONDITIONAL_DESCRIPTIONS.md) - Descripciones de herramientas

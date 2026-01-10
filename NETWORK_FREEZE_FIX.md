# 🔧 Solución al problema: "Google se queda cargando indefinidamente"

## 🐛 Problema

Cuando se habilita la intercepción de red (`enable_network_interception` o `enable_response_interception`) y navegas a Google (o cualquier sitio), **la página se queda cargando indefinidamente**.

## ❓ Por qué ocurre

Cuando habilitas intercepción de red:

1. **Todos los requests/responses quedan PAUSADOS** esperando tu decisión
2. Debes llamar **manualmente** a `continue_intercepted_request`, `modify_intercepted_request` o `fail_intercepted_request` para CADA request interceptado
3. Si no procesas **todos** los requests, algunos quedan bloqueados esperando → **la página se congela**

### Ejemplo del problema:

```javascript
// ❌ ESTO CAUSA EL FREEZE
await mcp.call('enable_network_interception', { patterns: ['*'] });
await mcp.call('navigate', { url: 'https://google.com' });

// Google hace ~50 requests (HTML, CSS, JS, imágenes, analytics...)
// Todos quedan pausados esperando
// No llamas a continue_intercepted_request para cada uno
// → PÁGINA CONGELADA ❄️
```

## ✅ Solución

### **Opción 1: Auto-Continuación (recomendado para logging/inspección)**

Usa el nuevo parámetro `autoContinue: true` para **continuar automáticamente** todos los requests sin bloquear:

```javascript
// ✅ LOGGING SIN BLOQUEAR
await mcp.call('enable_network_interception', {
  patterns: ['*'],
  autoContinue: true  // 🎯 Auto-continúa todos los requests
});

await mcp.call('navigate', { url: 'https://google.com' });
// ✅ La página carga normalmente
// Los requests se capturan en el log interno pero no bloquean
```

**Cuándo usar `autoContinue: true`:**
- Quieres **inspeccionar/loggear** requests sin modificarlos
- Análisis de tráfico pasivo
- Debugging sin alterar comportamiento

### **Opción 2: Control Manual (para modificar requests)**

Si necesitas **modificar requests específicos**, usa `autoContinue: false` (default) pero **DEBES procesar TODOS** los requests:

```javascript
// ✅ CONTROL MANUAL CON PROCESAMIENTO COMPLETO
await mcp.call('enable_network_interception', {
  patterns: ['*'],
  autoContinue: false  // Control manual
});

await mcp.call('navigate', { url: 'https://google.com' });

// Obtener TODOS los requests interceptados
const { interceptedRequests } = await mcp.call('list_intercepted_requests', {});

// PROCESAR CADA UNO (esto es CRÍTICO)
for (const req of interceptedRequests) {
  if (req.url.includes('analytics')) {
    // Bloquear analytics
    await mcp.call('fail_intercepted_request', {
      requestId: req.requestId,
      errorReason: 'BlockedByClient'
    });
  } else {
    // Continuar el resto
    await mcp.call('continue_intercepted_request', {
      requestId: req.requestId
    });
  }
}
```

### **Opción 3: Patrones Específicos (recomendado para modificaciones selectivas)**

Intercepta **solo lo que necesitas** con patrones específicos:

```javascript
// ✅ INTERCEPTAR SOLO APIs
await mcp.call('enable_network_interception', {
  patterns: ['*api*', '*graphql*'],  // Solo APIs
  autoContinue: false
});

// Solo se pausan las APIs, el resto carga normal
await mcp.call('navigate', { url: 'https://google.com' });

// Ahora solo necesitas procesar los requests de API (muchos menos)
const { interceptedRequests } = await mcp.call('list_intercepted_requests', {});
// Procesar solo ~5 requests en vez de 50
```

## 📋 Comparación de Opciones

| Opción | `autoContinue` | Patrones | Uso | Ventajas | Desventajas |
|--------|----------------|----------|-----|----------|-------------|
| **Logging pasivo** | `true` | `['*']` | Inspección sin modificar | ✅ Nunca se congela<br>✅ Simple | ❌ No puedes modificar |
| **Control total** | `false` | `['*']` | Modificar todos los requests | ✅ Control completo | ❌ Debes procesar TODOS<br>❌ Complejo |
| **Selectivo** | `false` | Específicos | Modificar solo ciertos requests | ✅ Balance perfecto<br>✅ Solo procesas lo necesario | Requiere saber qué interceptar |

## 🎯 Recomendaciones

### Para inspección/debugging:
```javascript
await mcp.call('enable_response_interception', {
  patterns: ['*'],
  autoContinue: true
});
```

### Para modificar APIs específicas:
```javascript
await mcp.call('enable_request_interception', {
  patterns: ['*api*', '*/graphql', '*rest*'],
  autoContinue: false
});
// Procesar solo los requests que matchean
```

### Para bloquear analytics/trackers:
```javascript
await mcp.call('enable_request_interception', {
  patterns: ['*google-analytics*', '*facebook*', '*doubleclick*'],
  autoContinue: false
});
// Bloquear todos con fail_intercepted_request
```

## 🚨 Errores Comunes

### ❌ Error 1: Olvidar procesar requests
```javascript
// MAL
await mcp.call('enable_network_interception', { patterns: ['*'] });
await mcp.call('list_intercepted_requests', {});
// ❌ No llamaste a continue/modify/fail → CONGELADO
```

### ❌ Error 2: Procesar solo algunos
```javascript
// MAL
const { interceptedRequests } = await mcp.call('list_intercepted_requests', {});
// Procesar solo el primero
await mcp.call('continue_intercepted_request', {
  requestId: interceptedRequests[0].requestId
});
// ❌ Los otros 49 requests siguen pausados → CONGELADO
```

### ✅ Correcto:
```javascript
// BIEN - Opción 1: Auto-continuar
await mcp.call('enable_network_interception', {
  patterns: ['*'],
  autoContinue: true
});

// BIEN - Opción 2: Procesar TODOS
const { interceptedRequests } = await mcp.call('list_intercepted_requests', {});
for (const req of interceptedRequests) {
  await mcp.call('continue_intercepted_request', { requestId: req.requestId });
}

// BIEN - Opción 3: Interceptar menos
await mcp.call('enable_network_interception', {
  patterns: ['*api*']  // Solo APIs, no todo
});
```

## 🔧 Cambios Implementados (v1.1.1)

### `enable_network_interception`
- ✅ Nuevo parámetro: `autoContinue: boolean` (default: `false`)
- ✅ Warning visible cuando `autoContinue: false`
- ✅ Auto-continuación automática de requests cuando `autoContinue: true`

### `enable_response_interception`
- ✅ Nuevo parámetro: `autoContinue: boolean` (default: `false`)
- ✅ Warning visible cuando `autoContinue: false`
- ✅ Auto-continuación automática de responses cuando `autoContinue: true`

## 📚 Referencias

- **Herramientas afectadas:**
  - `enable_network_interception` (requests)
  - `enable_response_interception` (responses)
  
- **Herramientas de procesamiento:**
  - `list_intercepted_requests` / `list_intercepted_responses`
  - `continue_intercepted_request` / `modify_intercepted_response`
  - `modify_intercepted_request` / `fail_intercepted_request`
  - `fail_intercepted_request`

- **Alternativas sin intercepción:**
  - `start_har_recording` → captura sin pausar
  - `monitor_network_pattern` → logging avanzado sin bloquear

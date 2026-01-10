# 📝 Ejemplo Completo: Interceptar y Replicar Tráfico de Red

## 🎯 Caso de Uso

**Objetivo:** Navegar a un sitio, hacer clic en un botón, interceptar el tráfico de red que genera, y luego replicar ese tráfico en otra página.

## ⚠️ Problema Común

Si GitHub Copilot dice "las herramientas de click/type no están disponibles", revisa [TROUBLESHOOTING.md](TROUBLESHOOTING.md#-problema-las-herramientas-de-clicktype-no-están-disponibles).

## ✅ Flujo Correcto

### Paso 1: Preparar el Entorno

```javascript
// 1.1. Activar modo stealth (opcional pero recomendado)
const stealth = await mcp.call('enable_stealth_mode', {});
console.log('Stealth activado:', stealth);

// 1.2. Verificar que Chrome esté conectado
const tabs = await mcp.call('list_tabs', {});
console.log(`Chrome conectado: ${tabs.tabs.length} tabs`);
```

### Paso 2: Habilitar Intercepción ANTES de Navegar

```javascript
// 2.1. Activar intercepción de respuestas con auto-continue
// IMPORTANTE: autoContinue=true para que no se congele la página
const interception = await mcp.call('enable_response_interception', {
  patterns: ['*'],  // Interceptar todo
  autoContinue: true,  // 🎯 NO BLOQUEAR - continuar automáticamente
  timeoutMs: 30000  // 30 segundos de timeout
});

console.log('Intercepción habilitada:', interception);

// 2.2. También activar intercepción de requests si quieres modificarlos
const reqInterception = await mcp.call('enable_network_interception', {
  patterns: ['*api*', '*graphql*'],  // Solo APIs para no capturar todo
  autoContinue: true
});
```

### Paso 3: Navegar al Sitio

```javascript
// 3.1. Navegar (evita sitios que bloquean bots como apple.com)
const nav = await mcp.call('navigate', {
  url: 'https://httpbin.org',  // Sitio amigable para testing
  waitUntil: 'networkidle',  // Esperar que termine el tráfico
  timeout: 60000
});

console.log('Navegación completa:', nav);

// 3.2. Verificar que la página cargó
const url = await mcp.call('get_url', {});
console.log('URL actual:', url);
```

### Paso 4: Obtener HTML y Localizar Botón

```javascript
// 4.1. Obtener HTML de la página
const html = await mcp.call('get_html', {});
console.log('HTML recibido:', html.html.substring(0, 500));

// 4.2. Ejecutar JS para encontrar botones
const buttons = await mcp.call('execute_script', {
  script: `
    const btns = Array.from(document.querySelectorAll('button, a[href]'));
    return btns.slice(0, 5).map(btn => ({
      tag: btn.tagName,
      text: btn.textContent.trim(),
      selector: btn.id ? '#' + btn.id : btn.className ? '.' + btn.className.split(' ')[0] : btn.tagName
    }));
  `,
  timeoutMs: 5000
});

console.log('Botones encontrados:', buttons);
```

### Paso 5: Hacer Click e Interceptar Tráfico

```javascript
// 5.1. Limpiar respuestas interceptadas anteriores (opcional)
await mcp.call('disable_response_interception', {});
await mcp.call('enable_response_interception', {
  patterns: ['*'],
  autoContinue: false  // 🎯 AHORA NO auto-continuar para capturar
});

// 5.2. Hacer click en el botón
// Usa el selector que encontraste en el paso anterior
const click = await mcp.call('click', {
  selector: 'a[href="/get"]',  // Ejemplo
  timeout: 30000,
  waitForSelector: true
});

console.log('Click realizado:', click);

// 5.3. Esperar que se genere tráfico
await new Promise(r => setTimeout(r, 2000));

// 5.4. Obtener respuestas interceptadas
const intercepted = await mcp.call('list_intercepted_responses', {});
console.log(`Capturadas ${intercepted.count} respuestas`);
console.log('Respuestas:', intercepted.interceptedResponses);
```

### Paso 6: Analizar el Tráfico Capturado

```javascript
// 6.1. Filtrar respuestas relevantes (APIs, JSON, etc.)
const apiResponses = intercepted.interceptedResponses.filter(resp => 
  resp.url.includes('api') || 
  resp.responseHeaders.some(h => h.name === 'content-type' && h.value.includes('json'))
);

console.log(`Respuestas de API: ${apiResponses.length}`);

// 6.2. Guardar la primera respuesta para replicar
const targetResponse = apiResponses[0] || intercepted.interceptedResponses[0];

if (!targetResponse) {
  console.error('No se capturó ninguna respuesta');
  return;
}

console.log('Respuesta objetivo:', {
  url: targetResponse.url,
  method: targetResponse.method,
  status: targetResponse.responseStatusCode
});

// 6.3. IMPORTANTE: Continuar las respuestas para que no se congele
for (const resp of intercepted.interceptedResponses) {
  await mcp.call('modify_intercepted_response', {
    requestId: resp.requestId
    // Sin modificaciones = continuar con la respuesta original
  });
}
```

### Paso 7: Volver a la Página Inicial

```javascript
// 7.1. Navegar de regreso
const backNav = await mcp.call('go_back', {
  timeout: 30000
});

// O navegar a una URL específica
const homeNav = await mcp.call('navigate', {
  url: 'https://httpbin.org',
  timeout: 30000
});

console.log('Regresado a página inicial');
```

### Paso 8: Crear Mock con los Datos Capturados

```javascript
// 8.1. Deshabilitar intercepción primero
await mcp.call('disable_response_interception', {});

// 8.2. Extraer datos de la respuesta capturada
// Nota: El cuerpo de la respuesta está en targetResponse, pero necesitas
// hacer otro request para obtenerlo completo

// 8.3. Crear mock endpoint con los datos
const mock = await mcp.call('create_mock_endpoint', {
  urlPattern: targetResponse.url.split('?')[0],  // URL sin query params
  responseBody: '{"mocked": true, "message": "Respuesta replicada"}',
  statusCode: targetResponse.responseStatusCode || 200,
  headers: {
    'content-type': 'application/json',
    'x-mocked': 'true'
  },
  latency: 100,  // Simular latencia de red
  method: targetResponse.method || 'GET'
});

console.log('Mock creado:', mock);
```

### Paso 9: Verificar que el Mock Funciona

```javascript
// 9.1. Hacer la misma acción que antes (click)
await mcp.call('click', {
  selector: 'a[href="/get"]',
  timeout: 30000
});

// 9.2. El tráfico ahora irá al mock, no al servidor real
await new Promise(r => setTimeout(r, 2000));

// 9.3. Verificar que el mock se llamó
const mocks = await mcp.call('list_mock_endpoints', {});
console.log('Mocks activos:', mocks.mocks);
console.log('El mock fue llamado:', mocks.mocks[0].callCount, 'veces');

// 9.4. Obtener HTML para verificar que el mock funcionó
const newHtml = await mcp.call('get_html', {});
console.log('Página actualizada con mock');
```

### Paso 10: Limpieza

```javascript
// 10.1. Limpiar mocks
await mcp.call('clear_all_mocks', {});

// 10.2. Deshabilitar interceptaciones
await mcp.call('disable_network_interception', {});
await mcp.call('disable_response_interception', {});

console.log('Limpieza completa');
```

## 🎯 Flujo Alternativo: Usando HAR Recording

Si solo necesitas capturar el tráfico sin modificarlo en tiempo real:

```javascript
// 1. Iniciar grabación HAR
await mcp.call('start_har_recording', {});

// 2. Navegar y hacer clicks
await mcp.call('navigate', { url: 'https://httpbin.org' });
await mcp.call('click', { selector: 'a[href="/get"]' });

// 3. Esperar que termine el tráfico
await new Promise(r => setTimeout(r, 3000));

// 4. Detener y obtener HAR
const har = await mcp.call('stop_har_recording', {});
console.log(`Capturados ${har.entries.length} requests en HAR`);

// 5. Exportar a archivo
await mcp.call('export_har_file', {
  filename: 'captured-traffic.har',
  outputDir: './recordings'
});

console.log('HAR exportado: ./recordings/captured-traffic.har');
```

## 🔧 Troubleshooting

### Error: "click tool not available"
**Solución:** Ver [TROUBLESHOOTING.md - Herramientas no disponibles](TROUBLESHOOTING.md#-problema-las-herramientas-de-clicktype-no-están-disponibles)

### Error: "Page freezes after enable_response_interception"
**Solución:** Usa `autoContinue: true` o procesa TODOS los requests interceptados
Ver [NETWORK_FREEZE_FIX.md](NETWORK_FREEZE_FIX.md)

### Error: "Cannot find selector"
**Solución:** 
```javascript
// Usa execute_script para encontrar selectores
const selectors = await mcp.call('execute_script', {
  script: `
    return Array.from(document.querySelectorAll('button, a'))
      .slice(0, 10)
      .map((el, i) => ({
        index: i,
        tag: el.tagName,
        text: el.textContent.trim().substring(0, 50),
        id: el.id,
        classes: el.className
      }));
  `
});
console.log(selectors);
```

### Error: "Connection refused"
**Solución:** Inicia Chrome con remote debugging:
```bash
# Windows
chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\chrome-debug

# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug
```

## 📚 Ver También

- [NETWORK_FREEZE_FIX.md](NETWORK_FREEZE_FIX.md) - Solución al congelamiento de páginas
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Guía de resolución de problemas
- [README.md](README.md) - Documentación completa
- [USAGE_GUIDE.md](USAGE_GUIDE.md) - Guía de uso general

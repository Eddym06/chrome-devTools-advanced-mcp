# 🚀 Guía de Instalación Rápida

## Paso 1: Instalar Dependencias

```bash
cd custom-chrome-mcp
npm install
```

## Paso 2: Compilar el Proyecto

```bash
npm run build
```

## Paso 3: Lanzar Chrome con Debugging

### Windows (PowerShell)
```powershell
start chrome --remote-debugging-port=9222
```

### Windows (CMD)
```cmd
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

### macOS
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 &
```

### Linux
```bash
google-chrome --remote-debugging-port=9222 &
```

## Paso 4: Configurar en VS Code / Cline

Edita tu archivo de configuración MCP (usualmente en `.vscode/mcp.json` o en la configuración de Cline):

### Opción A: Desarrollo Local
```json
{
  "mcpServers": {
    "custom-chrome-mcp": {
      "command": "node",
      "args": ["C:/Users/eddym/Downloads/devTools-Advance/custom-chrome-mcp/dist/index.js"],
      "env": {}
    }
  }
}
```

### Opción B: Después de publicar en npm
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

## Paso 5: Probar la Conexión

Una vez configurado, puedes probarlo desde VS Code / Cline:

```
User: Lista las pestañas abiertas en Chrome

AI: [Usará la herramienta list_tabs]
```

## Verificar que todo funciona

1. **Verificar puerto abierto:**
```powershell
netstat -an | findstr 9222
```

Deberías ver algo como:
```
TCP    127.0.0.1:9222         0.0.0.0:0              LISTENING
```

2. **Probar en el navegador:**
Abre: http://localhost:9222/json

Deberías ver un JSON con las pestañas abiertas.

3. **Probar el MCP:**
```bash
npm start
```

Deberías ver:
```
🚀 Custom Chrome MCP Server starting...
📡 Connecting to Chrome on port 9222
✅ Connected to Chrome/131.0.0.0 (...)
📑 Found X open tab(s)
🔧 Tools available: 44
✨ Server ready! Waiting for requests...
```

## Solución de Problemas

### Error: "Failed to connect to Chrome"
- Verifica que Chrome esté corriendo con `--remote-debugging-port=9222`
- Verifica que el puerto 9222 esté libre
- Cierra otras instancias de Chrome y vuelve a lanzar con el flag

### Error: "Cannot find module"
- Ejecuta `npm install` de nuevo
- Ejecuta `npm run build` para compilar

### Chrome se cierra al iniciar con el flag
- No uses perfiles con extensiones que bloqueen debugging
- Usa un perfil limpio: `--user-data-dir="C:\ChromeDebug"`

```powershell
start chrome --remote-debugging-port=9222 --user-data-dir="C:\ChromeDebug"
```

## Próximos Pasos

- Lee el [README.md](README.md) completo para ver todas las herramientas disponibles
- Prueba el modo stealth: `enable_stealth_mode`
- Exporta/importa sesiones para reutilizar logins
- Gestiona Service Workers

## Publicar en npm (para el autor)

```bash
# Actualizar versión
npm version patch  # o minor, o major

# Publicar
npm publish

# Ahora otros usuarios pueden instalar con:
npm install -g custom-chrome-mcp
```

¡Listo! Ya tienes tu MCP personalizado funcionando 🎉

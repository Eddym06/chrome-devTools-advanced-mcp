
import { ChromeConnector } from './src/chrome-connector.js';
import { createAdvancedNetworkTools } from './src/tools/advanced-network.js';
import { createPlaywrightLauncherTools } from './src/tools/playwright-launcher.js';
import { createNavigationTools } from './src/tools/navigation.js';

async function runDemo() {
  console.log('🚀 Iniciando Demo de Herramientas Avanzadas...');
  
  // 1. Inicializar Connector
  const connector = new ChromeConnector(9222);
  
  // 2. Obtener manejadores de herramientas
  const launcherTools = createPlaywrightLauncherTools(connector);
  const networkTools = createAdvancedNetworkTools(connector);
  const navTools = createNavigationTools(connector);

  const getHandler = (tools: any[], name: string) => tools.find(t => t.name === name)?.handler;

  try {
    // 3. Lanzar Chrome
    console.log('\n🌐 Lanzando Chrome...');
    const launchHandler = getHandler(launcherTools, 'launch_chrome_with_profile');
    if (launchHandler) {
      await launchHandler({ profileDirectory: 'Default' });
      console.log('✅ Chrome lanzado correctamente');
    } else {
        // Si falla el launch (quizas ya esta abierto), intentamos conectar
        console.log('⚠️ No se pudo lanzar (quizás ya abierto), intentando conectar...');
    }

    // Esperar un momento para la conexión
    await new Promise(r => setTimeout(r, 3000));

    // 4. Configurar Mock de API
    console.log('\n📦 Configurando Mock de API...');
    const createMock = getHandler(networkTools, 'create_mock_endpoint');
    await createMock({
      urlPattern: '*api.example.com/users*',
      responseBody: JSON.stringify([{ id: 1, name: 'Usuario Demo', role: 'Tester' }]),
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      latency: 1000,
      timeoutMs: 10000
    });
    console.log('✅ Mock registrado para *api.example.com/users*');

    // 5. Inyectar CSS Global
    console.log('\n🎨 Inyectando CSS Global...');
    const injectCss = getHandler(networkTools, 'inject_css_global');
    await injectCss({
      css: 'body { background-color: #f0f8ff !important; border: 5px solid red !important; }',
      name: 'demo-theme',
      timeoutMs: 5000
    });
    console.log('✅ CSS inyectado (Fondo azul claro, borde rojo)');

    // 6. Iniciar Grabación HAR
    console.log('\n📹 Iniciando grabación HAR...');
    const startHar = getHandler(networkTools, 'start_har_recording');
    await startHar({});
    console.log('✅ Grabación HAR iniciada');

    // 7. Navegar a una página para probar
    console.log('\nse Navegando a example.com...');
    const navigate = getHandler(navTools, 'navigate');
    await navigate({ url: 'https://example.com' });
    console.log('✅ Navegación completada');

    // 8. Simular "fetch" en la consola para probar el Mock
    console.log('\n🧪 Probando Mock (Simulando fetch)...');
    // Esto es un truco: inyectamos JS que hace un fetch
    const injectJs = getHandler(networkTools, 'inject_js_global');
    await injectJs({
      javascript: `
        setTimeout(() => {
            console.log("Haciendo fetch a api.example.com...");
            fetch("https://api.example.com/users")
                .then(r => r.json())
                .then(d => {
                    console.log("Respuesta Mock recibida:", d);
                    const div = document.createElement("div");
                    div.style = "position: fixed; top: 10px; right: 10px; background: gold; padding: 20px; z-index: 9999;";
                    div.innerText = "MOCK DATA: " + JSON.stringify(d);
                    document.body.appendChild(div);
                });
        }, 1000);
      `,
      name: 'mock-test',
      runImmediately: true
    });
    console.log('✅ JS para probar Mock inyectado');

    // Esperar para que ocurra el tráfico
    console.log('⏳ Esperando 5 segundos para capturar tráfico...');
    await new Promise(r => setTimeout(r, 5000));

    // 9. Exportar HAR
    console.log('\n💾 Exportando archivo HAR...');
    const exportHar = getHandler(networkTools, 'export_har_file');
    const harResult = await exportHar({
      filename: 'demo_recording.har',
      outputDir: './recordings',
      timeoutMs: 30000
    });
    console.log(`✅ HAR exportado: ${JSON.stringify(harResult)}`);

    console.log('\n🎉 DEMO COMPLETADA EXITOSAMENTE');

  } catch (error) {
    console.error('❌ Error durante la demo:', error);
  }
}

runDemo();

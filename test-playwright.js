/**
 * Test script for Playwright integration
 * Run: node test-playwright.js
 */

import { ChromeConnector } from './dist/chrome-connector.js';

async function test() {
  console.log('🧪 Testing Playwright integration...\n');
  
  const connector = new ChromeConnector(9222);
  
  try {
    console.log('1️⃣ Testing launchWithProfile...');
    await connector.launchWithProfile({
      headless: false,
      profileDirectory: 'Default'
    });
    
    console.log('✅ Chrome launched successfully!\n');
    
    console.log('2️⃣ Testing connection status...');
    console.log('   Connected:', connector.isConnected());
    console.log('   Playwright managed:', connector.isPlaywrightManaged());
    console.log('   Port:', connector.getPort());
    
    console.log('\n3️⃣ Testing CDP commands...');
    const tabs = await connector.listTabs();
    console.log(`   Found ${tabs.length} tabs`);
    tabs.slice(0, 3).forEach(tab => {
      console.log(`   - ${tab.title.substring(0, 50)}...`);
    });
    
    console.log('\n4️⃣ Testing target detection...');
    const client = connector.getConnection().client;
    const { targetInfos } = await client.send('Target.getTargets');
    const serviceWorkers = targetInfos.filter(t => t.type === 'service_worker');
    console.log(`   Found ${serviceWorkers.length} service workers`);
    serviceWorkers.slice(0, 5).forEach(sw => {
      console.log(`   - ${sw.title || sw.url}`);
    });
    
    console.log('\n✅ All tests passed!');
    console.log('✅ Chrome is running with your profile (cookies, sessions, extensions)');
    console.log('✅ CDP connection is working');
    console.log('\n⏳ Browser will stay open for manual inspection. Press Ctrl+C to close...');
    
    // Keep process alive
    await new Promise(() => {});
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

test();

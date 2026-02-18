#!/usr/bin/env node

/**
 * Test MCP Server Initialization
 * Simulates VS Code MCP client behavior to detect if Chrome auto-launches
 */

import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

console.log('🧪 Starting MCP Server Test...\n');

// Spawn the MCP server
const serverProcess = spawn('node', [
  'dist/index.js',
  '--port=9222'
], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe']
});

let messageId = 0;

// Send JSON-RPC message
function sendMessage(method, params = {}) {
  const msg = {
    jsonrpc: '2.0',
    id: ++messageId,
    method,
    params
  };
  const json = JSON.stringify(msg) + '\n';
  console.log(`📤 Sending: ${method}`);
  serverProcess.stdin.write(json);
}

// Handle server stdout (responses)
serverProcess.stdout.on('data', (data) => {
  const lines = data.toString().trim().split('\n');
  lines.forEach(line => {
    try {
      const response = JSON.parse(line);
      console.log(`📥 Response for ${response.id}:`, response.result?.serverInfo?.name || 'OK');
    } catch (e) {
      if (line.trim()) {
        console.log(`📥 Non-JSON output: ${line}`);
      }
    }
  });
});

// Handle server stderr (logs)
let chromeDetected = false;
serverProcess.stderr.on('data', (data) => {
  const text = data.toString();
  console.log(`📋 [SERVER LOG] ${text.trim()}`);
  
  // Detect Chrome launch
  if (text.includes('[ensureConnected]') || text.includes('[launchWithProfile]')) {
    chromeDetected = true;
    console.log('\n⚠️  🔴 CHROME LAUNCH DETECTED! 🔴\n');
  }
});

// Handle process exit
serverProcess.on('close', (code) => {
  console.log(`\n🏁 Server process exited with code ${code}`);
  
  if (!chromeDetected) {
    console.log('✅ SUCCESS: Chrome was NOT launched during initialization');
  } else {
    console.log('❌ FAILURE: Chrome WAS launched during initialization');
  }
  
  process.exit(code || 0);
});

// Simulate VS Code MCP client behavior
async function runTest() {
  try {
    // Wait for server to start
    await sleep(1000);
    console.log('\n1️⃣  Initializing MCP connection...');
    sendMessage('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'test-client',
        version: '1.0.0'
      }
    });
    
    await sleep(500);
    
    console.log('\n2️⃣  Requesting tools list...');
    sendMessage('tools/list');
    
    await sleep(500);
    
    console.log('\n3️⃣  Sending initialized notification...');
    serverProcess.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {}
    }) + '\n');
    
    // Wait to see if Chrome launches
    console.log('\n⏳ Waiting 5 seconds to detect Chrome launch...\n');
    await sleep(5000);
    
    // Graceful shutdown
    console.log('🛑 Shutting down server...');
    serverProcess.kill('SIGTERM');
    
    await sleep(1000);
    
  } catch (error) {
    console.error('❌ Test error:', error);
    serverProcess.kill();
    process.exit(1);
  }
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n👋 Test interrupted by user');
  serverProcess.kill();
  process.exit(0);
});

// Run the test
runTest();

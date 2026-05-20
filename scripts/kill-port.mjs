import { execSync } from 'child_process';
import { platform } from 'os';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

let port = 3000;
try {
  const yaml = readFileSync(resolve(root, 'config.yaml'), 'utf-8');
  const m = yaml.match(/port:\s*(\d+)/);
  if (m) port = parseInt(m[1]);
} catch {}

const targetPort = process.argv[2] ? parseInt(process.argv[2]) : port;

function killWin(port) {
  try {
    const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = output.split('\n').filter(l => l.includes('LISTENING'));
    const pids = new Set();
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && pid !== '0') pids.add(pid);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        console.log(`  Killed PID ${pid} on port ${port}`);
      } catch {}
    }
    if (pids.size === 0) console.log(`  No process found on port ${port}`);
  } catch {
    console.log(`  No process found on port ${port}`);
  }
}

function killUnix(port) {
  try {
    const output = execSync(`lsof -ti:${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (output) {
      const pids = output.split('\n');
      for (const pid of pids) {
        try {
          execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
          console.log(`  Killed PID ${pid} on port ${port}`);
        } catch {}
      }
    } else {
      console.log(`  No process found on port ${port}`);
    }
  } catch {
    console.log(`  No process found on port ${port}`);
  }
}

console.log(`\n  Checking port ${targetPort}...`);
if (platform() === 'win32') killWin(targetPort);
else killUnix(targetPort);

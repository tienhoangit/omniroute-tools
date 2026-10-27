const fs = require('fs');
const os = require('os');
const path = require('path');

const file = path.join(os.homedir(), '.codex', 'config.toml');
const content = fs.readFileSync(file, 'utf8');
const lines = content.split('\n');

console.log('=== FIRST 15 LINES ===');
console.log(lines.slice(0, 15).join('\n'));

console.log('=== PROVIDER LINES ===');
lines.forEach((l, i) => {
  if (/model_provider/i.test(l)) {
    console.log(`${i}: ${l}`);
  }
});

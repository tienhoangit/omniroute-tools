const fs = require('fs');
const path = require('path');
const r = 'C:/Users/Hoang Minh Tien/AppData/Roaming/npm/node_modules/9router/';
const page = fs.readFileSync(path.join(r, 'app/.next-cli-build/server/app/(dashboard)/dashboard/cli-tools/[toolId]/page.js'), 'utf8');

const regex = /"\/api\/[^"]+"/g;
const matches = page.match(regex) || [];
console.log('Endpoints in [toolId]/page.js:');
console.log([...new Set(matches)]);

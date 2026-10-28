// Runs the compiled tests. The app's package.json says "type": "module", but tsc emits
// CommonJS here, so the build folder is marked as CommonJS first.
const fs = require('fs');
const path = require('path');
const build = path.resolve('.test-build');
fs.writeFileSync(path.join(build, 'package.json'), '{"type":"commonjs"}\n');
const dir = path.join(build, 'tests');
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort()) require(path.join(dir, f));

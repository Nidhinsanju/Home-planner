// Runs the compiled generator. The app's package.json says "type": "module", but tsc emits
// CommonJS here, so the build folder is marked as CommonJS first.
const fs = require('fs');
const path = require('path');
const build = path.resolve('.training-build');
fs.writeFileSync(path.join(build, 'package.json'), '{"type":"commonjs"}\n');
require(path.join(build, 'scripts/training-data/generate.js'));

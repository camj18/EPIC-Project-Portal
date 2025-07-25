const fs = require('fs');
const path = require('path');

// Ensure the build directory exists
const buildDir = path.join(__dirname, 'build');
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

// Copy index.html to the build directory
const indexSrc = path.join(__dirname, 'index.html');
const indexDest = path.join(buildDir, 'index.html');
fs.copyFileSync(indexSrc, indexDest);
console.log('Client build complete.');

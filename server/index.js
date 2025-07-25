const http = require('http');
const fs = require('fs');
const path = require('path');

// Define the port. Fall back to 3001 if no environment variable is set.
const PORT = process.env.PORT || 3001;

/**
 * Determine a MIME type based on file extension.
 * This simple mapping covers the asset types used in this project.
 * @param {string} ext File extension (without leading dot)
 * @returns {string} A valid HTTP Content‑Type header value
 */
function getMimeType(ext) {
  const types = {
    html: 'text/html',
    js: 'text/javascript',
    css: 'text/css',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    svg: 'image/svg+xml',
    ico: 'image/x-icon'
  };
  return types[ext.toLowerCase()] || 'application/octet-stream';
}

/**
 * Resolve the path to a static file. The server first looks for
 * prebuilt assets in the `client/build` directory. If no build directory
 * exists (e.g. during initial scaffolding), it falls back to serving
 * the raw `client/index.html` file for all non‑API requests. This
 * allows developers to see a “Hello, EPIC Hub!” page without a full
 * React toolchain.
 * @param {string} url The URL path from the incoming request
 * @returns {string} Absolute path on disk to the file to serve
 */
function resolveStaticPath(url) {
  const clientDir = path.join(__dirname, '..', 'client');
  const buildDir = path.join(clientDir, 'build');
  const buildExists = fs.existsSync(buildDir);

  // Determine file name: if requesting the root, serve index.html
  const requestedPath = url === '/' ? 'index.html' : url.replace(/^\//, '');
  // First look in build folder if it exists
  if (buildExists) {
    const fileInBuild = path.join(buildDir, requestedPath);
    if (fs.existsSync(fileInBuild) && fs.statSync(fileInBuild).isFile()) {
      return fileInBuild;
    }
  }
  // Fallback to the raw client directory
  const fallbackFile = path.join(clientDir, requestedPath);
  if (fs.existsSync(fallbackFile) && fs.statSync(fallbackFile).isFile()) {
    return fallbackFile;
  }
  // Default to the main HTML file
  return path.join(clientDir, 'index.html');
}

// Create the HTTP server. It serves the health endpoint and static assets.
const server = http.createServer((req, res) => {
  // Normalize the URL to avoid directory traversal
  const url = new URL(req.url, `http://${req.headers.host}`).pathname;
  // Simple API endpoint for health check
  if (url === '/health') {
    const body = JSON.stringify({ status: 'OK' });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
    return;
  }

  // Serve static files for all other GET requests
  if (req.method === 'GET') {
    const filePath = resolveStaticPath(url);
    fs.readFile(filePath, (err, content) => {
      if (err) {
        // Unexpected error reading file
        res.writeHead(500);
        res.end('Internal Server Error');
        return;
      }
      const ext = path.extname(filePath).slice(1);
      res.writeHead(200, { 'Content-Type': getMimeType(ext) });
      res.end(content);
    });
    return;
  }

  // All other methods are not supported in this initial scaffold
  res.writeHead(405);
  res.end('Method Not Allowed');
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

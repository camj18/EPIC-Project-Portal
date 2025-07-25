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

// -----------------------------------------------------------------------------
// Simple in‑memory data store for projects and files. In a real application
// these would reside in a database (e.g. PostgreSQL) and file uploads would
// be stored in S3. For this scaffold we keep everything in memory and on
// local disk to allow the API to be exercised without external services.
const projects = [];
const filesData = [];
let nextProjectId = 1;
let nextFileId = 1;

// Ensure an uploads directory exists for storing file blobs.
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

/**
 * Helper to parse JSON bodies. Accumulates incoming data and attempts
 * to JSON.parse it. If parsing fails, it returns null.
 * @param {http.IncomingMessage} req Incoming request
 * @returns {Promise<null|any>} Parsed JSON object or null on error
 */
function parseJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const json = JSON.parse(body || '{}');
        resolve(json);
      } catch (err) {
        resolve(null);
      }
    });
  });
}

/**
 * API handler. Receives the HTTP method and URL path and dispatches to
 * appropriate controller logic. All JSON responses include CORS headers
 * for ease of development. In production these should be restricted.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} pathname
 */
async function handleApi(req, res, pathname) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // /api/health – mirror /health but under /api
  if (pathname === '/api/health' && req.method === 'GET') {
    const body = JSON.stringify({ status: 'OK' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
    return;
  }

  // GET /api/projects – list all projects
  if (pathname === '/api/projects' && req.method === 'GET') {
    const body = JSON.stringify(projects);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
    return;
  }

  // POST /api/projects – create a new project { name }
  if (pathname === '/api/projects' && req.method === 'POST') {
    const data = await parseJsonBody(req);
    if (!data || typeof data.name !== 'string' || !data.name.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid project data' }));
      return;
    }
    const project = { id: nextProjectId++, name: data.name.trim(), owner_id: null, created_at: new Date().toISOString() };
    projects.push(project);
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(project));
    return;
  }

  // Regex helpers for project and file routes
  const projectFilesMatch = pathname.match(/^\/api\/projects\/(\d+)\/files$/);
  const fileMatch = pathname.match(/^\/api\/files\/(\d+)$/);

  // GET /api/projects/:id/files – list files for a project
  if (projectFilesMatch && req.method === 'GET') {
    const projectId = parseInt(projectFilesMatch[1], 10);
    const project = projects.find((p) => p.id === projectId);
    if (!project) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Project not found' }));
      return;
    }
    const projectFiles = filesData.filter((f) => f.project_id === projectId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(projectFiles));
    return;
  }

  // POST /api/projects/:id/files – upload a file (base64 encoded)
  if (projectFilesMatch && req.method === 'POST') {
    const projectId = parseInt(projectFilesMatch[1], 10);
    const project = projects.find((p) => p.id === projectId);
    if (!project) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Project not found' }));
      return;
    }
    const data = await parseJsonBody(req);
    if (!data || typeof data.filename !== 'string' || typeof data.fileType !== 'string' || typeof data.base64 !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid file data' }));
      return;
    }
    // Determine version: increment count for this filename on this project
    const existingFiles = filesData.filter((f) => f.project_id === projectId && f.filename === data.filename);
    const version = existingFiles.length + 1;
    const fileId = nextFileId++;
    const fileBuffer = Buffer.from(data.base64, 'base64');
    const safeName = `${fileId}_${data.filename}`;
    const filePath = path.join(uploadsDir, safeName);
    try {
      fs.writeFileSync(filePath, fileBuffer);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to save file' }));
      return;
    }
    const fileRecord = {
      id: fileId,
      project_id: projectId,
      filename: data.filename,
      file_type: data.fileType,
      version,
      s3_key: safeName,
      uploaded_at: new Date().toISOString()
    };
    filesData.push(fileRecord);
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(fileRecord));
    return;
  }

  // GET /api/files/:fileId – download a file
  if (fileMatch && req.method === 'GET') {
    const fileId = parseInt(fileMatch[1], 10);
    const fileRecord = filesData.find((f) => f.id === fileId);
    if (!fileRecord) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found' }));
      return;
    }
    const filePath = path.join(uploadsDir, fileRecord.s3_key);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File missing on disk' }));
      return;
    }
    // Stream file with appropriate MIME type
    const ext = path.extname(fileRecord.filename).slice(1);
    const mime = getMimeType(ext);
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size
    });
    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
    return;
  }

  // DELETE /api/files/:fileId – delete a file
  if (fileMatch && req.method === 'DELETE') {
    const fileId = parseInt(fileMatch[1], 10);
    const index = filesData.findIndex((f) => f.id === fileId);
    if (index === -1) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found' }));
      return;
    }
    const fileRecord = filesData[index];
    filesData.splice(index, 1);
    const filePath = path.join(uploadsDir, fileRecord.s3_key);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (_) {
        // ignore errors during file deletion
      }
    }
    res.writeHead(204);
    res.end();
    return;
  }

  // If no route matched, return 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
}

// Create the HTTP server. It serves the health endpoint, API routes and static assets.
const server = http.createServer(async (req, res) => {
  // Normalize the URL to avoid directory traversal
  const url = new URL(req.url, `http://${req.headers.host}`).pathname;

  // Route API requests beginning with /api
  if (url.startsWith('/api/')) {
    await handleApi(req, res, url);
    return;
  }

  // Simple API endpoint for health check (non‑API path for legacy reasons)
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

  // All other methods are not supported for non‑API routes
  res.writeHead(405);
  res.end('Method Not Allowed');
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

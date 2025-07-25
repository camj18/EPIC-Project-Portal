const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3001;

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

function resolveStaticPath(url) {
  const clientDir = path.join(__dirname, '..', 'client');
  const buildDir = path.join(clientDir, 'build');
  const buildExists = fs.existsSync(buildDir);
  const requestedPath = url === '/' ? 'index.html' : url.replace(/^\//, '');
  if (buildExists) {
    const fileInBuild = path.join(buildDir, requestedPath);
    if (fs.existsSync(fileInBuild) && fs.statSync(fileInBuild).isFile()) {
      return fileInBuild;
    }
  }
  const fallbackFile = path.join(clientDir, requestedPath);
  if (fs.existsSync(fallbackFile) && fs.statSync(fallbackFile).isFile()) {
    return fallbackFile;
  }
  return path.join(clientDir, 'index.html');
}

// Data stores
const tasksData = [];
let nextTaskId = 1;
const projects = [];
const filesData = [];
let nextProjectId = 1;
let nextFileId = 1;

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

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

async function handleApi(req, res, pathname) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === '/api/health' && req.method === 'GET') {
    const body = JSON.stringify({ status: 'OK' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
    return;
  }

  if (pathname === '/api/projects' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(projects));
    return;
  }

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

  // regex
  const projectFilesMatch = pathname.match(/^\/api\/projects\/(\d+)\/files$/);
  const fileMatch = pathname.match(/^\/api\/files\/(\d+)$/);
  const projectTasksMatch = pathname.match(/^\/api\/projects\/(\d+)\/tasks$/);
  const taskMatch = pathname.match(/^\/api\/tasks\/(\d+)$/);

  // list files
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

  // create file
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

  // tasks endpoints
  if (projectTasksMatch && req.method === 'GET') {
    const projectId = parseInt(projectTasksMatch[1], 10);
    const project = projects.find((p) => p.id === projectId);
    if (!project) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Project not found' }));
      return;
    }
    const projectTasks = tasksData.filter((t) => t.project_id === projectId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(projectTasks));
    return;
  }

  if (projectTasksMatch && req.method === 'POST') {
    const projectId = parseInt(projectTasksMatch[1], 10);
    const project = projects.find((p) => p.id === projectId);
    if (!project) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Project not found' }));
      return;
    }
    const data = await parseJsonBody(req);
    if (!data || typeof data.title !== 'string' || !data.title.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid task data' }));
      return;
    }
    const task = {
      id: nextTaskId++,
      project_id: projectId,
      title: data.title.trim(),
      description: data.description || '',
      status: data.status || 'Backlog',
      assignees: Array.isArray(data.assignees) ? data.assignees : [],
      due_date: typeof data.due_date === 'string' ? data.due_date : null,
      labels: Array.isArray(data.labels) ? data.labels : [],
      created_at: new Date().toISOString()
    };
    tasksData.push(task);
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(task));
    return;
  }

  if (taskMatch && req.method === 'PATCH') {
    const taskId = parseInt(taskMatch[1], 10);
    const index = tasksData.findIndex((t) => t.id === taskId);
    if (index === -1) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task not found' }));
      return;
    }
    const data = await parseJsonBody(req);
    if (!data) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid task data' }));
      return;
    }
    const task = tasksData[index];
    if (typeof data.title === 'string') task.title = data.title.trim();
    if (typeof data.description === 'string') task.description = data.description;
    if (typeof data.status === 'string') task.status = data.status;
    if (Array.isArray(data.assignees)) task.assignees = data.assignees;
    if (typeof data.due_date === 'string' || data.due_date === null) task.due_date = data.due_date;
    if (Array.isArray(data.labels)) task.labels = data.labels;
    tasksData[index] = task;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(task));
    return;
  }

  if (taskMatch && req.method === 'DELETE') {
    const taskId = parseInt(taskMatch[1], 10);
    const index = tasksData.findIndex((t) => t.id === taskId);
    if (index === -1) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task not found' }));
      return;
    }
    tasksData.splice(index, 1);
    res.writeHead(204);
    res.end();
    return;
  }

  // get file
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
    const ext = path.extname(fileRecord.filename).slice(1);
    const mime = getMimeType(ext);
    const stat = fs.statSync(filePath);
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size });
    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
    return;
  }

  // delete file
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
      }
    }
    res.writeHead(204);
    res.end();
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`).pathname;

  if (url.startsWith('/api/')) {
    await handleApi(req, res, url);
    return;
  }

  if (url === '/health') {
    const body = JSON.stringify({ status: 'OK' });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
    return;
  }

  if (req.method === 'GET') {
    const filePath = resolveStaticPath(url);
    fs.readFile(filePath, (err, content) => {
      if (err) {
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

  res.writeHead(405);
  res.end('Method Not Allowed');
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

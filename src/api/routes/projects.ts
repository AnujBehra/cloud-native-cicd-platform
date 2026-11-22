import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Database } from '../../db/database.js';
import { Project } from '../../types/index.js';

export const projectsRouter = Router();
const db = Database.getInstance();

// GET /api/projects
projectsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const projects = await db.getProjects();
    res.json({ success: true, count: projects.length, data: projects });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/projects/:id
projectsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const project = await db.getProjectById(req.params.id);
    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }
    res.json({ success: true, data: project });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/projects
projectsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { name, repoUrl, defaultBranch, helmChartPath, dockerfilePath, environments } = req.body;
    if (!name || !repoUrl) {
      return res.status(400).json({ success: false, error: 'name and repoUrl are required' });
    }

    const project: Project = {
      id: `proj-${uuidv4().substring(0, 8)}`,
      name: name.toLowerCase().replace(/[^a-z0-9-_]/g, '-'),
      repoUrl,
      defaultBranch: defaultBranch || 'main',
      helmChartPath: helmChartPath || `charts/${name}`,
      dockerfilePath: dockerfilePath || 'Dockerfile',
      environments: environments || ['development', 'staging', 'production'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const created = await db.createProject(project);
    res.status(201).json({ success: true, data: created });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

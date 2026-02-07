import { Router, Request, Response } from 'express';
import { MemoryStore } from '@dca/memory';
import { TaskCoordinator } from '../controllers/TaskCoordinator';
import { WebSocketManager } from '../events/WebSocketManager';

export function createTaskRoutes(
  memory: MemoryStore,
  coordinator: TaskCoordinator,
  wsManager: WebSocketManager,
): Router {
  const router = Router();

  /**
   * POST /api/tasks - Submit a new task
   */
  router.post('/tasks', async (req: Request, res: Response) => {
    try {
      const { request: userRequest, workspace_root } = req.body;

      if (!userRequest || typeof userRequest !== 'string') {
        return res.status(400).json({ error: 'Missing required field: request (string)' });
      }

      const task = await memory.createTask(
        userRequest,
        workspace_root || process.env.WORKSPACE_ROOT || '/workspace'
      );

      // Start processing asynchronously
      coordinator.processNewTask(task).catch(err => {
        console.error(`[tasks] Failed to process task ${task.id}:`, err);
        memory.updateTask(task.id, { status: 'failed' }).catch(() => {});
      });

      res.status(201).json({
        id: task.id,
        status: task.status,
        message: 'Task submitted successfully. Subscribe to WebSocket for live updates.',
        ws_url: `/ws`,
      });
    } catch (err) {
      console.error('[tasks] Error creating task:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/tasks - List all tasks
   */
  router.get('/tasks', async (_req: Request, res: Response) => {
    try {
      const tasks = await memory.listTasks(50);
      res.json({ tasks });
    } catch (err) {
      console.error('[tasks] Error listing tasks:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/tasks/:id - Get task details
   */
  router.get('/tasks/:id', async (req: Request, res: Response) => {
    try {
      const task = await memory.getTask(req.params.id);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }

      const subtasks = await memory.getSubtasksForTask(task.id);
      const messages = await memory.getMessages(task.id);

      res.json({ task, subtasks, messages });
    } catch (err) {
      console.error('[tasks] Error getting task:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/tasks/:id/events - Get event stream for a task
   */
  router.get('/tasks/:id/events', async (req: Request, res: Response) => {
    try {
      const since = req.query.since ? new Date(req.query.since as string) : undefined;
      const events = await memory.getEvents(req.params.id, since);
      res.json({ events });
    } catch (err) {
      console.error('[tasks] Error getting events:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/tasks/:id/result - Get the result packet
   */
  router.get('/tasks/:id/result', async (req: Request, res: Response) => {
    try {
      const task = await memory.getTask(req.params.id);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }
      if (!task.result_packet) {
        return res.status(404).json({ error: 'Result packet not yet available', status: task.status });
      }
      res.json({ result: task.result_packet });
    } catch (err) {
      console.error('[tasks] Error getting result:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/tasks/:id/approve - Approve a pending subtask
   */
  router.post('/tasks/:id/approve', async (req: Request, res: Response) => {
    try {
      const { subtask_id } = req.body;
      if (!subtask_id) {
        return res.status(400).json({ error: 'Missing required field: subtask_id' });
      }

      await coordinator.approveSubtask(req.params.id, subtask_id);
      res.json({ message: 'Subtask approved', subtask_id });
    } catch (err) {
      console.error('[tasks] Error approving subtask:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/tasks/:id/subtasks - List subtasks for a task
   */
  router.get('/tasks/:id/subtasks', async (req: Request, res: Response) => {
    try {
      const subtasks = await memory.getSubtasksForTask(req.params.id);
      res.json({ subtasks });
    } catch (err) {
      console.error('[tasks] Error getting subtasks:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/tasks/:id/files - List file changes for a task
   */
  router.get('/tasks/:id/files', async (req: Request, res: Response) => {
    try {
      const fileChanges = await memory.getFileChanges(req.params.id);
      res.json({ file_changes: fileChanges });
    } catch (err) {
      console.error('[tasks] Error getting file changes:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/tasks/:id/commands - List commands executed for a task
   */
  router.get('/tasks/:id/commands', async (req: Request, res: Response) => {
    try {
      const commands = await memory.getCommands(req.params.id);
      res.json({ commands });
    } catch (err) {
      console.error('[tasks] Error getting commands:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/tasks/:id/decisions - List decisions for a task
   */
  router.get('/tasks/:id/decisions', async (req: Request, res: Response) => {
    try {
      const decisions = await memory.getDecisions(req.params.id);
      res.json({ decisions });
    } catch (err) {
      console.error('[tasks] Error getting decisions:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/status - System status
   */
  router.get('/status', async (_req: Request, res: Response) => {
    try {
      const tasks = await memory.listTasks(5);
      res.json({
        status: 'operational',
        connected_clients: wsManager.getConnectedCount(),
        recent_tasks: tasks.map(t => ({
          id: t.id,
          status: t.status,
          created_at: t.created_at,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

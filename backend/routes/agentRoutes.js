// backend/routes/agentRoutes.js
const router = require('express').Router();
const { verifyToken } = require('../middleware/auth');
const { agentLimiter } = require('../middleware/rateLimit');
const Orchestrator = require('../agents/orchestrator');
const Task = require('../models/Task');
const messageQueue = require('../utils/messageQueue');
const conflictResolver = require('../utils/conflictResolver');

// POST /api/agents/task — Submit a new task to the swarm
router.post('/task', verifyToken, agentLimiter, async (req, res, next) => {
  try {
    const { description, options = {}, screenshot } = req.body;
    if (!description || description.trim().length < 5) {
      return res.status(400).json({ error: 'Task description must be at least 5 characters' });
    }

    // Validate screenshot if provided
    if (screenshot) {
      if (!screenshot.base64 || !screenshot.mediaType) {
        return res.status(400).json({ error: 'Screenshot must include base64 and mediaType' });
      }
      const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
      if (!allowedTypes.includes(screenshot.mediaType)) {
        return res.status(400).json({ error: 'Screenshot must be PNG, JPEG, WEBP, or GIF' });
      }
      // Rough size check — base64 is ~33% larger than original
      const estimatedBytes = (screenshot.base64.length * 3) / 4;
      if (estimatedBytes > 10 * 1024 * 1024) {
        return res.status(400).json({ error: 'Screenshot must be under 10 MB' });
      }
    }

    const task = await Task.create({
      userId: req.user.id,
      description: description.trim(),
      status: 'pending',
      options,
      hasScreenshot: !!screenshot,
    });

    // Start orchestration non-blocking — pass screenshot along
    const orchestrator = new Orchestrator(task._id);
    orchestrator.run(description.trim(), screenshot || null).catch(err => {
      console.error(`Task ${task._id} failed:`, err.message);
    });

    res.json({
      taskId: task._id,
      status: 'initiated',
      message: 'DevSwarm agents activated!',
      hasScreenshot: !!screenshot,
    });
  } catch (err) { next(err); }
});

// GET /api/agents/task/:id — Get task status + all agent outputs
router.get('/task/:id', verifyToken, async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id).lean();
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.userId.toString() !== req.user.id.toString()) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(task);
  } catch (err) { next(err); }
});

// GET /api/agents/tasks — List user's tasks
router.get('/tasks', verifyToken, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const tasks = await Task.find({ userId: req.user.id })
      .select('description status createdAt completedAt agentOutputs conflicts hasScreenshot')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
    const total = await Task.countDocuments({ userId: req.user.id });
    res.json({ tasks, total, page, pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

// GET /api/agents/stream/:id — SSE live event stream
router.get('/stream/:id', verifyToken, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (res.flush) res.flush();
  };

  const heartbeat = setInterval(() => {
    res.write(':heartbeat\n\n');
    if (res.flush) res.flush();
  }, 15000);

  const cleanup = messageQueue.subscribe(req.params.id, send);

  req.on('close', () => {
    clearInterval(heartbeat);
    cleanup();
  });
});

// POST /api/agents/resolve/:taskId — Trigger conflict resolution
router.post('/resolve/:taskId', verifyToken, async (req, res, next) => {
  try {
    const { conflict, agentA, agentB } = req.body;
    if (!conflict || !agentA || !agentB) {
      return res.status(400).json({ error: 'conflict, agentA, agentB are required' });
    }
    const resolution = await conflictResolver.resolve({ conflict, agentA, agentB, context: req.body.context || '' });
    res.json({ resolution });
  } catch (err) { next(err); }
});

// DELETE /api/agents/task/:id
router.delete('/task/:id', verifyToken, async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.userId.toString() !== req.user.id.toString()) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await task.deleteOne();
    res.json({ message: 'Task deleted' });
  } catch (err) { next(err); }
});

module.exports = router;

// backend/routes/taskRoutes.js
const router = require('express').Router();
const { verifyToken } = require('../middleware/auth');
const Task = require('../models/Task');
const archiver = require('archiver');

// GET /api/tasks — Alias for agent tasks
router.get('/', verifyToken, async (req, res, next) => {
  try {
    const tasks = await Task.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    res.json(tasks);
  } catch (err) { next(err); }
});

// GET /api/tasks/stats
router.get('/stats', verifyToken, async (req, res, next) => {
  try {
    const [total, complete, failed, running] = await Promise.all([
      Task.countDocuments({ userId: req.user.id }),
      Task.countDocuments({ userId: req.user.id, status: 'complete' }),
      Task.countDocuments({ userId: req.user.id, status: 'failed' }),
      Task.countDocuments({ userId: req.user.id, status: 'running' }),
    ]);
    res.json({ total, complete, failed, running, pending: total - complete - failed - running });
  } catch (err) { next(err); }
});

// GET /api/tasks/:id — fetch a single task with messages and outputs
router.get('/:id', verifyToken, async (req, res, next) => {
  try {
    const task = await Task.findOne({ _id: req.params.id, userId: req.user.id }).lean();
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  } catch (err) { next(err); }
});

// POST /api/tasks/:id/zip — generate a ZIP of final output and code files, stream as download
router.post('/:id/zip', verifyToken, async (req, res, next) => {
  try {
    const task = await Task.findOne({ _id: req.params.id, userId: req.user.id }).lean();
    if (!task) return res.status(404).json({ error: 'Task not found' });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=devswarm-task-${task._id}.zip`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', err => next(err));
    archive.pipe(res);

    // Add finalOutput as markdown
    if (task.finalOutput) {
      archive.append(task.finalOutput, { name: 'final_output.md' });
    }

    // Add agent outputs as text files and their code blocks as separate files
    if (Array.isArray(task.agentOutputs)) {
      task.agentOutputs.forEach((ao) => {
        const prefix = ao.agent || 'agent';
        if (ao.output) archive.append(ao.output, { name: `${prefix}_output.txt` });
        if (Array.isArray(ao.codeBlocks)) {
          ao.codeBlocks.forEach((code, idx) => {
            // try to guess extension from content (simple heuristics)
            let ext = '.txt';
            const firstLine = (code || '').trim().split('\n')[0] || '';
            if (/^<\w+/.test(firstLine) || /export default|React/.test(code)) ext = '.jsx';
            else if (/^#!/.test(firstLine) || /function |const |=>/.test(code)) ext = '.js';
            else if (/^\s*def\s+/.test(code)) ext = '.py';
            archive.append(code, { name: `${prefix}_code_${idx + 1}${ext}` });
          });
        }
      });
    }

    // Add messages log
    if (Array.isArray(task.messages)) {
      const msgs = task.messages.map(m => `[${m.timestamp}] ${m.from}->${m.to}: ${m.content}`).join('\n');
      archive.append(msgs, { name: 'messages.log' });
    }

    archive.finalize();
  } catch (err) { next(err); }
});

module.exports = router;

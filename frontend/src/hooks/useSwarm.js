// frontend/src/hooks/useSwarm.js
import { useCallback, useRef } from 'react';
import { useSwarmStore } from '../store/swarmStore';

const API = import.meta.env.VITE_API_URL || '/api';

export function useSwarm() {
  const sseRef = useRef(null);

  const connectSSE = useCallback((taskId) => {
    if (sseRef.current) sseRef.current.close();

    const token = useSwarmStore.getState().token;
    const url = `${API}/agents/stream/${taskId}`;
    const es = new EventSource(`${url}?token=${token}`);
    sseRef.current = es;

    const handleEvent = (eventName) => (e) => {
      try {
        const data = JSON.parse(e.data);
        const s = useSwarmStore.getState();
        s.addEvent({ event: eventName, data, id: Date.now() });

        switch (eventName) {
          case 'agent_start':
            s.setAgentStatus(data.agent, 'running');
            break;
          case 'agent_done':
            s.setAgentStatus(data.agent, 'done');
            break;
          case 'agent_error':
            s.setAgentStatus(data.agent, 'error');
            break;
          case 'phase':
            s.setCurrentPhase(data.phase);
            break;
          case 'complete':
            s.setCurrentPhase(6);
            s.resetAgentStatuses();
            s.fetchTask(taskId).then(t => useSwarmStore.getState().setCurrentTask(t));
            break;
        }
      } catch (_) {}
    };

    const eventTypes = [
      'orchestrator', 'decomposition', 'phase',
      'agent_start', 'agent_done', 'agent_error',
      'inter_agent_message', 'conflict_detected', 'conflict_resolved',
      'complete', 'error', 'screenshot_received'
    ];

    eventTypes.forEach(ev => es.addEventListener(ev, handleEvent(ev)));

    es.onerror = () => {
      useSwarmStore.getState().addEvent({
        event: 'sse_error',
        data: { message: 'Connection lost' },
        id: Date.now()
      });
    };

    return () => es.close();
  }, []);

  // screenshot: { base64, mediaType, dataUrl, name } | null
  const submitTask = useCallback(async (description, screenshot = null) => {
    const s = useSwarmStore.getState();
    s.clearEvents();
    s.resetAgentStatuses();
    s.setCurrentPhase(0);

    const result = await s.submitTask(description, screenshot);

    useSwarmStore.getState().setCurrentTask({
      _id: result.taskId,
      status: 'running',
      description,
      // Keep the dataUrl for thumbnail display in the chat bubble
      screenshotDataUrl: screenshot?.dataUrl || null,
    });

    connectSSE(result.taskId);
    return result;
  }, [connectSSE]);

  const disconnect = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
  }, []);

  return { submitTask, connectSSE, disconnect };
}

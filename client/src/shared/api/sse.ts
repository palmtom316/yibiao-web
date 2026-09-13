// M1-P6 SSE 客户端：单条多路复用连接 + 按 channel 解复用。
//
// 用 @microsoft/fetch-event-source（基于 fetch，可带 Authorization 头，不走 URL ?token=）。
// 服务端 /api/events 每帧带 `event: <channel>`，本管理器按 channel 分发到对应监听器。
// 一条连接服务 tasks / kb-document / ai-http-error / export-progress 全域。
//
// 生命周期由 AuthProvider 驱动：login 后 start()，logout 时 stop()，boot 时若已登录也 start()。
// 401/403/400/404：停止重连。正常 EOF 与网络抖动走受控退避，并在重连后拉权威快照。
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { http, TOKEN_KEY, getActiveProjectId } from './http';
import { isFatalSseStatus, shouldOpenSseConnection, shouldReconnectAfterClose, sseRetryDelayMs } from './ssePolicy';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export type SseChannel = 'jobs' | 'tasks' | 'kb-document' | 'ai-http-error' | 'export-progress' | 'agent-question';
type Listener = (data: unknown) => void;

class FatalSseError extends Error {
  constructor(message = 'SSE connection is not recoverable') {
    super(message);
  }
}

class SseManager {
  private listeners = new Map<SseChannel, Set<Listener>>();
  private ctrl: AbortController | null = null;
  private started = false;
  private generation = 0;
  private retryAttempt = 0;
  private retryTimer: number | null = null;

  subscribe(channel: SseChannel, cb: Listener): () => void {
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
    }
    set.add(cb);
    this.start();
    return () => {
      const current = this.listeners.get(channel);
      if (!current) return;
      current.delete(cb);
      if (current.size === 0) this.listeners.delete(channel);
    };
  }

  async refreshSnapshot(): Promise<void> {
    const pid = getActiveProjectId();
    const generation = this.generation;
    if (pid == null) return;
    const { data } = await http.get('/tasks/snapshot');
    if (getActiveProjectId() === pid && generation === this.generation) {
      for (const callback of this.listeners.get('tasks') || []) callback(data);
    }
  }

  start(): void {
    if (this.started) return;
    const token = localStorage.getItem(TOKEN_KEY);
    const projectId = getActiveProjectId();
    if (!shouldOpenSseConnection({ token, projectId, stopped: false })) return;
    this.started = true;
    this.retryAttempt = 0;
    this.open(token!);
  }

  stop(): void {
    this.started = false;
    this.generation += 1;
    if (this.retryTimer != null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.ctrl?.abort();
    this.ctrl = null;
  }

  reconnect(): void {
    const token = localStorage.getItem(TOKEN_KEY);
    this.stop();
    if (!shouldOpenSseConnection({ token, projectId: getActiveProjectId(), stopped: false })) return;
    this.started = true;
    this.retryAttempt = 0;
    this.open(token!);
  }

  private scheduleReconnect(generation: number): void {
    if (!shouldReconnectAfterClose({
      stopped: !this.started,
      projectId: getActiveProjectId(),
      connectionGeneration: generation,
      currentGeneration: this.generation,
    })) return;
    if (this.retryTimer != null) window.clearTimeout(this.retryTimer);
    const delay = sseRetryDelayMs(this.retryAttempt);
    this.retryAttempt += 1;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (!shouldReconnectAfterClose({
        stopped: !this.started,
        projectId: getActiveProjectId(),
        connectionGeneration: generation,
        currentGeneration: this.generation,
      })) return;
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) return;
      this.open(token);
    }, delay);
  }

  private open(token: string): void {
    this.ctrl?.abort();
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    const generation = ++this.generation;
    const pid = getActiveProjectId();
    if (!shouldOpenSseConnection({ token, projectId: pid, stopped: !this.started })) return;
    const url = `${BASE_URL}/events?projectId=${pid}`;

    void fetchEventSource(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
      openWhenHidden: true,
      onopen: async (res: Response): Promise<void> => {
        if (isFatalSseStatus(res.status)) throw new FatalSseError();
        if (!res.ok && res.status !== 200) throw new Error(`SSE 连接失败：HTTP ${res.status}`);
        this.retryAttempt = 0;
        const snapshot = await http.get('/tasks/snapshot', { signal: ctrl.signal });
        if (getActiveProjectId() === pid && generation === this.generation && !ctrl.signal.aborted) {
          for (const listener of this.listeners.get('tasks') || []) listener(snapshot.data);
          window.dispatchEvent(new CustomEvent('yibiao:sse-reconnected'));
        }
      },
      onmessage: (ev) => {
        if (generation !== this.generation) return;
        const channel = ev.event as SseChannel | undefined;
        if (!channel) return;
        let data: unknown = ev.data;
        if (typeof ev.data === 'string') {
          try { data = JSON.parse(ev.data); } catch { /* 保留原始字符串 */ }
        }
        const set = this.listeners.get(channel);
        if (!set || set.size === 0) return;
        for (const cb of set) {
          try { cb(data); } catch { /* 单个监听器异常不影响其他 */ }
        }
      },
      onclose: () => {
        this.scheduleReconnect(generation);
      },
      onerror: (err: unknown) => {
        if (err instanceof FatalSseError) {
          this.started = false;
          throw err;
        }
        this.scheduleReconnect(generation);
        throw err;
      },
    }).catch(() => {
      /* FatalSseError、abort 或已改由 scheduleReconnect 处理 */
    });
  }
}

export const sseManager = new SseManager();

window.addEventListener('yibiao:content-updated', () => { void sseManager.refreshSnapshot().catch(() => undefined); });

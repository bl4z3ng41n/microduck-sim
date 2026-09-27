// Minimal Moonraker client for Klipper printers (Elegoo Neptune 4 / 4 Pro /
// 4 Plus / 4 Max ship Klipper + Moonraker + Fluidd). Talks to the printer
// straight from the browser: REST for one-shot calls, the JSON-RPC websocket
// for live status, polling as a fallback. Nothing goes through a server.
//
// Ports: on the stock Neptune 4 firmware Moonraker is only bound locally and
// an nginx proxy exposes the API (REST + websocket) on port 80; Fluidd is on
// 4408 and Mainsail on 4409. Self-built Klipper installs use 7125.
//
// Moonraker must allow this page's origin: its default moonraker.conf has
//   [authorization]
//   cors_domains: *.local, *://localhost, *://localhost:*, *://my.mainsail.xyz, *://app.fluidd.xyz
//   trusted_clients: 10.0.0.0/8, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16, FE80::/10, ::1/128
// so a dev server on localhost works out of the box; a deployed site needs its
// origin added to cors_domains.

export type PrintState = 'standby' | 'printing' | 'paused' | 'complete' | 'cancelled' | 'error' | 'unknown';

export interface PrinterStatus {
	connected: boolean;
	klippyState: string; // ready | startup | shutdown | error
	state: PrintState;
	filename: string;
	progress: number; // 0..1
	printDurationS: number;
	totalDurationS: number;
	filamentUsedMm: number;
	message: string;
	bedTemp: number;
	bedTarget: number;
	extruderTemp: number;
	extruderTarget: number;
	layer: number | null;
	totalLayers: number | null;
	etaS: number | null;
	updatedAt: number;
}

export interface GcodeFile {
	path: string;
	size: number;
	modified: number;
	estimatedTimeS?: number;
	filamentTotalMm?: number;
}

export type StatusEvent =
	| { kind: 'connected' }
	| { kind: 'disconnected'; reason: string }
	| { kind: 'print_started'; filename: string }
	| { kind: 'print_paused'; filename: string; message: string }
	| { kind: 'print_resumed'; filename: string }
	| { kind: 'print_complete'; filename: string; durationS: number }
	| { kind: 'print_cancelled'; filename: string }
	| { kind: 'print_error'; filename: string; message: string }
	| { kind: 'klippy'; state: string };

export const EMPTY_STATUS: PrinterStatus = {
	connected: false, klippyState: 'unknown', state: 'unknown', filename: '', progress: 0, printDurationS: 0, totalDurationS: 0,
	filamentUsedMm: 0, message: '', bedTemp: 0, bedTarget: 0, extruderTemp: 0, extruderTarget: 0, layer: null, totalLayers: null,
	etaS: null, updatedAt: 0
};

const QUERY_OBJECTS: Record<string, string[] | null> = {
	print_stats: null,
	display_status: null,
	virtual_sdcard: null,
	heater_bed: ['temperature', 'target'],
	extruder: ['temperature', 'target'],
	webhooks: null
};

export class MoonrakerClient {
	private base: string;
	private ws: WebSocket | null = null;
	private rpcId = 1;
	private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private stopped = false;
	status: PrinterStatus = { ...EMPTY_STATUS };
	onStatus?: (s: PrinterStatus) => void;
	onEvent?: (e: StatusEvent) => void;

	/** `host` like "http://192.168.1.50:7125" or "http://neptune4.local:7125". */
	constructor(host: string) {
		this.base = host.replace(/\/+$/, '');
		if (!/^https?:\/\//.test(this.base)) this.base = `http://${this.base}`;
	}

	get url() { return this.base; }

	// ── REST ────────────────────────────────────────────────────────────
	private async rest<T = unknown>(path: string, init?: RequestInit): Promise<T> {
		const r = await fetch(`${this.base}${path}`, { ...init, signal: init?.signal ?? AbortSignal.timeout(8000) });
		if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
		const j = (await r.json()) as { result?: T; error?: { message?: string } };
		if (j.error) throw new Error(j.error.message ?? 'Moonraker error');
		return (j.result ?? j) as T;
	}

	async info() {
		return this.rest<{ state: string; state_message: string; hostname: string; software_version: string }>('/printer/info');
	}

	async serverInfo() {
		return this.rest<{ klippy_connected: boolean; klippy_state: string; moonraker_version: string }>('/server/info');
	}

	async query(): Promise<PrinterStatus> {
		const objs = Object.entries(QUERY_OBJECTS).map(([k, v]) => (v ? `${k}=${v.join(',')}` : k)).join('&');
		const res = await this.rest<{ status: Record<string, Record<string, unknown>> }>(`/printer/objects/query?${objs}`);
		this.apply(res.status);
		return this.status;
	}

	async listGcodes(): Promise<GcodeFile[]> {
		const files = await this.rest<Array<{ path: string; size: number; modified: number }>>('/server/files/list?root=gcodes');
		return files.map((f) => ({ path: f.path, size: f.size, modified: f.modified }));
	}

	async fileMetadata(filename: string) {
		return this.rest<{ estimated_time?: number; filament_total?: number; layer_count?: number; object_height?: number }>(
			`/server/files/metadata?filename=${encodeURIComponent(filename)}`
		);
	}

	/** Upload a .gcode file into the printer's gcodes root (optionally start it). */
	async upload(file: File, startPrint = false): Promise<{ item: { path: string } }> {
		const form = new FormData();
		form.append('file', file, file.name);
		form.append('root', 'gcodes');
		if (startPrint) form.append('print', 'true');
		const r = await fetch(`${this.base}/server/files/upload`, { method: 'POST', body: form });
		if (!r.ok) throw new Error(`upload → HTTP ${r.status}`);
		return (await r.json()) as { item: { path: string } };
	}

	startPrint(filename: string) { return this.rest(`/printer/print/start?filename=${encodeURIComponent(filename)}`, { method: 'POST' }); }
	pausePrint() { return this.rest('/printer/print/pause', { method: 'POST' }); }
	resumePrint() { return this.rest('/printer/print/resume', { method: 'POST' }); }
	cancelPrint() { return this.rest('/printer/print/cancel', { method: 'POST' }); }
	gcode(script: string) { return this.rest(`/printer/gcode/script?script=${encodeURIComponent(script)}`, { method: 'POST' }); }

	// ── Live status: websocket first, polling fallback ───────────────────
	start(pollMs = 3000) {
		this.stopped = false;
		this.openWs();
		this.pollTimer ??= setInterval(() => {
			if (!this.ws || this.ws.readyState !== WebSocket.OPEN) void this.query().catch(() => this.markDisconnected('poll failed'));
		}, pollMs);
		void this.query().catch(() => this.markDisconnected('unreachable'));
	}

	stop() {
		this.stopped = true;
		if (this.pollTimer) clearInterval(this.pollTimer);
		this.pollTimer = null;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;
		this.ws?.close();
		this.ws = null;
	}

	private openWs() {
		if (this.stopped) return;
		const wsUrl = this.base.replace(/^http/, 'ws') + '/websocket';
		let ws: WebSocket;
		try {
			ws = new WebSocket(wsUrl);
		} catch {
			return;
		}
		this.ws = ws;
		ws.onopen = () => {
			void this.rpc('printer.objects.subscribe', { objects: QUERY_OBJECTS })
				.then((res) => {
					const r = res as { status?: Record<string, Record<string, unknown>> };
					if (r?.status) this.apply(r.status);
					if (!this.status.connected) {
						this.status = { ...this.status, connected: true };
						this.onStatus?.(this.status);
						this.onEvent?.({ kind: 'connected' });
					}
				})
				.catch(() => {});
		};
		ws.onmessage = (ev) => {
			let msg: { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: unknown[] };
			try {
				msg = JSON.parse(ev.data as string);
			} catch {
				return;
			}
			if (msg.id !== undefined && this.pending.has(msg.id)) {
				const p = this.pending.get(msg.id)!;
				this.pending.delete(msg.id);
				if (msg.error) p.reject(new Error(msg.error.message ?? 'rpc error'));
				else p.resolve(msg.result);
				return;
			}
			if (msg.method === 'notify_status_update' && Array.isArray(msg.params)) {
				this.apply(msg.params[0] as Record<string, Record<string, unknown>>);
			} else if (msg.method === 'notify_klippy_disconnected' || msg.method === 'notify_klippy_shutdown') {
				this.status = { ...this.status, klippyState: 'shutdown' };
				this.onStatus?.(this.status);
				this.onEvent?.({ kind: 'klippy', state: 'shutdown' });
			} else if (msg.method === 'notify_klippy_ready') {
				this.status = { ...this.status, klippyState: 'ready' };
				this.onStatus?.(this.status);
				this.onEvent?.({ kind: 'klippy', state: 'ready' });
				void this.query().catch(() => {});
			}
		};
		ws.onclose = () => {
			if (this.ws === ws) this.ws = null;
			this.markDisconnected('websocket closed');
			if (!this.stopped) this.reconnectTimer = setTimeout(() => this.openWs(), 4000);
		};
		ws.onerror = () => ws.close();
	}

	private rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
		const ws = this.ws;
		if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('websocket not open'));
		const id = this.rpcId++;
		ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }));
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			setTimeout(() => {
				if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
			}, 8000);
		});
	}

	private markDisconnected(reason: string) {
		if (!this.status.connected) return;
		this.status = { ...this.status, connected: false, updatedAt: Date.now() };
		this.onStatus?.(this.status);
		this.onEvent?.({ kind: 'disconnected', reason });
	}

	/** Merge a (partial) objects status payload and emit transitions. */
	private apply(st: Record<string, Record<string, unknown>>) {
		const prev = this.status;
		const ps = (st.print_stats ?? {}) as Record<string, unknown>;
		const ds = (st.display_status ?? {}) as Record<string, unknown>;
		const vs = (st.virtual_sdcard ?? {}) as Record<string, unknown>;
		const hb = (st.heater_bed ?? {}) as Record<string, unknown>;
		const ex = (st.extruder ?? {}) as Record<string, unknown>;
		const wh = (st.webhooks ?? {}) as Record<string, unknown>;
		const info = (ps.info ?? {}) as Record<string, unknown>;
		const next: PrinterStatus = {
			connected: true,
			klippyState: (wh.state as string) ?? prev.klippyState,
			state: ((ps.state as PrintState) ?? prev.state) || 'unknown',
			filename: (ps.filename as string) ?? prev.filename,
			progress: typeof ds.progress === 'number' ? ds.progress : typeof vs.progress === 'number' ? vs.progress : prev.progress,
			printDurationS: (ps.print_duration as number) ?? prev.printDurationS,
			totalDurationS: (ps.total_duration as number) ?? prev.totalDurationS,
			filamentUsedMm: (ps.filament_used as number) ?? prev.filamentUsedMm,
			message: (ps.message as string) ?? (ds.message as string) ?? prev.message,
			bedTemp: (hb.temperature as number) ?? prev.bedTemp,
			bedTarget: (hb.target as number) ?? prev.bedTarget,
			extruderTemp: (ex.temperature as number) ?? prev.extruderTemp,
			extruderTarget: (ex.target as number) ?? prev.extruderTarget,
			layer: (info.current_layer as number) ?? prev.layer,
			totalLayers: (info.total_layer as number) ?? prev.totalLayers,
			etaS: null,
			updatedAt: Date.now()
		};
		if (next.state === 'printing' && next.progress > 0.02 && next.printDurationS > 30) {
			next.etaS = (next.printDurationS / next.progress) * (1 - next.progress);
		}
		this.status = next;
		this.onStatus?.(next);
		if (!prev.connected) this.onEvent?.({ kind: 'connected' });
		if (prev.state !== next.state && prev.state !== 'unknown') {
			switch (next.state) {
				case 'printing':
					this.onEvent?.(prev.state === 'paused' ? { kind: 'print_resumed', filename: next.filename } : { kind: 'print_started', filename: next.filename });
					break;
				case 'paused': this.onEvent?.({ kind: 'print_paused', filename: next.filename, message: next.message }); break;
				case 'complete': this.onEvent?.({ kind: 'print_complete', filename: next.filename, durationS: next.printDurationS }); break;
				case 'cancelled': this.onEvent?.({ kind: 'print_cancelled', filename: next.filename }); break;
				case 'error': this.onEvent?.({ kind: 'print_error', filename: next.filename, message: next.message }); break;
			}
		} else if (prev.state === 'unknown' && next.state === 'printing') {
			this.onEvent?.({ kind: 'print_started', filename: next.filename });
		}
	}
}

export function fmtDuration(s: number | null | undefined): string {
	if (s == null || !Number.isFinite(s)) return '—';
	const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
	return h ? `${h} h ${m.toString().padStart(2, '0')} min` : `${m} min`;
}

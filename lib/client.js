window.__ModuleLoader__.load({
	id: "dsh-todo-reminder",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_dom_client = require("react-dom/client");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/api.ts
		async function todoFetch(path, body) {
			const response = await fetch(path, body === void 0 ? {} : {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body)
			});
			if (!response.ok) throw new Error(`todo ${path} failed: ${response.status}`);
			return await response.json();
		}
		const todoApi = {
			/** 在文件管理器里打开数据目录（自定义音效放这里）。 */
			openDir: () => todoFetch("/api/todo/open-dir", {}),
			state: () => todoFetch("/api/todo/state"),
			add: (input) => todoFetch("/api/todo/add", input),
			update: (id, patch) => todoFetch("/api/todo/update", {
				id,
				patch
			}),
			remove: (id) => todoFetch("/api/todo/delete", { id }),
			complete: (id) => todoFetch("/api/todo/complete", { id }),
			snooze: (id, minutes) => todoFetch("/api/todo/snooze", {
				id,
				minutes
			}),
			dismissReminder: (reminderId) => todoFetch("/api/todo/dismiss-reminder", { reminderId }),
			setSettings: (settings) => todoFetch("/api/todo/set-settings", { settings })
		};
		//#endregion
		//#region src/client/todo-store.ts
		/**
		* 浏览器端 store：单一实例，持有 host 状态快照 + 面板开合 + 待确认完成 +
		* 当前展示的提醒 + 新提醒（供系统通知消费）。React 组件经 useSyncExternalStore 订阅。
		* @module dsh-todo-reminder/client/todo-store
		*/
		var TodoStore = class {
			state = {
				data: null,
				error: null,
				activeReminders: [],
				freshReminders: [],
				confirming: null,
				panelOpen: false
			};
			listeners = /* @__PURE__ */ new Set();
			/** 已发过系统通知的提醒 id，避免重复弹。 */
			notifiedReminderIds = /* @__PURE__ */ new Set();
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			getSnapshot = () => this.state;
			set(patch) {
				this.state = {
					...this.state,
					...patch
				};
				for (const listener of this.listeners) listener();
			}
			/** 用一份 host 状态更新 store，并计算本轮新出现的提醒。 */
			applyState(data) {
				const fresh = data.reminders.filter((r) => !this.notifiedReminderIds.has(r.id));
				for (const r of fresh) this.notifiedReminderIds.add(r.id);
				this.set({
					data,
					error: null,
					activeReminders: data.reminders,
					freshReminders: fresh
				});
			}
			/** 拉取 host 状态（轮询兜底 / 标签页回到前台时调用）。 */
			async refresh() {
				try {
					this.applyState(await todoApi.state());
				} catch (error) {
					this.set({ error: error instanceof Error ? error.message : String(error) });
				}
			}
			/** 在文件管理器里打开数据目录（音效文件放这里）。失败静默 —— 打不开文件夹不该报错打扰。 */
			async openSoundDir() {
				try {
					await todoApi.openDir();
				} catch {}
			}
			togglePanel() {
				this.set({ panelOpen: !this.state.panelOpen });
			}
			setPanel(open) {
				if (this.state.panelOpen !== open) this.set({ panelOpen: open });
			}
			async addTodo(input) {
				await todoApi.add(input);
				await this.refresh();
			}
			async updateTodo(id, patch) {
				await todoApi.update(id, patch);
				await this.refresh();
			}
			async removeTodo(id) {
				await todoApi.remove(id);
				await this.refresh();
			}
			async setSoundByStyle(style, enabled) {
				await todoApi.setSettings({ soundByStyle: { [style]: enabled } });
				await this.refresh();
			}
			async setSnoozeMinutes(minutes) {
				await todoApi.setSettings({ snoozeMinutes: minutes });
				await this.refresh();
			}
			async setSound(patch) {
				await todoApi.setSettings({ sound: patch });
				await this.refresh();
			}
			async setDock(patch) {
				await todoApi.setSettings({ dock: patch });
				await this.refresh();
			}
			/** 完成待办；若开启「完成需确认」则先弹确认框。 */
			async completeTodo(todo, reminderId) {
				if (todo.confirmOnComplete) {
					this.set({ confirming: {
						todo,
						reminderId
					} });
					return;
				}
				await todoApi.complete(todo.id);
				await this.refresh();
			}
			async confirmComplete() {
				const request = this.state.confirming;
				if (request === null) return;
				this.set({ confirming: null });
				await todoApi.complete(request.todo.id);
				if (request.reminderId !== void 0) await todoApi.dismissReminder(request.reminderId);
				await this.refresh();
			}
			cancelConfirm() {
				this.set({ confirming: null });
			}
			async snooze(reminder, minutes) {
				await todoApi.snooze(reminder.todoId, minutes);
				await this.refresh();
			}
			async dismissReminder(reminderId) {
				await todoApi.dismissReminder(reminderId);
				await this.refresh();
			}
		};
		/** 应用级单例（面板 / 提醒 / 确认框共用）。 */
		const todoStore = new TodoStore();
		//#endregion
		//#region src/client/styles.ts
		const STYLE_META = {
			info: {
				label: "提醒",
				icon: "ℹ️"
			},
			success: {
				label: "纪念",
				icon: "✅"
			},
			warning: {
				label: "注意",
				icon: "⚠️"
			},
			danger: {
				label: "紧急",
				icon: "🚨"
			}
		};
		const TODO_CSS = `
/* --- 面板接管中心列（作用域隔离） ---------------------------------------- */
/* --- 面板接管中心列（独立页面式，与任务看板 / SSH 一致） ------------------ */
/* DSH 0.1.6 移除了 data-pane 标记，中心列改用 CSS-module 类名（centerCol）；
   这里同时兼容旧标记与新类名，否则容器定位会失效。 */
/* 只给自己挂载的宿主定位：全局匹配 centerCol 会连带影响其他插件的容器。 */
[data-dsh-todo-host] { position: relative; }

[data-dsh-todo-view] {
  position: absolute;
  inset: 0;
  display: none;
  z-index: 60;
  overflow: auto;
  background: var(--dsw-alias-bg-base);
}
html[data-dsh-todo-active] [data-dsh-todo-view] { display: block; }
html[data-dsh-todo-active] [data-dsh-todo-host] > :not([data-dsh-todo-view]) {
  display: none !important;
}
/* --- 侧边栏入口 ---------------------------------------------------------- */
[data-dsh-todo-entry] {
  display: flex;
  align-items: center;
  justify-content: flex-start; /* 明确左对齐：外壳若覆盖了 flex，也不会变成居中按钮 */
  text-align: left;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 12px;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
  font-family: var(--dsw-font-family);
}
[data-dsh-todo-entry]:hover {
  background: var(--dsw-specific-sidebar-nav-item-hover);
  color: var(--dsw-alias-label-primary);
}
/* 选中态只做「更亮 + 加粗」，不画背景块：面板状态万一过期，也不会在侧边栏留下一块灰底。 */
[data-dsh-todo-entry][data-active] {
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}
[data-dsh-todo-entry] .todo-entry-icon { display: inline-flex; align-items: center; justify-content: center; flex: none; }
[data-dsh-todo-entry] .todo-entry-label { overflow: hidden; text-overflow: ellipsis; }
/* 侧边栏收起态：0.1.6 把折叠标记从 [data-dsh-frame] 挪到了 [data-sidebar-collapsed]，
   两种祖先都匹配，避免收起后入口标签溢出。 */
[data-dsh-frame][data-sidebar-collapsed] [data-dsh-todo-entry],
[data-sidebar-collapsed] [data-dsh-todo-entry] { justify-content: center; padding: 0; }
[data-dsh-frame][data-sidebar-collapsed] [data-dsh-todo-entry] .todo-entry-label,
[data-sidebar-collapsed] [data-dsh-todo-entry] .todo-entry-label { display: none; }

/* --- 面板主体 ------------------------------------------------------------ */
.todo-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 14px 16px 16px;
  gap: 12px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);
}
.todo-header { display: flex; align-items: center; gap: 10px; flex: none; }
.todo-title { margin: 0; font-size: 16px; font-weight: 700; color: var(--dsw-alias-label-primary); white-space: nowrap; }
.todo-count { flex: none; font-size: 12px; color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-interactive-bg-hover); border-radius: 999px; padding: 1px 8px; }

.todo-form { display: flex; flex-direction: column; gap: 8px; flex: none; }
.todo-form-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.todo-input { flex: 1; min-width: 160px; padding: 7px 10px; font-size: 13px; color: var(--dsw-alias-label-primary); background: var(--dsw-specific-input-major); border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; outline: none; font-family: inherit; }
.todo-input:focus { border-color: var(--dsw-alias-state-business-primary); }
.todo-input::placeholder { color: var(--dsw-alias-label-tertiary); }
.todo-select { padding: 7px 8px; font-size: 12.5px; color: var(--dsw-alias-label-primary); background: var(--dsw-specific-input-major); border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; outline: none; }
.todo-select:focus { border-color: var(--dsw-alias-state-business-primary); }
.todo-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--dsw-alias-label-primary); cursor: pointer; user-select: none; }
.todo-check input { accent-color: var(--dsw-alias-state-business-primary); margin: 0; }

/* --- 设置行（响铃 / 稍后提醒分钟数） ------------------------------------ */
.todo-settings { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; flex: none; padding: 8px 10px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; }
.todo-settings-label { font-size: 12px; font-weight: 700; color: var(--dsw-alias-label-tertiary); }
.todo-settings-hint { font-size: 12px; color: var(--dsw-alias-label-tertiary); }

.todo-list { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; overflow-y: auto; }
.todo-section-title { margin: 4px 0 0; font-size: 11px; font-weight: 700; color: var(--dsw-alias-label-tertiary); text-transform: none; letter-spacing: .02em; }
.todo-empty { padding: 24px 8px; text-align: center; font-size: 12px; color: var(--dsw-alias-label-tertiary); }

.todo-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
}
.todo-item:hover { border-color: var(--dsw-alias-border-l3); }
.todo-item[data-done] { opacity: .6; }
.todo-item-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.todo-item-title { font-size: 13px; font-weight: 600; line-height: 1.35; overflow-wrap: anywhere; }
.todo-item[data-done] .todo-item-title { text-decoration: line-through; }
.todo-item-note { font-size: 12px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; white-space: pre-wrap; }
.todo-item-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.todo-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: 11px; border: 1px solid var(--todo-accent, var(--dsw-alias-border-l2)); color: var(--todo-accent, var(--dsw-alias-label-secondary)); background: transparent; }
.todo-badge[data-style='info'] { --todo-accent: var(--dsw-alias-state-business-primary); }
.todo-badge[data-style='success'] { --todo-accent: var(--dsw-alias-state-success-primary); }
.todo-badge[data-style='warning'] { --todo-accent: var(--dsw-alias-state-warn-primary); }
.todo-badge[data-style='danger'] { --todo-accent: var(--dsw-alias-state-error-primary); }

.todo-actions { display: flex; align-items: center; gap: 4px; flex: none; }
.todo-btn {
  display: inline-flex; align-items: center; justify-content: center;
  height: 26px; padding: 0 10px;
  background: transparent; border: none; border-radius: 6px;
  color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 12px; white-space: nowrap;
}
.todo-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.todo-btn.primary { color: #fff; background: var(--dsw-alias-button-info-fill); padding: 0 12px; font-weight: 600; }
.todo-btn.primary:hover { background: var(--dsw-alias-button-info-hover); }
.todo-btn.danger:hover { color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-state-error-secondary); }
.todo-btn[disabled] { opacity: .5; cursor: default; }

/* --- 提醒 toast ---------------------------------------------------------- */
.todo-toast-stack {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 1400;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(360px, calc(100vw - 32px));
  pointer-events: none;
}
.todo-toast {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--todo-accent, var(--dsw-alias-border-l2));
  border-left-width: 4px;
  border-radius: 10px;
  box-shadow: var(--dsw-shadow-lv3);
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);
  animation: todo-toast-in 220ms ease;
}
.todo-toast[data-style='info'] { --todo-accent: var(--dsw-alias-state-business-primary); }
.todo-toast[data-style='success'] { --todo-accent: var(--dsw-alias-state-success-primary); }
.todo-toast[data-style='warning'] { --todo-accent: var(--dsw-alias-state-warn-primary); }
.todo-toast[data-style='danger'] { --todo-accent: var(--dsw-alias-state-error-primary); animation: todo-toast-in 220ms ease, todo-toast-pulse 1.6s ease-in-out infinite; }
.todo-toast-head { display: flex; align-items: center; gap: 8px; }
.todo-toast-icon { font-size: 16px; line-height: 1; }
.todo-toast-title { flex: 1; min-width: 0; font-size: 13px; font-weight: 700; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.todo-toast-sub { font-size: 11px; color: var(--todo-accent, var(--dsw-alias-label-tertiary)); }
.todo-toast-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
@keyframes todo-toast-in { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: none; } }
@keyframes todo-toast-pulse { 0%,100% { box-shadow: var(--dsw-shadow-lv3); } 50% { box-shadow: 0 0 0 3px var(--todo-accent, transparent); } }

/* --- 确认弹窗 ------------------------------------------------------------ */
.todo-modal-backdrop {
  position: fixed; inset: 0; z-index: 1500;
  display: flex; align-items: center; justify-content: center;
  background: var(--dsw-alias-bg-mask-1);
}
.todo-modal {
  display: flex; flex-direction: column; gap: 12px;
  width: min(440px, calc(100vw - 48px));
  padding: 18px;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  box-shadow: var(--dsw-shadow-lv3);
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);
}
.todo-modal-title { margin: 0; font-size: 15px; font-weight: 700; }
.todo-modal-message { margin: 0; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.todo-modal-footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }

/* --- DSH 会话活动悬浮球（独立模块，不含待办内容） ------------------------ */
.todo-ball {
  position: fixed;
  z-index: 1340;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
  box-shadow: var(--dsw-shadow-lv2);
  cursor: grab;
  user-select: none;
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);
  touch-action: none;
  --ball-accent: var(--dsw-alias-label-tertiary);
}
.todo-ball:active { cursor: grabbing; }
.todo-ball-icon { font-size: 18px; line-height: 1; pointer-events: none; }
.todo-ball-badge {
  position: absolute;
  top: -4px; right: -4px;
  min-width: 16px; height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--dsw-alias-state-business-primary);
  color: #fff;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
  font-weight: 700;
  pointer-events: none;
}
.todo-ball[data-phase='thinking'] { --ball-accent: var(--dsw-alias-state-business-primary); }
.todo-ball[data-phase='tool'] { --ball-accent: var(--dsw-alias-state-warn-primary); }
.todo-ball[data-phase='done'] { --ball-accent: var(--dsw-alias-state-success-primary); }
.todo-ball[data-active] {
  border-color: var(--ball-accent);
  animation: todo-ball-glow 1.6s ease-in-out infinite;
}
@keyframes todo-ball-glow {
  0%, 100% { box-shadow: var(--dsw-shadow-lv2); }
  50% { box-shadow: 0 0 0 4px var(--ball-accent); }
}
.todo-ball-panel {
  position: fixed;
  z-index: 1340;
  width: 300px;
  max-height: 380px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  box-shadow: var(--dsw-shadow-lv3);
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);
  overflow-y: auto;
  /* 这是个控件面板而非文档：默认箭头指针，避免鼠标移到文字上变成输入光标。 */
  cursor: default;
  user-select: none;
}
.todo-ball-panel-head { display: flex; align-items: center; gap: 8px; }
.todo-ball-panel-title { margin: 0; font-size: 14px; font-weight: 700; flex: 1; }
.todo-ball-row { display: flex; align-items: center; gap: 6px; padding: 6px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.todo-ball-row:last-child { border-bottom: none; }
.todo-ball-row-icon { flex: none; font-size: 13px; }
.todo-ball-row-title { flex: 1; min-width: 0; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.todo-ball-row-state { flex: none; font-size: 11px; color: var(--dsw-alias-label-tertiary); max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.todo-ball-row[data-navigable] {
  margin: 0 -6px;
  padding: 6px;
  border-radius: 7px;
  cursor: pointer;
}
.todo-ball-row[data-navigable]:hover { background: var(--dsw-alias-fill-secondary); }
.todo-ball-row[data-navigable]:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }
.todo-ball-row-go { flex: none; font-size: 14px; color: var(--dsw-alias-label-tertiary); }
.todo-ball-empty { padding: 16px 4px; text-align: center; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.todo-ball-actions { display: flex; gap: 6px; flex-wrap: wrap; padding-top: 4px; }
.todo-ball-mini { flex: none; padding: 2px 8px; font-size: 11px; }

/* --- 个人待办 Dock（右侧边缘吸附，可收起） ------------------------------- */
.todo-dock {
  position: fixed;
  right: 0;
  /* 硬上限：任何情况下都不许长标题把 Dock 撑开（收起/展开两态共用）。 */
  max-width: min(340px, 82vw);
  z-index: 1350;
  display: flex;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
  border-right: none;
  box-shadow: var(--dsw-shadow-lv3);
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);
  touch-action: none;
}
/* 收起态：贴边药丸，直接显示下一件要做的事。 */
.todo-dock[data-collapsed='true'] {
  flex-direction: row;
  align-items: center;
  gap: 7px;
  max-width: 220px;
  padding: 7px 10px 7px 13px;
  border-radius: 999px 0 0 999px;
  box-shadow: var(--dsw-shadow-lv2);
  cursor: pointer;
  user-select: none;
}
.todo-dock[data-collapsed='true']:hover { background: var(--dsw-alias-fill-secondary); }
/* 悬停 / 快到点时探出：显示标题（宽度另有内联 style 兜底）。 */
.todo-dock[data-collapsed='true'][data-peek='true'] { max-width: 344px; }
/* 展开态：右侧待办面板。 */
.todo-dock[data-collapsed='false'] {
  flex-direction: column;
  gap: 8px;
  width: 320px;
  padding: 12px;
  border-radius: 12px 0 0 12px;
  /* 同上：控件面板用箭头指针，文字不做选中。 */
  cursor: default;
  user-select: none;
}
/* 表单控件恢复自身的输入光标与可选中，不受面板的 user-select: none 影响。 */
.todo-dock input, .todo-dock select, .todo-dock textarea { cursor: auto; user-select: auto; }
.todo-dock[data-overdue='true'] { border-color: var(--dsw-alias-state-error-primary); }
.todo-dock[data-collapsed='true'][data-overdue='true'] { animation: todo-dock-pulse 1.8s ease-in-out infinite; }
@keyframes todo-dock-pulse {
  0%, 100% { box-shadow: var(--dsw-shadow-lv2); }
  50% { box-shadow: 0 0 0 4px var(--dsw-alias-state-error-primary); }
}

.todo-dock-icon { flex: none; font-size: 14px; line-height: 1; }
.todo-dock-time { flex: none; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
.todo-dock-time[data-overdue='true'] { color: var(--dsw-alias-state-error-primary); }
.todo-dock-next { flex: 1; min-width: 0; max-width: 150px; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.todo-dock-idle { flex: none; font-size: 12px; color: var(--dsw-alias-label-tertiary); }

.todo-dock-head { display: flex; align-items: center; gap: 8px; cursor: grab; user-select: none; }
.todo-dock-head:active { cursor: grabbing; }
.todo-dock-title { margin: 0; flex: 1; font-size: 14px; font-weight: 700; }
.todo-dock-add { display: flex; gap: 6px; }
.todo-dock-add .todo-input { flex: 1; min-width: 0; }
.todo-dock-when { flex: none; width: 96px; }
.todo-dock-body { display: flex; flex-direction: column; overflow-y: auto; max-height: 46vh; }
.todo-dock-section { padding: 6px 2px 2px; font-size: 11px; font-weight: 700; letter-spacing: .02em; color: var(--dsw-alias-label-tertiary); }
.todo-dock-row { display: flex; align-items: center; gap: 7px; padding: 6px 2px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.todo-dock-row:last-child { border-bottom: none; }
.todo-dock-check {
  flex: none;
  width: 17px; height: 17px;
  padding: 0;
  border: 1.5px solid var(--dsw-alias-border-l3);
  border-radius: 50%;
  background: transparent;
  color: transparent;
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
}
.todo-dock-check:hover { border-color: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-state-success-primary); }
.todo-dock-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.todo-dock-row-title { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.todo-dock-row-due { font-size: 11px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.todo-dock-row[data-overdue='true'] .todo-dock-row-due { color: var(--dsw-alias-state-error-primary); font-weight: 700; }
.todo-dock-row-actions { flex: none; display: flex; gap: 4px; opacity: 0; transition: opacity .12s ease; }
.todo-dock-row:hover .todo-dock-row-actions, .todo-dock-row:focus-within .todo-dock-row-actions { opacity: 1; }
.todo-dock-mini { flex: none; padding: 2px 7px; font-size: 11px; }
.todo-dock-empty { padding: 14px 4px; text-align: center; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary); }
.todo-dock-foot { display: flex; gap: 6px; flex-wrap: wrap; }
.todo-settings-group {
  padding: 10px 2px 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--dsw-alias-label-secondary);
}
.todo-range { flex: none; width: 96px; accent-color: var(--dsw-alias-state-business-primary); cursor: pointer; }

@media (prefers-reduced-motion: reduce) {
  .todo-toast { animation: none; }
  .todo-toast[data-style='danger'] { animation: none; }
  .todo-dock[data-collapsed='true'][data-overdue='true'] { animation: none; }
  .todo-ball[data-active] { animation: none; }
}
`;
		/** 注入样式（幂等）。 */
		function injectStyles() {
			document.querySelectorAll("style[data-dsh-todo-css]").forEach((el) => el.remove());
			const style = document.createElement("style");
			style.dataset.dshTodoCss = "";
			style.textContent = TODO_CSS;
			document.head.appendChild(style);
		}
		//#endregion
		//#region src/types.ts
		const REMINDER_STYLES = [
			"info",
			"success",
			"warning",
			"danger"
		];
		const DEFAULT_TODO_SETTINGS = {
			soundByStyle: {
				info: true,
				success: true,
				warning: true,
				danger: true
			},
			snoozeMinutes: [
				5,
				15,
				60
			],
			sound: {
				inPage: true,
				volume: .7,
				dangerRepeat: 3
			},
			dock: {
				enabled: true,
				showNext: true
			}
		};
		//#endregion
		//#region src/client/TodoDock.tsx
		/**
		* 个人待办 Dock：贴在窗口右侧边缘的常驻小窗，只管你自己的待办事项，与 DSH 会话无关。
		* 收起时是一枚贴边药丸，直接显示下一件要做的事（到期时间 + 标题），逾期变红并脉动；
		* 展开是待办清单，可快速添加、勾完成、稍后提醒。垂直位置可拖动，收起/展开与位置都
		* 记在 localStorage。DSH 活跃会话默认完全不显示，需要时才在设置里打开。
		* @module dsh-todo-reminder/client/TodoDock
		*/
		const Y_KEY = "dsh.todoReminder.dockY";
		const COLLAPSED_KEY = "dsh.todoReminder.dockCollapsed";
		/** 到期文案每 30 秒刷新一次，避免「还有 5 分钟」长期不动。 */
		const CLOCK_MS = 3e4;
		/** 距到期 ≤ 这个时间就自动探出（不用鼠标也知道该动了）。 */
		const DUE_SOON_MS = 6e5;
		const EDGE = 8;
		/** 快速添加时可选的提醒时机。 */
		const WHEN_OPTIONS = [
			{
				value: "none",
				label: "不提醒"
			},
			{
				value: "10",
				label: "10 分钟后"
			},
			{
				value: "30",
				label: "30 分钟后"
			},
			{
				value: "60",
				label: "1 小时后"
			},
			{
				value: "180",
				label: "3 小时后"
			},
			{
				value: "tomorrow",
				label: "明天 9:00"
			}
		];
		/** 把选项换算成到期时间戳；'none' 表示不提醒。 */
		function resolveWhen(value, now) {
			if (value === "none") return void 0;
			if (value === "tomorrow") {
				const d = new Date(now);
				d.setDate(d.getDate() + 1);
				d.setHours(9, 0, 0, 0);
				return d.getTime();
			}
			const minutes = Number(value);
			return Number.isFinite(minutes) ? now + minutes * 6e4 : void 0;
		}
		function pad(n) {
			return String(n).padStart(2, "0");
		}
		/** 判断两个时间戳是否同一天。 */
		function sameDay(a, b) {
			return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
		}
		/** 收起态药丸上的紧凑时间：今天只给时分，明天/更远带日期前缀。 */
		function shortTime(dueAt, now) {
			const due = new Date(dueAt);
			const today = new Date(now);
			const tomorrow = new Date(now);
			tomorrow.setDate(tomorrow.getDate() + 1);
			if (sameDay(due, today)) return `${pad(due.getHours())}:${pad(due.getMinutes())}`;
			if (sameDay(due, tomorrow)) return `明天 ${pad(due.getHours())}:${pad(due.getMinutes())}`;
			return `${due.getMonth() + 1}/${due.getDate()}`;
		}
		/** 清单里的到期文案（逾期给出已过多久）。 */
		function dueLabel(dueAt, now) {
			const due = new Date(dueAt);
			const clock = `${pad(due.getHours())}:${pad(due.getMinutes())}`;
			if (dueAt <= now) {
				const minutes = Math.max(1, Math.round((now - dueAt) / 6e4));
				return minutes < 60 ? `已逾期 ${minutes} 分钟` : `已逾期 ${Math.round(minutes / 60)} 小时`;
			}
			const today = new Date(now);
			const tomorrow = new Date(now);
			tomorrow.setDate(tomorrow.getDate() + 1);
			if (sameDay(due, today)) return `今天 ${clock}`;
			if (sameDay(due, tomorrow)) return `明天 ${clock}`;
			return `${due.getMonth() + 1}月${due.getDate()}日 ${clock}`;
		}
		function loadCollapsed() {
			try {
				return localStorage.getItem(COLLAPSED_KEY) !== "false";
			} catch {
				return true;
			}
		}
		function loadY() {
			try {
				const raw = localStorage.getItem(Y_KEY);
				const value = raw === null ? NaN : Number(raw);
				if (Number.isFinite(value)) return value;
			} catch {}
			return Math.round(window.innerHeight * .45);
		}
		/** 收起态标题：超长截断（宽度另有 CSS 硬上限兜底）。 */
		function clip(title, max = 22) {
			return title.length > max ? `${title.slice(0, max)}…` : title;
		}
		function TodoDock() {
			const { data } = (0, react.useSyncExternalStore)(todoStore.subscribe, todoStore.getSnapshot);
			const [collapsed, setCollapsed] = (0, react.useState)(loadCollapsed);
			const [y, setY] = (0, react.useState)(loadY);
			const [now, setNow] = (0, react.useState)(() => Date.now());
			const [draft, setDraft] = (0, react.useState)("");
			const [when, setWhen] = (0, react.useState)("none");
			const [busy, setBusy] = (0, react.useState)(false);
			/** 鼠标是否停在收起态药丸上（停住就探出看标题）。 */
			const [hovered, setHovered] = (0, react.useState)(false);
			const rootRef = (0, react.useRef)(null);
			const yRef = (0, react.useRef)(y);
			const drag = (0, react.useRef)(null);
			const dock = data?.settings.dock ?? DEFAULT_TODO_SETTINGS.dock;
			const snoozeMinutes = data?.settings.snoozeMinutes ?? DEFAULT_TODO_SETTINGS.snoozeMinutes;
			const reminders = data?.reminders ?? [];
			const pending = (data?.todos ?? []).filter((t) => !t.done);
			const sorted = [...pending].sort((a, b) => {
				if (a.dueAt !== void 0 && b.dueAt !== void 0) return a.dueAt - b.dueAt;
				if (a.dueAt !== void 0) return -1;
				if (b.dueAt !== void 0) return 1;
				return b.createdAt - a.createdAt;
			});
			const next = sorted[0];
			const reminderByTodo = new Map(reminders.map((r) => [r.todoId, r]));
			const overdue = reminders.length > 0 || sorted.some((t) => t.dueAt !== void 0 && t.dueAt <= now);
			/** 下一件已经快到点（含逾期）：收起态自动探出。 */
			const soon = next !== void 0 && next.dueAt !== void 0 && next.dueAt - now <= DUE_SOON_MS;
			const clampY = (0, react.useCallback)((value) => {
				const height = rootRef.current?.offsetHeight ?? 48;
				return Math.max(EDGE, Math.min(value, Math.max(EDGE, window.innerHeight - height - EDGE)));
			}, []);
			const commitY = (0, react.useCallback)((value) => {
				yRef.current = value;
				setY(value);
				try {
					localStorage.setItem(Y_KEY, String(value));
				} catch {}
			}, []);
			(0, react.useEffect)(() => {
				const timer = window.setInterval(() => {
					setNow(Date.now());
				}, CLOCK_MS);
				return () => {
					window.clearInterval(timer);
				};
			}, []);
			(0, react.useEffect)(() => {
				const fit = () => {
					const fitted = clampY(yRef.current);
					if (fitted !== yRef.current) commitY(fitted);
				};
				fit();
				window.addEventListener("resize", fit);
				return () => {
					window.removeEventListener("resize", fit);
				};
			}, [
				clampY,
				commitY,
				collapsed
			]);
			const toggleCollapsed = (0, react.useCallback)((value) => {
				setCollapsed(value);
				try {
					localStorage.setItem(COLLAPSED_KEY, String(value));
				} catch {}
			}, []);
			const onPointerDown = (event) => {
				const target = event.target;
				if (target !== null && target.closest("button, input, select, textarea, a") !== null) return;
				drag.current = {
					startY: event.clientY,
					moved: false
				};
				event.currentTarget.setPointerCapture(event.pointerId);
			};
			const onPointerMove = (event) => {
				if (drag.current === null) return;
				const dy = event.clientY - drag.current.startY;
				if (Math.abs(dy) > 4) drag.current.moved = true;
				if (drag.current.moved) {
					commitY(clampY(yRef.current + dy));
					drag.current.startY = event.clientY;
				}
			};
			const finishDrag = (event) => {
				const state = drag.current;
				drag.current = null;
				try {
					event.currentTarget.releasePointerCapture(event.pointerId);
				} catch {}
				return state !== null && state.moved;
			};
			const onPointerUp = (event) => {
				if (!finishDrag(event) && collapsed) toggleCollapsed(false);
			};
			const onPointerCancel = (event) => {
				finishDrag(event);
				commitY(clampY(yRef.current));
			};
			const submit = async () => {
				const title = draft.trim();
				if (title === "" || busy) return;
				setBusy(true);
				try {
					await todoStore.addTodo({
						title,
						note: "",
						dueAt: resolveWhen(when, Date.now()),
						reminderStyle: "info",
						confirmOnComplete: false
					});
					setDraft("");
					setWhen("none");
				} finally {
					setBusy(false);
				}
			};
			const renderRow = (todo) => {
				const isOverdue = todo.dueAt !== void 0 && todo.dueAt <= now;
				const reminder = reminderByTodo.get(todo.id);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "todo-dock-row",
					"data-overdue": isOverdue ? "true" : void 0,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "todo-dock-check",
							title: "标记完成",
							"aria-label": `完成 ${todo.title}`,
							onClick: () => void todoStore.completeTodo(todo),
							children: "✓"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "todo-dock-row-main",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "todo-dock-row-title",
								title: todo.title,
								children: todo.title
							}), todo.dueAt !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "todo-dock-row-due",
								children: dueLabel(todo.dueAt, now)
							}) : null]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "todo-dock-row-actions",
							children: [reminder !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "todo-btn todo-dock-mini",
								title: `稍后 ${snoozeMinutes[0] ?? 10} 分钟再提醒`,
								onClick: () => void todoStore.snooze(reminder, snoozeMinutes[0] ?? 10),
								children: "稍后"
							}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "todo-btn danger todo-dock-mini",
								title: "删除这条待办",
								onClick: () => void todoStore.removeTodo(todo.id),
								children: "✕"
							})]
						})
					]
				}, todo.id);
			};
			if (!dock.enabled) return null;
			if (collapsed) {
				const label = next === void 0 ? "暂无待办" : `${next.title}${next.dueAt !== void 0 ? `（${dueLabel(next.dueAt, now)}）` : ""}`;
				const peek = hovered || soon;
				const showTitle = peek && dock.showNext;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					ref: rootRef,
					className: "todo-dock",
					"data-collapsed": "true",
					"data-peek": peek ? "true" : void 0,
					"data-overdue": overdue ? "true" : void 0,
					style: {
						top: y,
						position: "fixed",
						right: 0,
						display: "flex",
						maxWidth: showTitle ? 344 : 132,
						overflow: "hidden"
					},
					role: "button",
					tabIndex: 0,
					"aria-label": `待办：${label}`,
					title: `${label}\n点击展开清单 · 上下拖动可移动`,
					onPointerEnter: () => setHovered(true),
					onPointerLeave: () => setHovered(false),
					onPointerDown,
					onPointerMove,
					onPointerUp,
					onPointerCancel,
					onKeyDown: (event) => {
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							toggleCollapsed(false);
						}
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "todo-dock-icon",
							style: { flex: "none" },
							children: overdue ? "⏰" : "📋"
						}),
						next?.dueAt !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "todo-dock-time",
							style: { flex: "none" },
							"data-overdue": next.dueAt <= now ? "true" : void 0,
							children: shortTime(next.dueAt, now)
						}) : null,
						showTitle ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "todo-dock-next",
							style: {
								minWidth: 0,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap"
							},
							children: next === void 0 ? "无待办" : clip(next.title, 48)
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "todo-dock-idle",
							style: { flex: "none" },
							children: pending.length
						})
					]
				});
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: rootRef,
				className: "todo-dock",
				"data-collapsed": "false",
				"data-overdue": overdue ? "true" : void 0,
				style: {
					top: y,
					maxWidth: 340,
					overflow: "hidden"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "todo-dock-head",
						onPointerDown,
						onPointerMove,
						onPointerUp,
						onPointerCancel,
						title: "拖动可上下移动",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "todo-dock-icon",
								children: overdue ? "⏰" : "📋"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", {
								className: "todo-dock-title",
								children: ["待办 ", pending.length > 0 ? `(${pending.length})` : ""]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "todo-btn todo-dock-mini",
								title: "收起到边缘",
								"aria-label": "收起",
								onClick: () => toggleCollapsed(true),
								children: "›"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "todo-dock-add",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "todo-input",
							placeholder: "要做什么？回车添加",
							value: draft,
							onChange: (event) => setDraft(event.target.value),
							onKeyDown: (event) => {
								if (event.key === "Enter") submit();
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
							className: "todo-select todo-dock-when",
							value: when,
							onChange: (event) => setWhen(event.target.value),
							title: "什么时候提醒",
							children: WHEN_OPTIONS.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: option.value,
								children: option.label
							}, option.value))
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "todo-dock-body",
						children: sorted.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "todo-dock-empty",
							children: [
								"没有待办。",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
								"上面加一条，到点会提醒你。"
							]
						}) : sorted.map(renderRow)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "todo-dock-foot",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "todo-btn todo-dock-mini",
							onClick: () => {
								todoStore.setPanel(true);
								toggleCollapsed(true);
							},
							children: "打开完整面板"
						})
					})
				]
			});
		}
		//#endregion
		//#region src/client/sound.ts
		/** 每种音色的合成序列：[频率 Hz, 相对起始秒, 时长秒]。 */
		const TONES = {
			info: [[
				880,
				0,
				.12
			], [
				1174.7,
				.13,
				.18
			]],
			success: [
				[
					659.3,
					0,
					.1
				],
				[
					880,
					.1,
					.1
				],
				[
					1318.5,
					.2,
					.24
				]
			],
			warning: [[
				740,
				0,
				.16
			], [
				587.3,
				.19,
				.26
			]],
			danger: [
				[
					932.3,
					0,
					.1
				],
				[
					698.5,
					.12,
					.1
				],
				[
					932.3,
					.24,
					.1
				],
				[
					698.5,
					.36,
					.2
				]
			]
		};
		/** 自定义音效端点。 */
		const SOUND_URL = "/api/todo/sound";
		/** 两次重复播放之间的间隔（秒）。 */
		const REPEAT_GAP = .14;
		let audioContext = null;
		let customBuffer = null;
		let probe = null;
		let unlocked = false;
		let gestureBound = false;
		function contextCtor() {
			const w = window;
			return w.AudioContext ?? w.webkitAudioContext;
		}
		function ensureContext() {
			if (audioContext !== null) return audioContext;
			const Ctor = contextCtor();
			if (Ctor === void 0) return null;
			try {
				audioContext = new Ctor();
			} catch {
				audioContext = null;
			}
			return audioContext;
		}
		/** 探测自定义音效文件；404 / 解码失败则继续用合成音。 */
		async function probeSound() {
			if (probe !== null) return probe;
			const ctx = ensureContext();
			if (ctx === null) return;
			probe = (async () => {
				try {
					const response = await fetch(SOUND_URL, { cache: "no-store" });
					if (!response.ok) return;
					customBuffer = await ctx.decodeAudioData(await response.arrayBuffer());
				} catch {
					customBuffer = null;
				}
			})();
			return probe;
		}
		function unlock() {
			const ctx = ensureContext();
			if (ctx === null) return;
			if (ctx.state === "suspended") ctx.resume().catch(() => {});
			unlocked = true;
			probeSound();
		}
		/**
		* 挂手势监听自动解锁音频（浏览器自动播放策略）。
		* @returns 解除监听的 disposer。
		*/
		function armSoundUnlock() {
			if (gestureBound) return () => {};
			gestureBound = true;
			const events = [
				"pointerdown",
				"keydown",
				"touchstart"
			];
			const onGesture = () => {
				unlock();
			};
			for (const event of events) document.addEventListener(event, onGesture, {
				capture: true,
				passive: true
			});
			return () => {
				for (const event of events) document.removeEventListener(event, onGesture, { capture: true });
				gestureBound = false;
			};
		}
		/** 调度一段合成音；返回这段音的总时长（秒）。 */
		function scheduleSynth(ctx, tone, volume, startAt) {
			let span = 0;
			for (const [frequency, offset, duration] of TONES[tone]) {
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				osc.type = "sine";
				osc.frequency.value = frequency;
				const t0 = startAt + offset;
				const t1 = t0 + duration;
				gain.gain.setValueAtTime(1e-4, t0);
				gain.gain.exponentialRampToValueAtTime(Math.max(2e-4, volume), t0 + .012);
				gain.gain.exponentialRampToValueAtTime(1e-4, t1);
				osc.connect(gain).connect(ctx.destination);
				osc.start(t0);
				osc.stop(t1 + .02);
				span = Math.max(span, offset + duration);
			}
			return span;
		}
		/** 调度一次自定义音效播放；返回时长（秒）。 */
		function scheduleBuffer(ctx, buffer, volume, startAt) {
			const source = ctx.createBufferSource();
			const gain = ctx.createGain();
			source.buffer = buffer;
			gain.gain.value = volume;
			source.connect(gain).connect(ctx.destination);
			source.start(startAt);
			return buffer.duration;
		}
		/**
		* 播放一次待办提醒音。
		* @param tone - 音色（合成音时生效）。
		* @param volume - 音量 0..1。
		* @param repeat - 连响次数（1..5）。
		* @returns 是否已成功调度（音频未解锁 / 不支持时返回 false）。
		*/
		function playSound(tone, volume, repeat = 1) {
			const ctx = ensureContext();
			if (ctx === null) return false;
			if (ctx.state === "suspended") ctx.resume().catch(() => {});
			if (!unlocked && ctx.state !== "running") return false;
			const vol = Math.min(1, Math.max(0, volume));
			if (vol === 0) return false;
			const times = Math.min(5, Math.max(1, Math.round(repeat)));
			const buffer = customBuffer;
			let cursor = ctx.currentTime + .02;
			for (let i = 0; i < times; i += 1) {
				const span = buffer !== null ? scheduleBuffer(ctx, buffer, vol, cursor) : scheduleSynth(ctx, tone, vol, cursor);
				cursor += span + REPEAT_GAP;
			}
			return true;
		}
		/** 试听：立即解锁（本次调用来自用户点击，必定允许出声）并播放一次。 */
		function previewSound(tone, volume, repeat = 1) {
			unlock();
			probeSound().then(() => {
				playSound(tone, volume, repeat);
			});
		}
		/** 音频是否已解锁可用；未就绪时调用方应让系统通知自己出声兜底。 */
		function isSoundReady() {
			return unlocked;
		}
		//#endregion
		//#region src/client/ReminderLayer.tsx
		/**
		* 提醒层：body 上的全局 React 根，渲染**待办**提醒 toast 栈 + 完成确认弹窗 + 待办 Dock，
		* 并通过 SSE 实时订阅 host 状态变化；标签页在后台时把新提醒转成系统原生通知
		* （切出到别的窗口也能收到）。DSH 会话的完成/审批提醒不在这里 —— 那是
		* dsh-session-attention 的事。
		* @module dsh-todo-reminder/client/ReminderLayer
		*/
		function formatTime(ms) {
			const d = new Date(ms);
			const pad = (n) => String(n).padStart(2, "0");
			return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
		}
		function ReminderToast({ reminder, snoozeMinutes }) {
			const meta = STYLE_META[reminder.style];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "todo-toast",
				"data-style": reminder.style,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "todo-toast-head",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "todo-toast-icon",
							children: meta.icon
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "todo-toast-title",
							children: reminder.title
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "todo-toast-sub",
							children: formatTime(reminder.firedAt)
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "todo-toast-actions",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "todo-btn primary",
							onClick: () => {
								const todo = todoStore.getSnapshot().data?.todos.find((t) => t.id === reminder.todoId);
								if (todo !== void 0) todoStore.completeTodo(todo, reminder.id);
								else todoStore.dismissReminder(reminder.id);
							},
							children: "完成"
						}),
						snoozeMinutes.map((minutes) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "todo-btn",
							onClick: () => void todoStore.snooze(reminder, minutes),
							children: [
								"稍后",
								minutes,
								"分钟"
							]
						}, minutes)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "todo-btn",
							onClick: () => void todoStore.dismissReminder(reminder.id),
							children: "忽略"
						})
					]
				})]
			}, reminder.id);
		}
		function ConfirmDialog() {
			const { confirming } = (0, react.useSyncExternalStore)(todoStore.subscribe, todoStore.getSnapshot);
			if (confirming === null) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "todo-modal-backdrop",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "todo-modal",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							className: "todo-modal-title",
							children: "确认完成"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "todo-modal-message",
							children: [
								"确定完成「",
								confirming.todo.title,
								"」吗？"
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "todo-modal-footer",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "todo-btn",
								onClick: () => todoStore.cancelConfirm(),
								children: "取消"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "todo-btn primary",
								onClick: () => void todoStore.confirmComplete(),
								children: "确认完成"
							})]
						})
					]
				})
			});
		}
		function ReminderLayer() {
			const { activeReminders, freshReminders, data } = (0, react.useSyncExternalStore)(todoStore.subscribe, todoStore.getSnapshot);
			const soundByStyle = data?.settings.soundByStyle ?? DEFAULT_TODO_SETTINGS.soundByStyle;
			const snoozeMinutes = data?.settings.snoozeMinutes ?? DEFAULT_TODO_SETTINGS.snoozeMinutes;
			const soundSettings = data?.settings.sound ?? DEFAULT_TODO_SETTINGS.sound;
			(0, react.useEffect)(() => armSoundUnlock(), []);
			(0, react.useEffect)(() => {
				if (freshReminders.length === 0 || !soundSettings.inPage) return;
				for (const reminder of freshReminders) {
					if (soundByStyle[reminder.style] === false) continue;
					playSound(reminder.style, soundSettings.volume, reminder.style === "danger" ? soundSettings.dangerRepeat : 1);
				}
			}, [
				freshReminders,
				soundByStyle,
				soundSettings
			]);
			(0, react.useEffect)(() => {
				const es = new EventSource("/api/todo/events");
				es.onmessage = (event) => {
					try {
						const message = JSON.parse(event.data);
						if (message.type === "state" && message.state !== void 0) todoStore.applyState(message.state);
					} catch {}
				};
				const onVisibility = () => {
					if (document.visibilityState === "visible") todoStore.refresh();
				};
				document.addEventListener("visibilitychange", onVisibility);
				return () => {
					es.close();
					document.removeEventListener("visibilitychange", onVisibility);
				};
			}, []);
			(0, react.useEffect)(() => {
				if (typeof Notification === "undefined") return;
				if (Notification.permission === "default") Notification.requestPermission().catch(() => {});
			}, []);
			(0, react.useEffect)(() => {
				if (freshReminders.length === 0) return;
				if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
				if (document.visibilityState !== "hidden") return;
				for (const reminder of freshReminders) {
					const meta = STYLE_META[reminder.style];
					try {
						new Notification(`${meta.icon} ${meta.label}：${reminder.title}`, {
							body: "点击回到 DSH 处理（完成 / 稍后提醒 / 忽略）",
							tag: `dsh-todo-${reminder.id}`,
							silent: soundSettings.inPage && isSoundReady() ? true : soundByStyle[reminder.style] === false
						});
					} catch {}
				}
			}, [
				freshReminders,
				soundByStyle,
				soundSettings
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				activeReminders.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "todo-toast-stack",
					children: activeReminders.map((reminder) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReminderToast, {
						reminder,
						snoozeMinutes
					}, reminder.id))
				}) : null,
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConfirmDialog, {}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TodoDock, {})
			] });
		}
		//#endregion
		//#region src/client/TodoPanel.tsx
		/**
		* Todo 面板：新建表单 + 待办/已完成列表 + 完成（含确认）/ 删除。
		* @module dsh-todo-reminder/client/TodoPanel
		*/
		/** 把 datetime-local 字符串转 epoch ms（无效返回 undefined）。 */
		function toEpoch(value) {
			if (value === "") return void 0;
			const ms = new Date(value).getTime();
			return Number.isFinite(ms) ? ms : void 0;
		}
		function formatDue(ms) {
			const d = new Date(ms);
			const pad = (n) => String(n).padStart(2, "0");
			return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
		}
		function TodoPanel() {
			const { data } = (0, react.useSyncExternalStore)(todoStore.subscribe, todoStore.getSnapshot);
			const soundByStyle = data?.settings.soundByStyle ?? DEFAULT_TODO_SETTINGS.soundByStyle;
			const snoozeMinutes = data?.settings.snoozeMinutes ?? DEFAULT_TODO_SETTINGS.snoozeMinutes;
			const sound = data?.settings.sound ?? DEFAULT_TODO_SETTINGS.sound;
			const dock = data?.settings.dock ?? DEFAULT_TODO_SETTINGS.dock;
			const [volume, setVolume] = (0, react.useState)(sound.volume);
			const [previewStyle, setPreviewStyle] = (0, react.useState)("info");
			const [title, setTitle] = (0, react.useState)("");
			const [note, setNote] = (0, react.useState)("");
			const [dueAt, setDueAt] = (0, react.useState)("");
			const [style, setStyle] = (0, react.useState)("info");
			const [confirm, setConfirm] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(false);
			const [snoozeText, setSnoozeText] = (0, react.useState)("");
			const [notifPermission, setNotifPermission] = (0, react.useState)(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
			(0, react.useEffect)(() => {
				if (typeof Notification === "undefined") return;
				setNotifPermission(Notification.permission);
			}, []);
			const requestNotification = async () => {
				if (typeof Notification === "undefined") return;
				try {
					const permission = await Notification.requestPermission();
					setNotifPermission(permission);
				} catch {
					setNotifPermission(Notification.permission);
				}
			};
			(0, react.useEffect)(() => {
				setVolume(sound.volume);
			}, [sound.volume]);
			const commitVolume = () => {
				if (volume !== sound.volume) todoStore.setSound({ volume });
			};
			(0, react.useEffect)(() => {
				setSnoozeText(snoozeMinutes.join(","));
			}, [snoozeMinutes]);
			const commitSnooze = () => {
				const numbers = snoozeText.split(/[^0-9]+/).map((s) => Number(s)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 1440);
				const unique = [...new Set(numbers)].sort((a, b) => a - b);
				const next = unique.length > 0 ? unique : DEFAULT_TODO_SETTINGS.snoozeMinutes;
				setSnoozeText(next.join(","));
				todoStore.setSnoozeMinutes(next);
			};
			const todos = data?.todos ?? [];
			const pending = todos.filter((t) => !t.done);
			const done = todos.filter((t) => t.done);
			const submit = async () => {
				const trimmed = title.trim();
				if (trimmed === "" || busy) return;
				setBusy(true);
				try {
					await todoStore.addTodo({
						title: trimmed,
						note: note.trim(),
						dueAt: toEpoch(dueAt),
						reminderStyle: style,
						confirmOnComplete: confirm
					});
					setTitle("");
					setNote("");
					setDueAt("");
					setStyle("info");
					setConfirm(false);
				} finally {
					setBusy(false);
				}
			};
			const renderItem = (todo) => {
				const meta = STYLE_META[todo.reminderStyle];
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "todo-item",
					"data-done": todo.done ? "true" : void 0,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "todo-item-main",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "todo-item-title",
								children: todo.title
							}),
							todo.note !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "todo-item-note",
								children: todo.note
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "todo-item-meta",
								children: [todo.dueAt !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "todo-badge",
									"data-style": todo.reminderStyle,
									children: [
										meta.icon,
										" ",
										meta.label,
										" · ",
										formatDue(todo.dueAt)
									]
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "todo-badge",
									"data-style": todo.reminderStyle,
									children: [
										meta.icon,
										" ",
										meta.label
									]
								}), todo.confirmOnComplete ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "完成需确认" }) : null]
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "todo-actions",
						children: [!todo.done ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "todo-btn primary",
							onClick: () => void todoStore.completeTodo(todo),
							children: "完成"
						}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "todo-btn danger",
							title: "删除",
							onClick: () => void todoStore.removeTodo(todo.id),
							children: "删除"
						})]
					})]
				}, todo.id);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "todo-panel",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "todo-header",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								className: "todo-title",
								children: "待办提醒"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "todo-count",
								children: [
									pending.length,
									" 待办 · ",
									done.length,
									" 已完成"
								]
							}),
							notifPermission !== "granted" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "todo-btn",
								onClick: () => void requestNotification(),
								title: "开启后，切出到别的窗口也能收到系统通知",
								children: notifPermission === "denied" ? "系统通知已阻止" : "开启系统通知"
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "todo-btn",
								title: "关闭面板（Esc 也可以）",
								"aria-label": "关闭",
								onClick: () => todoStore.setPanel(false),
								children: "✕"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "todo-settings-group",
						children: "📋 个人待办 —— 你自己的事情"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "todo-settings",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "todo-settings-label",
								children: "响铃样式"
							}),
							REMINDER_STYLES.map((s) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "todo-check",
								title: `${STYLE_META[s].label}：这类待办提醒是否出声`,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: soundByStyle[s],
										onChange: (e) => void todoStore.setSoundByStyle(s, e.target.checked)
									}),
									STYLE_META[s].icon,
									" ",
									STYLE_META[s].label
								]
							}, s)),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "todo-settings-label",
								children: "稍后提醒"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "todo-input",
								style: {
									width: 100,
									flex: "none"
								},
								value: snoozeText,
								onChange: (e) => setSnoozeText(e.target.value),
								onBlur: commitSnooze,
								onKeyDown: (e) => {
									if (e.key === "Enter") commitSnooze();
								},
								title: "稍后提醒的分钟数（逗号分隔，如 5,15,60）"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "todo-settings-hint",
								children: "分钟"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "todo-settings",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "todo-settings-label",
								children: "待办提醒音"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "todo-check",
								title: "开启后，标签页开着也会出声；关闭则只剩系统通知的默认提示音（且仅在切出时）",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: sound.inPage,
									onChange: (e) => void todoStore.setSound({ inPage: e.target.checked })
								}), "页面内响铃"]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "todo-settings-hint",
								children: "音量"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "todo-range",
								type: "range",
								min: 0,
								max: 100,
								step: 5,
								value: Math.round(volume * 100),
								onChange: (e) => setVolume(Number(e.target.value) / 100),
								onPointerUp: commitVolume,
								onKeyUp: commitVolume,
								onBlur: commitVolume,
								title: "待办提醒音量（与会话提醒音量互相独立）"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "todo-settings-hint",
								children: [Math.round(volume * 100), "%"]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "todo-settings-hint",
								children: "紧急连响"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "todo-input",
								style: {
									width: 56,
									flex: "none"
								},
								type: "number",
								min: 1,
								max: 5,
								value: sound.dangerRepeat,
								onChange: (e) => void todoStore.setSound({ dangerRepeat: Number(e.target.value) }),
								title: "danger 样式提醒连响几次"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
								className: "todo-select",
								value: previewStyle,
								onChange: (e) => setPreviewStyle(e.target.value),
								children: REMINDER_STYLES.map((s) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
									value: s,
									children: [
										STYLE_META[s].icon,
										" ",
										STYLE_META[s].label
									]
								}, s))
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "todo-btn",
								onClick: () => previewSound(previewStyle, volume, previewStyle === "danger" ? sound.dangerRepeat : 1),
								title: "试听待办提醒音",
								children: "🔈 试听"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "todo-btn",
								title: "在文件管理器里打开音效文件所在目录",
								onClick: () => void todoStore.openSoundDir(),
								children: "📂 打开文件夹"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "todo-settings-hint",
								children: "音源 ~/.dsh/todo-reminder/sound.mp3（缺省用内置合成音）"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "todo-settings",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "todo-settings-label",
								children: "右侧待办条"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "todo-check",
								title: "窗口右侧边缘常驻的待办小窗，可收起",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: dock.enabled,
									onChange: (e) => void todoStore.setDock({ enabled: e.target.checked })
								}), "显示"]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "todo-check",
								title: "收起时直接显示下一件要做的事（到期时间 + 标题）",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: dock.showNext,
									onChange: (e) => void todoStore.setDock({ showNext: e.target.checked })
								}), "收起时显示下一条"]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "todo-form",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "todo-form-row",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "todo-input",
								placeholder: "要提醒自己什么？",
								value: title,
								onChange: (e) => setTitle(e.target.value),
								onKeyDown: (e) => {
									if (e.key === "Enter") submit();
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "todo-btn primary",
								disabled: busy || title.trim() === "",
								onClick: () => void submit(),
								children: "添加"
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "todo-form-row",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "todo-input",
									placeholder: "备注（可选）",
									value: note,
									onChange: (e) => setNote(e.target.value)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "todo-input",
									type: "datetime-local",
									title: "提醒时间",
									value: dueAt,
									style: {
										flex: "0 1 auto",
										minWidth: 190
									},
									onChange: (e) => setDueAt(e.target.value)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
									className: "todo-select",
									value: style,
									onChange: (e) => setStyle(e.target.value),
									children: REMINDER_STYLES.map((s) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
										value: s,
										children: [
											STYLE_META[s].icon,
											" ",
											STYLE_META[s].label
										]
									}, s))
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "todo-check",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: confirm,
										onChange: (e) => setConfirm(e.target.checked)
									}), "完成需确认"]
								})
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "todo-list",
						children: [
							pending.length === 0 && done.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "todo-empty",
								children: "还没有待办。添加一条，或设置提醒时间，到期后这里会弹出提醒。"
							}) : null,
							pending.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "todo-section-title",
								children: "待办"
							}) : null,
							pending.map(renderItem),
							done.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "todo-section-title",
								children: "已完成"
							}) : null,
							done.map(renderItem)
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/sidebar-entry.ts
		/**
		* 侧边栏入口：DOM 注入（shell 无对外侧边栏 slot），MutationObserver 自愈。
		* 与 task-board / ssh 的入口共处同一家族块，位置稳定。
		* @module dsh-todo-reminder/client/sidebar-entry
		*/
		/** 入口行稳定标识。 */
		const ENTRY_SELECTOR = "[data-dsh-todo-entry]";
		/**
		* 当前存活实例的清理函数。
		*
		* 客户端被重复 apply（HMR / 双重注册）时，旧实例的 MutationObserver 会在新实例接管后
		* 把旧元素重新插回去 —— 表现就是侧边栏出现两个入口。这里让新实例先干掉旧实例。
		*/
		let activeDispose;
		const ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.6v3.4l2.2 1.4"/></svg>`;
		function sidebarRoot() {
			const column = document.querySelector("[data-pane=\"sidebar\"], [class*=\"sidebarCol\"]");
			if (column === null) return void 0;
			return column.querySelector("[class*=\"logoRow\"]")?.parentElement ?? column.firstElementChild;
		}
		/**
		* 定位「新建会话」按钮。
		*
		* DSH 0.1.6 起，`newSession` 是 `logoRow` 的**兄弟节点**（AppFrame 改版后
		* sidebar root 的直接子元素），不再是 `logoRow` 的子元素；旧实现只在 `root`
		* 下找 `button[class*="newSession"]`，在 0.1.6 上必然返回 undefined，
		* 导致入口整行挂不上。这里改为「全局 → root 内 → 直接子按钮」三级回退。
		*/
		function newSessionButton(root) {
			const scopes = [document, root];
			for (const scope of scopes) {
				const found = scope.querySelector("button[class*=\"newSession\"]");
				if (found !== null) return found;
			}
			for (const child of root.children) if (child.tagName === "BUTTON") return child;
		}
		/** `newSession` 按钮的宿主父元素（入口行的实际插入容器）。 */
		function entryHost(button, fallback) {
			return button.parentElement ?? button.closest("[class*=\"logoRow\"]")?.parentElement ?? fallback;
		}
		function createEntry() {
			const entry = document.createElement("button");
			entry.type = "button";
			entry.dataset.dshTodoEntry = "";
			entry.setAttribute("aria-label", "待办");
			entry.innerHTML = `<span class="todo-entry-icon">${ICON}</span><span class="todo-entry-label">待办</span>`;
			entry.addEventListener("click", () => {
				todoStore.togglePanel();
			});
			return entry;
		}
		function placeEntry(root, entry) {
			const owners = document.querySelectorAll(ENTRY_SELECTOR);
			if (owners.length > 1 || owners.length === 1 && owners[0] !== entry) return false;
			const button = newSessionButton(root);
			if (button === void 0) return false;
			const host = entryHost(button, root);
			if (entry.parentElement !== host) {
				const family = Array.from(host.children).filter((el) => el instanceof HTMLElement && el.matches("[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-todo-entry], [data-dsh-att-entry]"));
				const anchor = family.length > 0 ? family[0] : button.nextElementSibling;
				host.insertBefore(entry, anchor);
			}
			return true;
		}
		/** 挂载入口行并绑定激活态高亮。 */
		function mountSidebarEntry() {
			activeDispose?.();
			activeDispose = void 0;
			document.querySelectorAll("[data-dsh-todo-entry]").forEach((el) => el.remove());
			const entry = createEntry();
			let root;
			let placed = false;
			const tryPlace = () => {
				const owners = document.querySelectorAll(ENTRY_SELECTOR);
				if (owners.length > 1 || owners.length === 1 && owners[0] !== entry) return;
				if (root !== void 0 && !root.isConnected) {
					rootObserver.disconnect();
					root = void 0;
					placed = false;
				}
				if (placed) {
					if (document.body.contains(entry)) return;
					rootObserver.disconnect();
					root = void 0;
					placed = false;
				}
				root ??= sidebarRoot();
				if (root === void 0) return;
				placed = placeEntry(root, entry);
				if (placed) rootObserver.observe(root, {
					childList: true,
					subtree: true
				});
			};
			/**
			* 清掉场上不属于本实例的入口。
			* 上限 20 次：万一遇到更老的、没有守卫的实例反复插回，也不会陷入无限循环。
			*/
			let sweepBudget = 20;
			const sweepForeign = () => {
				if (sweepBudget <= 0) return;
				for (const el of document.querySelectorAll(ENTRY_SELECTOR)) {
					if (el === entry) continue;
					el.remove();
					sweepBudget -= 1;
				}
			};
			const waitObserver = new MutationObserver(() => {
				sweepForeign();
				tryPlace();
			});
			waitObserver.observe(document.body, {
				childList: true,
				subtree: true
			});
			const rootObserver = new MutationObserver(() => {
				if (root === void 0 || !root.isConnected) {
					placed = false;
					tryPlace();
					return;
				}
				sweepForeign();
				if (!root.contains(entry)) placed = placeEntry(root, entry);
			});
			const syncActive = () => {
				if (todoStore.getSnapshot().panelOpen) entry.dataset.active = "true";
				else delete entry.dataset.active;
			};
			const unsubscribe = todoStore.subscribe(syncActive);
			syncActive();
			tryPlace();
			const dispose = () => {
				waitObserver.disconnect();
				rootObserver.disconnect();
				unsubscribe();
				entry.remove();
				if (activeDispose === dispose) activeDispose = void 0;
			};
			activeDispose = dispose;
			return dispose;
		}
		//#endregion
		//#region src/client/index.tsx
		/**
		* dsh-todo-reminder 浏览器半：注入样式，挂载侧边栏「待办」入口、**全局**待办面板、
		* 全局提醒层。
		*
		* 面板是**浮在页面上的全局浮层**，不再挂进会话列 —— 待办是个人清单，跟当前会话无关，
		* 任何会话下打开都是同一份内容和同一个位置。
		* 失败策略：DOM 挂载异常只记录、不抛出（外部插件不得拖垮 GUI 启动）。
		* @module dsh-todo-reminder/client
		*/
		/** 跨插件面板互斥事件（与 task-board / ssh / 会话提醒 同契约）。 */
		const ACTIVATE_EVENT = "dsh-panel-activate";
		const PANEL_NAME = "todo";
		const ACTIVE_ATTR = "data-dsh-todo-active";
		const SIBLING_ATTRS = [
			"data-dsh-attention-active",
			"data-dsh-ssh-active",
			"data-dsh-taskboard-active"
		];
		/**
		* 中心列（对话列）候选，**按优先级逐个试**。
		* 注意：querySelector 的逗号列表是「文档顺序优先」而不是「选择器顺序优先」——别的插件的外层
		* 容器只要类名带 centerCol 就会被选中，而 inset:0 的面板挂上去会盖满整个 UI。
		* 0.1.6 起 data-pane 标记被移除，回退到 centerCol / _centerCol 类名。
		*/
		const COLUMN_CANDIDATES = [
			"[data-pane=\"conversation\"]",
			"[class*=\"centerCol\"]",
			"[class*=\"_centerCol\"]"
		];
		/** 宿主标记：定位与隐藏兄弟都只作用于自己挂载的这个元素，避免误伤其他插件的同名容器。 */
		const HOST_ATTR = "data-dsh-todo-host";
		/** 应用外壳判定：含侧边栏（或本插件的侧边栏入口）的容器不是对话列，挂上去必然盖满整个 UI。 */
		function looksLikeAppShell(el) {
			if (el === document.body || el === document.documentElement) return true;
			return el.querySelector("[data-pane=\"sidebar\"], [class*=\"sidebarCol\"], [data-dsh-todo-entry], [data-dsh-att-entry]") !== null;
		}
		/** 找对话列：按优先级 + 外壳校验；找不到就返回 undefined（宁可不挂，也不盖满 UI）。 */
		function findConversationColumn() {
			for (const selector of COLUMN_CANDIDATES) for (const el of document.querySelectorAll(selector)) if (!looksLikeAppShell(el)) return el;
		}
		/**
		* 面板挂载：容器插进中心列，打开时占满它（独立页面式，与任务看板 / SSH 一致），
		* 中心列其余内容暂时隐藏；关闭后立刻回到对话。开合由 store 的 panelOpen 驱动。
		*/
		function mountPanel() {
			document.querySelectorAll("[data-dsh-todo-view]").forEach((el) => el.remove());
			document.querySelectorAll("[" + HOST_ATTR + "]").forEach((el) => el.removeAttribute(HOST_ATTR));
			let root;
			let container;
			/** 卸掉容器与宿主标记：宿主被换、面板关闭、插件卸载都会走这里。 */
			const teardown = () => {
				try {
					root?.unmount();
				} catch {}
				root = void 0;
				container?.remove();
				container = void 0;
				document.querySelectorAll("[" + HOST_ATTR + "]").forEach((el) => el.removeAttribute(HOST_ATTR));
			};
			const ensure = () => {
				if (!todoStore.getSnapshot().panelOpen) {
					if (container !== void 0) teardown();
					return;
				}
				if (container !== void 0 && container.isConnected) return;
				teardown();
				const column = findConversationColumn();
				if (column === void 0) return;
				column.setAttribute(HOST_ATTR, "");
				container = document.createElement("div");
				container.dataset.dshTodoView = "";
				column.appendChild(container);
				root = (0, react_dom_client.createRoot)(container);
				root.render(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TodoPanel, {}));
			};
			const waitObserver = new MutationObserver(() => {
				ensure();
			});
			waitObserver.observe(document.body, {
				childList: true,
				subtree: true
			});
			const applyActive = () => {
				if (todoStore.getSnapshot().panelOpen) {
					for (const attr of SIBLING_ATTRS) document.documentElement.removeAttribute(attr);
					document.documentElement.setAttribute(ACTIVE_ATTR, "");
					document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }));
				} else document.documentElement.removeAttribute(ACTIVE_ATTR);
				ensure();
			};
			const close = () => {
				if (todoStore.getSnapshot().panelOpen) todoStore.setPanel(false);
			};
			const onOtherActivate = (event) => {
				if (event.detail !== PANEL_NAME) close();
			};
			const onKeyDown = (event) => {
				if (event.key === "Escape") close();
			};
			const SIDEBAR_ROW_SELECTOR = "[class*=\"sessionRow\"], [class*=\"projectRow\"], [class*=\"searchResultRow\"], [class*=\"searchResultWorkspace\"], [class*=\"newSession\"]";
			const onClickSidebarRow = (event) => {
				const target = event.target;
				if (target === null) return;
				if (target.closest("[data-dsh-todo-entry]") !== null) return;
				if (target.closest(SIDEBAR_ROW_SELECTOR) !== null) close();
			};
			document.addEventListener("keydown", onKeyDown);
			document.addEventListener("click", onClickSidebarRow, true);
			document.addEventListener(ACTIVATE_EVENT, onOtherActivate);
			const unsubscribe = todoStore.subscribe(applyActive);
			applyActive();
			ensure();
			return () => {
				document.removeEventListener("keydown", onKeyDown);
				document.removeEventListener("click", onClickSidebarRow, true);
				document.removeEventListener(ACTIVATE_EVENT, onOtherActivate);
				waitObserver.disconnect();
				unsubscribe();
				document.documentElement.removeAttribute(ACTIVE_ATTR);
				teardown();
			};
		}
		/** 全局提醒层挂载（body 上的 React 根，跨会话常驻；含待办 Dock）。 */
		function mountReminderLayer() {
			document.querySelectorAll("[data-dsh-todo-reminder-root]").forEach((el) => el.remove());
			const container = document.createElement("div");
			container.dataset.dshTodoReminderRoot = "";
			document.body.appendChild(container);
			const root = (0, react_dom_client.createRoot)(container);
			root.render(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReminderLayer, {}));
			return () => {
				root.unmount();
				container.remove();
			};
		}
		/**
		* 声明依赖 sessions 服务：它保证本插件在客户端会话控制器就绪之后才 apply，
		* 那时 shell（侧边栏、页面骨架）已可被定位。本插件不读写会话数据，只借这条时序。
		*/
		const inject = ["sessions"];
		function apply(_ctx) {
			injectStyles();
			const disposers = [];
			try {
				disposers.push(mountSidebarEntry());
				disposers.push(mountPanel());
				disposers.push(mountReminderLayer());
			} catch (error) {
				console.error("[dsh-todo-reminder] mount failed:", error);
			}
			return () => {
				for (const dispose of disposers.splice(0)) try {
					dispose();
				} catch {}
			};
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
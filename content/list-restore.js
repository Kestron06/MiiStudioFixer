(() => {
	'use strict';

	const REQUEST_EVENT = 'mii-studio-fixer:restore-request';
	const RESULT_EVENT = 'mii-studio-fixer:restore-result';
	const CHECK_REQUEST_EVENT = 'mii-studio-fixer:restore-capacity-request';
	const CHECK_RESULT_EVENT = 'mii-studio-fixer:restore-capacity-result';
	const PENDING_KEY = 'mii-studio-fixer:pending-restore';
	const SUCCESS_KEY = 'mii-studio-fixer:restore-success';
	const SUCCESS_REQUEST_EVENT = 'mii-studio-fixer:restore-success-request';
	const SUCCESS_RESULT_EVENT = 'mii-studio-fixer:restore-success-result';
	const SUCCESS_ACK_EVENT = 'mii-studio-fixer:restore-success-ack';
	const ERROR_KEY = 'mii-studio-fixer:restore-error';
	const DATA_PATTERN = /^[0-9a-f]{92}$/i;
	const FULL_MESSAGE = "So many Mii characters! You'll need to manage them before you can create a new one.";
	const PENDING_LIFETIME = 120_000;
	let finishing = false;

	function report(id, status, message, entryId, data) {
		if (status === 'error' && location.pathname !== '/') {
			sessionStorage.setItem(ERROR_KEY, JSON.stringify({ message, at: Date.now() }));
		}
		document.dispatchEvent(new CustomEvent(RESULT_EVENT, {
			detail: { id, status, ...(message ? { message } : {}),
				...(entryId ? { entryId, data } : {}) }
		}));
	}

	function readSuccess() {
		try {
			const success = JSON.parse(sessionStorage.getItem(SUCCESS_KEY) || 'null');
			if (!success || typeof success.entryId !== 'string' || !success.entryId
				|| !DATA_PATTERN.test(success.data) || typeof success.at !== 'number') {
				sessionStorage.removeItem(SUCCESS_KEY);
				return null;
			}
			return success;
		} catch {
			sessionStorage.removeItem(SUCCESS_KEY);
			return null;
		}
	}

	function readPending() {
		try {
			const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
			if (!pending || typeof pending.id !== 'string'
				|| (pending.source !== undefined && pending.source !== 'import')
				|| (pending.source !== 'import' && (typeof pending.entryId !== 'string' || !pending.entryId))
				|| !DATA_PATTERN.test(pending.data)
				|| typeof pending.started !== 'number' || Date.now() - pending.started > PENDING_LIFETIME) {
				sessionStorage.removeItem(PENDING_KEY);
				return null;
			}
			return pending;
		} catch {
			sessionStorage.removeItem(PENDING_KEY);
			return null;
		}
	}

	function clearPending() {
		sessionStorage.removeItem(PENDING_KEY);
	}

	function isVisible(element) {
		if (!element || element.closest('[hidden], [aria-hidden="true"], [data-mii-studio-fixer]')) {
			return false;
		}
		const style = window.getComputedStyle(element);
		return style.display !== 'none' && style.visibility !== 'hidden'
			&& element.getClientRects().length > 0;
	}

	function isFull() {
		return (document.body?.innerText || '').replace(/\s+/g, ' ').includes(FULL_MESSAGE);
	}

	function findAddButton() {
		let best = null;
		let bestScore = 0;
		for (const element of document.querySelectorAll('button, a, [role="button"]')) {
			if (!isVisible(element) || element.disabled || element.getAttribute('aria-disabled') === 'true') {
				continue;
			}
			const label = (element.getAttribute('aria-label') || element.getAttribute('title') || '').trim();
			const text = (element.innerText || element.textContent || '').trim();
			const href = element.getAttribute('href') || '';
			const markers = `${element.className?.baseVal || element.className || ''} ${element.id}`;
			let score = 0;
			if (/^(?:\+|＋)$/.test(text)) score += 100;
			if (/\b(?:add|create|new)\b.{0,20}\bmii\b|\bmii\b.{0,20}\b(?:add|create|new)\b/i.test(`${label} ${text}`)) score += 100;
			if (/\/miis\/(?:new|create)(?:[/?#]|$)/i.test(href)) score += 90;
			if (/\b(?:add|create|new|plus)\b/i.test(markers)) score += 35;
			if (element.querySelector('[class*="plus"], [class*="Plus"], [id*="plus"], [id*="Plus"]')) score += 40;
			if (score > bestScore) {
				best = element;
				bestScore = score;
			}
		}
		return bestScore >= 35 ? best : null;
	}

	function findEditor() {
		const visited = new Set();
		const canvas = document.querySelector('canvas#canvas');
		const roots = canvas ? [canvas, ...document.querySelectorAll('*')] : document.querySelectorAll('*');
		for (const element of roots) {
			let component = element.__vue__;
			while (component && !visited.has(component)) {
				visited.add(component);
				if (typeof component.editContinue === 'function'
					&& typeof component.onSaveSelected === 'function'
					&& typeof component.onCheckSubmit === 'function'
					&& typeof component.onCreate === 'function') {
					return component;
				}
				component = component.$parent;
			}
		}
		return null;
	}

	async function finishPending(pending, editor) {
		if (finishing) return;
		finishing = true;
		if (editor.miiParams != null) {
			clearPending();
			report(pending.id, 'error', 'Mii Studio opened an existing Mii instead of a new one.');
			finishing = false;
			return;
		}
		const storageKey = encodeURIComponent(location.href);
		const previousDraft = localStorage.getItem(storageKey);
		if (previousDraft && previousDraft.toLowerCase() !== pending.data) {
			clearPending();
			report(pending.id, 'error', 'A Mii is already in progress. Finish or discard it before restoring this Mii.');
			finishing = false;
			return;
		}
		try {
			localStorage.setItem(storageKey, pending.data);
			editor.editContinue();
			if (editor.$nextTick) await editor.$nextTick();
			editor.onSaveSelected();
			if (editor.$nextTick) await editor.$nextTick();
			clearPending();
			const saved = await editor.onCheckSubmit();
			if (!saved) throw new Error('Mii Studio did not save the restored Mii.');
			if (pending.source !== 'import' && pending.entryId) {
				sessionStorage.setItem(SUCCESS_KEY, JSON.stringify({
					entryId: pending.entryId, data: pending.data, at: Date.now()
				}));
			}
			report(pending.id, 'saved', null,
				pending.source === 'import' ? null : pending.entryId, pending.data);
		} catch (error) {
			clearPending();
			report(pending.id, 'error', error?.message || 'Could not restore this Mii.');
			console.warn('MiiStudioFixer could not restore a stored Mii.', error);
		} finally {
			finishing = false;
		}
	}

	function tryFinishPending() {
		if (finishing) return;
		const pending = readPending();
		if (!pending || location.origin !== 'https://studio.mii.nintendo.com'
			|| new URLSearchParams(location.search).get('client_id') !== pending.clientId) return;
		const editor = findEditor();
		if (editor) void finishPending(pending, editor);
	}

	document.addEventListener(CHECK_REQUEST_EVENT, event => {
		const status = location.origin === 'https://studio.mii.nintendo.com'
			&& location.pathname === '/' && !isFull() && findAddButton() ? 'available' : 'full';
		document.dispatchEvent(new CustomEvent(CHECK_RESULT_EVENT, {
			detail: { id: event.detail?.id, status }
		}));
	});

	document.addEventListener(SUCCESS_REQUEST_EVENT, event => {
		const success = readSuccess();
		document.dispatchEvent(new CustomEvent(SUCCESS_RESULT_EVENT, {
			detail: { id: event.detail?.id, ...(success || {}) }
		}));
	});

	document.addEventListener(SUCCESS_ACK_EVENT, event => {
		const success = readSuccess();
		if (success && success.entryId === event.detail?.entryId
			&& success.data === event.detail?.data) sessionStorage.removeItem(SUCCESS_KEY);
	});

	document.addEventListener(REQUEST_EVENT, event => {
		let request = event.detail;
		if (typeof request === 'string') {
			try { request = JSON.parse(request); } catch { request = null; }
		}
		const id = request?.id;
		const isImport = request?.source === 'import';
		if (typeof id !== 'string' || !id || (request?.source !== undefined && !isImport)
			|| (!isImport && (typeof request?.entryId !== 'string' || !request.entryId))
			|| typeof request?.data !== 'string'
			|| !DATA_PATTERN.test(request.data)) {
			report(typeof id === 'string' ? id : '', 'invalid', 'Stored Mii data is invalid.');
			return;
		}
		if (location.origin !== 'https://studio.mii.nintendo.com' || location.pathname !== '/') {
			report(id, 'error', 'Open the Mii Studio list before restoring a Mii.');
			return;
		}
		if (isFull()) {
			report(id, 'full');
			return;
		}
		const addButton = findAddButton();
		if (!addButton) {
			report(id, 'full');
			return;
		}
		const pending = {
			id,
			...(isImport ? { source: 'import' } : { entryId: request.entryId }),
			data: request.data.toLowerCase(),
			clientId: new URLSearchParams(location.search).get('client_id'),
			started: Date.now()
		};
		try {
			sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
			addButton.click();
			report(id, 'started');
			setTimeout(tryFinishPending, 0);
		} catch (error) {
			clearPending();
			report(id, 'error', error?.message || 'Could not start restoring this Mii.');
		}
	});

	const observer = new MutationObserver(tryFinishPending);
	function observe() {
		if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
		tryFinishPending();
	}
	if (document.documentElement) observe();
	else document.addEventListener('DOMContentLoaded', observe, { once: true });
	window.addEventListener('pageshow', tryFinishPending);
})();

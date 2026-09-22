(() => {
	'use strict';

	const REQUEST_EVENT = 'mii-studio-fixer:store-capture-request';
	const RESULT_EVENT = 'mii-studio-fixer:store-capture-result';
	const EXIT_REQUEST_EVENT = 'mii-studio-fixer:store-exit-request';
	const EXIT_RESULT_EVENT = 'mii-studio-fixer:store-exit-result';
	const EDITOR_REQUEST_EVENT = 'mii-studio-fixer:store-editor-capture-request';
	const EDITOR_RESULT_EVENT = 'mii-studio-fixer:store-editor-capture-result';
	const MENU_ID_REQUEST_EVENT = 'mii-studio-fixer:store-menu-id-request';
	const MENU_ID_RESULT_EVENT = 'mii-studio-fixer:store-menu-id-result';
	const MII_ID = /^[a-f\d]{16}$/i;
	const RAW_HEX = /^[a-f\d]{92}$/i;
	const IMAGE_HEX = /^[a-f\d]{94}$/i;
	const FIELD_KEYS = [
		'$$_1r', '$$_1q', 'build', '$$_1p', '$$_1o', '$$_1n', '$$_1m', '$$_1l',
		'$$_1k', '$$_1j', '$$_1i', '$$_1h', '$$_1g', '$$_1f', '$$_1e', '$$_1d',
		'$$_1c', '$$_1b', '$$_1a', '$$_19', '$$_18', '$$_17', 'gender', '$$_16',
		'$$_15', '$$_14', '$$_13', '$$_12', '$$_11', '$$_10', 'height', '$$_e',
		'$$_d', '$$_c', '$$_b', '$$_a', '$$_9', '$$_8', '$$_7', '$$_6', '$$_5',
		'$$_4', '$$_3', '$$_2', '$$_1', '$$_0'
	];

	function bytesToHex(bytes) {
		return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
	}

	function isPlausibleRaw(bytes) {
		return bytes.length === 46 && bytes[2] <= 127 && bytes[22] <= 1 && bytes[30] <= 127;
	}

	function fromRawHex(value) {
		if (typeof value !== 'string' || !RAW_HEX.test(value)) return null;
		const bytes = Uint8Array.from(value.match(/../g), part => Number.parseInt(part, 16));
		return isPlausibleRaw(bytes) ? bytesToHex(bytes) : null;
	}

	function fromImageHex(value) {
		if (typeof value !== 'string' || !IMAGE_HEX.test(value)) return null;
		const encoded = Uint8Array.from(value.match(/../g), part => Number.parseInt(part, 16));
		const raw = new Uint8Array(46);
		for (let index = 0; index < raw.length; index++) {
			raw[index] = ((encoded[index + 1] - 7) & 255) ^ encoded[index];
		}
		return isPlausibleRaw(raw) ? bytesToHex(raw) : null;
	}

	function fromFields(value) {
		if (!value || typeof value !== 'object') return null;
		const bytes = [];
		for (const key of FIELD_KEYS) {
			const byte = value[key];
			if (!Number.isInteger(byte) || byte < 0 || byte > 255) return null;
			bytes.push(byte);
		}
		return isPlausibleRaw(bytes) ? bytesToHex(bytes) : null;
	}

	function directData(value) {
		if (typeof value === 'string') return fromRawHex(value) || fromImageHex(value);
		if (!value || typeof value !== 'object') return null;
		if (value instanceof Uint8Array) {
			return directData(bytesToHex(value));
		}
		return fromFields(value);
	}

	function recordId(value) {
		if (!value || typeof value !== 'object') return null;
		for (const key of ['id', 'miiId', 'miiID', 'mii_id']) {
			const candidate = value[key];
			if (typeof candidate === 'string' && MII_ID.test(candidate)) return candidate.toLowerCase();
		}
		return null;
	}

	function dataWithinRecord(value, depth = 0, seen = new Set()) {
		const data = directData(value);
		if (data) return data;
		if (!value || typeof value !== 'object' || seen.has(value) || depth >= 3) return null;
		seen.add(value);
		for (const key of ['data', 'miiData', 'mii', 'params', 'miiParams', 'appearance', 'attributes', 'imageUrl', 'image']) {
			let child;
			try { child = value[key]; } catch { continue; }
			if (typeof child === 'string' && /^https?:\/\//.test(child)) {
				const imageData = imageDataFromUrl(child);
				if (imageData) return imageData;
			}
			if (child && !Array.isArray(child)) {
				const nested = dataWithinRecord(child, depth + 1, seen);
				if (nested) return nested;
			}
		}
		return null;
	}

	function findMatchingRecord(value, miiId, depth = 0, seen = new Set(), budget = { count: 0 }) {
		if (!value || typeof value !== 'object' || seen.has(value) || depth > 6 || ++budget.count > 1500) return null;
		seen.add(value);
		if (recordId(value) === miiId) {
			const data = dataWithinRecord(value);
			if (data) return data;
		}
		let entries;
		try { entries = Object.entries(value); } catch { return null; }
		for (const [key, child] of entries) {
			if (key.startsWith('$') || key.startsWith('_') || typeof child !== 'object' || !child) continue;
			if (child instanceof Node || child instanceof Window) continue;
			const data = findMatchingRecord(child, miiId, depth + 1, seen, budget);
			if (data) return data;
		}
		return null;
	}

	function imageDataFromUrl(value) {
		try {
			const url = new URL(value, location.href);
			if (url.origin !== location.origin || url.pathname !== '/miis/image.png') return null;
			return fromImageHex(url.searchParams.get('data'));
		} catch { return null; }
	}

	function idFromEditUrl(value) {
		try {
			const url = new URL(value, location.href);
			if (url.origin !== location.origin) return null;
			return /^\/miis\/([a-f\d]{16})\/edit\/?$/i.exec(url.pathname)?.[1]?.toLowerCase() ?? null;
		} catch { return null; }
	}

	async function editorDataFromPage(editUrl, miiId) {
		const url = new URL(editUrl, location.href);
		const clientId = new URL(location.href).searchParams.get('client_id');
		if (url.origin !== location.origin || idFromEditUrl(url.href) !== miiId
			|| !MII_ID.test(clientId || '') || url.searchParams.get('client_id') !== clientId) {
			return { error: 'The selected Mii changed. Open it again and retry.' };
		}
		try {
			const response = await fetch(url.href, { credentials: 'same-origin', cache: 'no-store' });
			if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('text/html')) return {};
			const finalUrl = new URL(response.url);
			if (finalUrl.origin !== location.origin || idFromEditUrl(finalUrl.href) !== miiId
				|| finalUrl.searchParams.get('client_id') !== clientId) return {};
			const page = new DOMParser().parseFromString(await response.text(), 'text/html');
			if (page.body?.getAttribute('data-page-id') !== 'mii-edit') return {};
			const params = page.body?.getAttribute('data-params');
			return { data: fromRawHex(params) || fromImageHex(params) };
		} catch (error) {
			console.warn('MiiStudioFixer could not read the selected Mii page.', error);
			return {};
		}
	}

	function findCardImage(miiId) {
		function soleImageData(container) {
			const candidates = new Set();
			for (const image of container.querySelectorAll('img[src]')) {
				const data = imageDataFromUrl(image.src);
				if (data) candidates.add(data);
			}
			return candidates.size === 1 ? [...candidates][0] : null;
		}
		for (const link of document.querySelectorAll('a[href]')) {
			if (idFromEditUrl(link.href) !== miiId) continue;
			const data = soleImageData(link);
			if (data) return data;
		}
		for (const element of document.querySelectorAll('[data-mii-id], [data-id]')) {
			if ([element.getAttribute('data-mii-id'), element.getAttribute('data-id')]
				.some(id => id?.toLowerCase() === miiId)) {
				const data = soleImageData(element);
				if (data) return data;
			}
		}
		return null;
	}

	function selectedTileData(miiId, tileIndex) {
		if (!Number.isInteger(tileIndex) || tileIndex < 0) return null;
		const tile = document.querySelectorAll('.c-mii-btn')[tileIndex];
		if (!tile) return null;
		const modalName = tile.getAttribute('data-modal');
		const modalMiiId = /^mii-([a-f\d]{16})$/i.exec(modalName || '')?.[1]?.toLowerCase();
		if (modalMiiId && modalMiiId !== miiId) {
			return { error: 'The selected Mii changed. Open it again and retry.' };
		}
		let modal = null;
		if (modalName) {
			const modalId = modalName.replace(/^#/, '');
			modal = document.getElementById?.(modalId) || null;
			if (!modal) {
				try { modal = document.querySelector(modalName); } catch { /* data-modal may be an ID. */ }
			}
		}
		const ids = new Set();
		for (const root of [tile, modal].filter(Boolean)) {
			for (const link of root.querySelectorAll('a[href]')) {
				const id = idFromEditUrl(link.href);
				if (id) ids.add(id);
			}
			for (const element of [root, ...root.querySelectorAll('[data-mii-id], [data-id]')]) {
				for (const name of ['data-mii-id', 'data-id']) {
					const id = element.getAttribute(name);
					if (MII_ID.test(id || '')) ids.add(id.toLowerCase());
				}
			}
		}
		if (ids.size && (ids.size !== 1 || !ids.has(miiId))) {
			return { error: 'The selected Mii changed. Open it again and retry.' };
		}
		const candidates = new Set();
		for (const element of [tile, ...tile.querySelectorAll('[data-src], img[src]')]) {
			for (const source of [element.getAttribute('data-src'), element.getAttribute('src')]) {
				const data = imageDataFromUrl(source) || directData(source);
				if (data) candidates.add(data);
			}
		}
		if (candidates.size > 1) return { error: 'Could not identify a single image for the selected Mii.' };
		return { data: candidates.size === 1 ? [...candidates][0] : null };
	}

	function findVueData(miiId) {
		const seenComponents = new Set();
		for (const element of document.querySelectorAll('*')) {
			for (let component = element.__vue__; component && !seenComponents.has(component); component = component.$parent) {
				seenComponents.add(component);
				for (const source of [component.$props, component.$data, component]) {
					const data = findMatchingRecord(source, miiId);
					if (data) return data;
				}
			}
		}
		return null;
	}

	function inferMiiId() {
		const editLinks = [...document.querySelectorAll('a[href]')]
			.filter(link => link.textContent.trim() === 'Edit')
			.map(link => idFromEditUrl(link.href))
			.filter(Boolean);
		return editLinks.length === 1 ? editLinks[0] : null;
	}

	function menuSelection() {
		const controls = [...document.querySelectorAll('button, a, [role="button"]')];
		const labeled = (root, text) => controls.some(control => root.contains(control)
			&& control.textContent?.replace(/\s+/g, ' ').trim() === text);
		const selections = new Map();
		for (const close of controls.filter(control => control.textContent?.trim() === 'Close')) {
			if (close.closest('[hidden], [aria-hidden="true"]')) continue;
			if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
				let hidden = false;
				for (let element = close; element; element = element.parentElement) {
					const style = window.getComputedStyle(element);
					if (style.display === 'none' || style.visibility === 'hidden') { hidden = true; break; }
				}
				if (hidden) continue;
			}
			let menu = close.parentElement;
			for (let depth = 0; menu && depth < 4; depth++, menu = menu.parentElement) {
				if (!labeled(menu, 'Edit') || !labeled(menu, 'Erase')) continue;
				const seen = new Set();
				for (let element = menu; element && element !== document.body; element = element.parentElement) {
					for (let component = element.__vue__; component && !seen.has(component); component = component.$parent) {
						seen.add(component);
						for (const source of [component.$props, component.$data, component]) {
							if (!source || typeof source !== 'object') continue;
							for (const key of ['selectedMii', 'currentMii', 'activeMii', 'mii']) {
								let value;
								try { value = source[key]; } catch { continue; }
								const id = recordId(value);
								if (id) selections.set(id, dataWithinRecord(value));
							}
						}
					}
				}
				break;
			}
		}
		return selections.size === 1 ? { miiId: [...selections.keys()][0], data: [...selections.values()][0] } : null;
	}

	function findEditor() {
		const canvas = document.querySelector('canvas#canvas');
		const seen = new Set();
		for (let element = canvas; element; element = element.parentElement) {
			for (let component = element.__vue__; component && !seen.has(component); component = component.$parent) {
				seen.add(component);
				if (typeof component.onPartsUpdated === 'function' && component.history?.current) return component;
			}
		}
		return null;
	}

	document.addEventListener(REQUEST_EVENT, event => {
		const requestId = event.detail?.id;
		const selected = menuSelection();
		const miiId = (event.detail?.miiId || selected?.miiId || inferMiiId())?.toLowerCase();
		const result = { id: requestId, miiId, status: 'needs-edit' };
		try {
			if (selected?.miiId && event.detail?.miiId
				&& selected.miiId !== event.detail.miiId.toLowerCase()) {
				result.status = 'error';
				result.message = 'The selected Mii changed. Open it again and retry.';
			} else if (!MII_ID.test(miiId || '')) {
				result.status = 'needs-edit';
			} else {
				const tile = selectedTileData(miiId, event.detail?.tileIndex);
				if (tile?.error) {
					result.status = 'error';
					result.message = tile.error;
				} else {
					const data = selected?.miiId === miiId && selected.data
						? selected.data : tile?.data || findVueData(miiId) || findCardImage(miiId);
					if (data) {
						result.status = 'captured';
						result.data = data;
					}
				}
			}
		} catch (error) {
			console.warn('MiiStudioFixer could not capture the selected Mii.', error);
			result.status = 'needs-edit';
		}
		if (result.status === 'needs-edit' && event.detail?.editUrl && MII_ID.test(miiId || '')) {
			void editorDataFromPage(event.detail.editUrl, miiId).then(page => {
				if (page.error) {
					result.status = 'error';
					result.message = page.error;
				} else if (page.data) {
					result.status = 'captured';
					result.data = page.data;
				}
				document.dispatchEvent(new CustomEvent(RESULT_EVENT, { detail: result }));
			});
		} else document.dispatchEvent(new CustomEvent(RESULT_EVENT, { detail: result }));
	});

	document.addEventListener(MENU_ID_REQUEST_EVENT, event => {
		document.dispatchEvent(new CustomEvent(MENU_ID_RESULT_EVENT, {
			detail: { id: event.detail?.id, miiId: menuSelection()?.miiId || null }
		}));
	});

	document.addEventListener(EDITOR_REQUEST_EVENT, event => {
		const result = { id: event.detail?.id, status: 'unavailable' };
		try {
			const editor = findEditor();
			if (editor) {
				editor.onPartsUpdated(editor.history.current);
				const data = fromRawHex(localStorage.getItem(encodeURIComponent(location.href)));
				if (data) { result.status = 'captured'; result.data = data; }
			}
		} catch (error) {
			console.warn('MiiStudioFixer could not capture the current editor Mii.', error);
			result.status = 'error';
		}
		document.dispatchEvent(new CustomEvent(EDITOR_RESULT_EVENT, { detail: result }));
	});

	document.addEventListener(EXIT_REQUEST_EVENT, event => {
		const result = { id: event.detail?.id, status: 'error' };
		try {
			const editor = findEditor();
			if (editor && typeof editor.exitEditor === 'function') {
				editor.exitEditor();
				result.status = 'exited';
			}
		} catch (error) {
			console.warn('MiiStudioFixer could not leave the Mii editor.', error);
		}
		document.dispatchEvent(new CustomEvent(EXIT_RESULT_EVENT, { detail: result }));
	});
})();

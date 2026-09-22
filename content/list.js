(() => {
	'use strict';

	const ORIGIN = 'https://studio.mii.nintendo.com';
	const STORED_KEY = 'mii-studio-fixer-stored-miis-v1';
	const PENDING_STORE_KEY = 'mii-studio-fixer-pending-store-v1';
	const RESTORE_ERROR_KEY = 'mii-studio-fixer:restore-error';
	const STORE_MESSAGE = "This will store this Mii in the MiiStudioFixer extension. If this extension's data is lost, so will any Stored Miis. Please type a name to identify this Mii to continue.";
	const FULL_MESSAGE = 'One or more Miis will need to be stored or deleted before restoring any saved Miis.';
	const FULL_TEXT = "So many Mii characters! You'll need to manage them before you can create a new one.";
	const MII_DATA = /^[a-f0-9]{92}$/i;
	const MII_ID = /^[a-f0-9]{16}$/i;
	const EDIT_PATH = /^\/miis\/([a-f0-9]{16})\/edit\/?$/i;
	const DELETE_PATH = /^\/miis\/([a-f0-9]{16})\/delete\/?$/i;
	const STORE_REQUEST = 'mii-studio-fixer:store-capture-request';
	const STORE_RESULT = 'mii-studio-fixer:store-capture-result';
	const STORE_DELETE_REQUEST = 'mii-studio-fixer:store-delete-request';
	const STORE_DELETE_RESULT = 'mii-studio-fixer:store-delete-result';
	const RESTORE_REQUEST = 'mii-studio-fixer:restore-request';
	const RESTORE_RESULT = 'mii-studio-fixer:restore-result';
	const RESTORE_CREATE_REQUEST = 'mii-studio-fixer:restore-create-request';
	const RESTORE_CREATE_RESULT = 'mii-studio-fixer:restore-create-result';
	const IMPORT_FILE_REQUEST = 'mii-studio-fixer:import-file-request';
	const IMPORT_FILE_RESULT = 'mii-studio-fixer:import-file-result';
	const RESTORE_SUCCESS_REQUEST = 'mii-studio-fixer:restore-success-request';
	const RESTORE_SUCCESS_RESULT = 'mii-studio-fixer:restore-success-result';
	const RESTORE_SUCCESS_ACK = 'mii-studio-fixer:restore-success-ack';
	let entries = [];
	let dialog;
	let createMenu;
	let createMenuClose;
	let busy = false;
	let importBusy = false;
	let exportBusy = false;
	let resumeRunning = false;
	let refreshScheduled = false;
	let removingRestoredEntry = false;
	let selectedTileIndex = -1;

	function isListPage() {
		return location.origin === ORIGIN && location.pathname === '/'
			&& MII_ID.test(new URL(location.href).searchParams.get('client_id') || '');
	}

	function isEditorPage() {
		return location.origin === ORIGIN && EDIT_PATH.test(location.pathname);
	}

	function isVisible(element) {
		if (!element || element.closest('[hidden], [aria-hidden="true"]')) return false;
		for (let current = element; current; current = current.parentElement) {
			const style = getComputedStyle(current);
			if (style.display === 'none' || style.visibility === 'hidden') return false;
		}
		return true;
	}

	function labelOf(element) {
		return (element.textContent || element.value || element.getAttribute('aria-label') || '')
			.replace(/\s+/g, ' ').trim();
	}

	function findActions(label, root = document) {
		return [...root.querySelectorAll('button, a, [role="button"], [tabindex]')]
			.filter(element => !element.closest('#mii-studio-fixer-list-dialog')
				&& !element.closest('#mii-studio-fixer-export-dialog')
				&& !element.closest('#mii-studio-fixer-create-modal')
				&& element.id !== 'mii-studio-fixer-store-option'
				&& isVisible(element) && labelOf(element) === label);
	}

	function getMenu() {
		for (const close of findActions('Close')) {
			let ancestor = close.parentElement;
			for (let depth = 0; ancestor && depth < 4; depth++, ancestor = ancestor.parentElement) {
				const edit = findActions('Edit', ancestor)[0];
				const erase = findActions('Erase', ancestor)[0];
				if (edit && erase) return { close, edit, erase };
			}
		}
		return null;
	}

	function cloneNativeAction(original, text, id) {
		const copy = original.cloneNode(true);
		copy.id = id;
		copy.removeAttribute('href');
		copy.removeAttribute('aria-describedby');
		copy.setAttribute('aria-label', text);
		if (!copy.matches('button, [role="button"]')) {
			copy.setAttribute('role', 'button');
			copy.tabIndex = 0;
		}
		const label = [...copy.querySelectorAll('*')].reverse()
			.find(element => labelOf(element) === labelOf(original) && ![...element.children]
				.some(child => labelOf(child) === labelOf(original)));
		if (label) label.textContent = text;
		else copy.textContent = text;
		if (!copy.matches('button')) {
			copy.addEventListener('keydown', event => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					copy.click();
				}
			});
		}
		return copy;
	}

	function isActionInserted(existing, original) {
		if (!existing) return false;
		if (existing.nextElementSibling === original) return true;
		const insertedRow = existing.closest('li');
		const originalRow = original.closest('li');
		return Boolean(insertedRow && originalRow && insertedRow.nextElementSibling === originalRow);
	}

	function insertActionBefore(original, copy) {
		const row = original.closest('li');
		if (row && row.querySelectorAll('button, a, [role="button"]').length === 1) {
			const clonedRow = row.cloneNode(true);
			clonedRow.removeAttribute('id');
			for (const child of clonedRow.querySelectorAll('[id]')) child.removeAttribute('id');
			const clonedAction = clonedRow.querySelector('button, a, [role="button"]');
			if (clonedAction) {
				clonedAction.replaceWith(copy);
				row.before(clonedRow);
				return;
			}
		}
		original.before(copy);
	}

	function requestMain(requestEvent, resultEvent, detail, timeout = 8000) {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				document.removeEventListener(resultEvent, onResult);
				reject(new Error('The Mii Studio page did not respond. Try again after it finishes loading.'));
			}, timeout);
			function onResult(event) {
				if (event.detail?.id !== detail.id) return;
				clearTimeout(timer);
				document.removeEventListener(resultEvent, onResult);
				resolve(event.detail);
			}
			document.addEventListener(resultEvent, onResult);
			document.dispatchEvent(new CustomEvent(requestEvent, { detail }));
		});
	}

	function readPendingStore() {
		try {
			const value = JSON.parse(sessionStorage.getItem(PENDING_STORE_KEY) || 'null');
			if (value && typeof value === 'object' && Date.now() - value.createdAt < 5 * 60 * 1000) {
				return value;
			}
			sessionStorage.removeItem(PENDING_STORE_KEY);
			return null;
		} catch { sessionStorage.removeItem(PENDING_STORE_KEY); return null; }
	}

	function savePendingStore(value) {
		sessionStorage.setItem(PENDING_STORE_KEY, JSON.stringify(value));
	}

	function clearPendingStore() {
		sessionStorage.removeItem(PENDING_STORE_KEY);
	}

	function makeId() {
		return crypto.randomUUID();
	}

	async function loadEntries() {
		const result = await chrome.storage.local.get(STORED_KEY);
		entries = Array.isArray(result[STORED_KEY]) ? result[STORED_KEY].filter(entry =>
			entry && typeof entry.id === 'string' && typeof entry.name === 'string'
			&& MII_DATA.test(entry.data || '')) : [];
		return entries;
	}

	async function saveEntry(name, data, id = makeId()) {
		if (!MII_DATA.test(data)) throw new Error('Could not read valid Mii data. The original Mii has not been erased.');
		const current = await loadEntries();
		const existing = current.find(entry => entry.id === id);
		if (existing) return existing;
		const entry = { id, name, data: data.toLowerCase(), storedAt: Date.now() };
		await chrome.storage.local.set({ [STORED_KEY]: [...current, entry] });
		const check = await chrome.storage.local.get(STORED_KEY);
		if (!Array.isArray(check[STORED_KEY]) || !check[STORED_KEY]
			.some(saved => saved.id === entry.id && saved.data === entry.data)) {
			throw new Error('Could not verify the stored Mii. The original Mii has not been erased.');
		}
		entries = check[STORED_KEY];
		return entry;
	}

	async function removeRestoredEntry(receipt) {
		if (removingRestoredEntry || typeof receipt?.entryId !== 'string'
			|| !MII_DATA.test(receipt.data || '')) return;
		removingRestoredEntry = true;
		try {
			const current = await chrome.storage.local.get(STORED_KEY);
			const stored = Array.isArray(current[STORED_KEY]) ? current[STORED_KEY] : [];
			const remaining = stored.filter(entry =>
				entry.id !== receipt.entryId || entry.data !== receipt.data.toLowerCase());
			if (remaining.length !== stored.length) {
				await chrome.storage.local.set({ [STORED_KEY]: remaining });
				const verified = await chrome.storage.local.get(STORED_KEY);
				if (!Array.isArray(verified[STORED_KEY]) || verified[STORED_KEY].some(entry =>
					entry.id === receipt.entryId && entry.data === receipt.data.toLowerCase())) {
					throw new Error('Could not remove the restored Mii from extension storage.');
				}
				entries = verified[STORED_KEY];
			}
			document.dispatchEvent(new CustomEvent(RESTORE_SUCCESS_ACK, {
				detail: { entryId: receipt.entryId, data: receipt.data }
			}));
		} catch (error) {
			console.warn('Could not finish transferring the restored Mii.', error);
		} finally { removingRestoredEntry = false; }
	}

	function closeDialog() {
		if (busy || !dialog) return;
		dialog.remove();
		dialog = null;
	}

	function showDialog() {
		if (dialog) dialog.remove();
		dialog = document.createElement('div');
		dialog.id = 'mii-studio-fixer-list-dialog';
		dialog.setAttribute('role', 'presentation');
		const panel = document.createElement('div');
		panel.className = 'mii-studio-fixer-panel';
		panel.setAttribute('role', 'dialog');
		panel.setAttribute('aria-modal', 'true');
		dialog.append(panel);
		dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); });
		(document.body || document.documentElement).append(dialog);
		return panel;
	}

	function addMessage(panel, message) {
		const paragraph = document.createElement('p');
		paragraph.className = 'mii-studio-fixer-message';
		paragraph.textContent = message;
		panel.append(paragraph);
		return paragraph;
	}

	function addError(panel) {
		const error = document.createElement('p');
		error.className = 'mii-studio-fixer-error';
		error.setAttribute('role', 'alert');
		panel.append(error);
		return error;
	}

	function addButton(parent, text, primary, onClick) {
		const button = document.createElement('button');
		button.type = 'button';
		button.textContent = text;
		if (primary) button.className = 'mii-studio-fixer-primary';
		button.addEventListener('click', onClick);
		parent.append(button);
		return button;
	}

	function showMessage(message) {
		const panel = showDialog();
		addMessage(panel, message);
		const actions = document.createElement('div');
		actions.className = 'mii-studio-fixer-actions';
		panel.append(actions);
		addButton(actions, 'Close', false, closeDialog).focus();
	}

	function nativeEditId(edit) {
		const href = edit.getAttribute('href') || edit.closest('a[href]')?.getAttribute('href')
			|| edit.querySelector('a[href]')?.getAttribute('href') || '';
		try {
			const fromUrl = EDIT_PATH.exec(new URL(href, location.href).pathname)?.[1];
			if (fromUrl) return fromUrl;
		} catch { /* Check a Mii ID on the menu itself. */ }
		for (let element = edit, depth = 0; element && depth < 4; element = element.parentElement, depth++) {
			const miiId = element.getAttribute('data-mii-id');
			if (MII_ID.test(miiId || '')) return miiId;
		}
		return null;
	}

	function selectedTileId() {
		const tile = document.querySelectorAll('.c-mii-btn')[selectedTileIndex];
		return /^mii-([a-f0-9]{16})$/i.exec(tile?.getAttribute('data-modal') || '')?.[1] || null;
	}

	function editUrlForMii(miiId) {
		return miiId ? `/miis/${miiId}/edit?client_id=${new URL(location.href).searchParams.get('client_id')}` : null;
	}

	function deleteUrlForMii(miiId) {
		return `/miis/${miiId}/delete?client_id=${new URL(location.href).searchParams.get('client_id')}`;
	}

	function showStoreDialog(menu) {
		const panel = showDialog();
		addMessage(panel, STORE_MESSAGE);
		const name = document.createElement('input');
		name.className = 'mii-studio-fixer-name';
		name.type = 'text';
		name.maxLength = 80;
		name.placeholder = 'Mii name';
		name.setAttribute('aria-label', 'Name for stored Mii');
		panel.append(name);
		const error = addError(panel);
		const actions = document.createElement('div');
		actions.className = 'mii-studio-fixer-actions';
		panel.append(actions);
		const confirm = addButton(actions, 'Store', true, async () => {
			const typedName = name.value.trim();
			if (!typedName) { error.textContent = 'Type a name to continue.'; name.focus(); return; }
			busy = true;
			confirm.disabled = true;
			cancel.disabled = true;
			error.textContent = '';
			try {
				const menuId = nativeEditId(menu.edit);
				const tileId = selectedTileId();
				if (menuId && tileId && menuId.toLowerCase() !== tileId.toLowerCase()) {
					throw new Error('The selected Mii changed. Open it again and retry.');
				}
				const miiId = menuId || tileId;
				const result = await requestMain(STORE_REQUEST, STORE_RESULT,
					{
						id: makeId(), miiId, tileIndex: selectedTileIndex,
						editUrl: editUrlForMii(miiId)
					}, 20000);
				if (result.status === 'captured') {
					const entry = await saveEntry(typedName, result.data);
					const activeMenu = getMenu()
						|| (menu.edit.isConnected && menu.erase.isConnected
							&& isVisible(menu.edit) && isVisible(menu.erase) ? menu : null);
					let activeMiiId = activeMenu ? nativeEditId(activeMenu.edit) : null;
					if (activeMenu && !activeMiiId) {
						const identity = await requestMain('mii-studio-fixer:store-menu-id-request',
							'mii-studio-fixer:store-menu-id-result', { id: makeId() }, 1000);
						activeMiiId = identity.miiId || selectedTileId();
					}
					if (!activeMenu || activeMiiId?.toLowerCase() !== result.miiId?.toLowerCase()) {
						throw new Error('Mii stored, but the selected Mii changed. Open it again before erasing it.');
					}
					const deletion = await requestMain(STORE_DELETE_REQUEST, STORE_DELETE_RESULT, {
						id: makeId(), miiId: activeMiiId, deleteUrl: deleteUrlForMii(activeMiiId)
					}, 60000);
					if (deletion.status === 'deleted') {
						busy = false;
						closeDialog();
						location.reload();
						return;
					}
					if (deletion.status !== 'unavailable') {
						throw new Error(`${deletion.message || 'Could not verify whether Mii Studio erased this Mii.'} Refresh the saved Mii list before trying again.`);
					}
					savePendingStore({
						miiId: activeMiiId, entryId: entry.id, data: entry.data, phase: 'confirm-erase', createdAt: Date.now()
					});
					busy = false;
					closeDialog();
					activeMenu.erase.click();
					return;
				}
				if (result.status !== 'needs-edit') {
					throw new Error(result.message || 'Could not read this Mii. The original Mii has not been erased.');
				}
				const edit = menu.edit.isConnected ? menu.edit : getMenu()?.edit;
				if (!edit) throw new Error('Could not open this Mii for reading. The original Mii has not been erased.');
				const pending = {
					name: typedName,
					miiId: result.miiId || miiId,
					tileIndex: selectedTileIndex,
					listUrl: location.href,
					entryId: makeId(),
					phase: 'capture',
					createdAt: Date.now()
				};
				savePendingStore(pending);
				busy = false;
				closeDialog();
				edit.click();
			} catch (cause) {
				busy = false;
				if (readPendingStore()?.phase === 'capture') clearPendingStore();
				const message = cause.message || 'Could not store this Mii. The original Mii has not been erased.';
				if (dialog) error.textContent = message;
				else showMessage(message);
				confirm.disabled = false;
				cancel.disabled = false;
			}
		});
		const cancel = addButton(actions, 'Cancel', false, closeDialog);
		name.addEventListener('keydown', event => {
			if (event.key === 'Enter') { event.preventDefault(); confirm.click(); }
		});
		name.focus();
	}

	function refreshStoreOption() {
		if (!isListPage()) return;
		const menu = getMenu();
		const existing = document.getElementById('mii-studio-fixer-store-option');
		if (!menu) { existing?.remove(); return; }
		const next = document.getElementById('mii-studio-fixer-export-option') || menu.close;
		if (isActionInserted(existing, next)) return;
		existing?.remove();
		const store = cloneNativeAction(menu.close, 'Store', 'mii-studio-fixer-store-option');
		store.addEventListener('click', event => {
			event.preventDefault();
			event.stopImmediatePropagation();
			showStoreDialog(menu);
		});
		insertActionBefore(next, store);
	}

	function refreshExportOption() {
		if (!isListPage()) return;
		const menu = getMenu();
		const existing = document.getElementById('mii-studio-fixer-export-option');
		if (!menu) { existing?.remove(); return; }
		if (isActionInserted(existing, menu.close)) return;
		existing?.remove();
		const exportButton = cloneNativeAction(menu.close, 'Export', 'mii-studio-fixer-export-option');
		exportButton.addEventListener('click', async event => {
			event.preventDefault();
			event.stopImmediatePropagation();
			if (busy || exportBusy) return;
			exportBusy = true;
			try {
				const menuId = nativeEditId(menu.edit);
				const tileId = selectedTileId();
				if (menuId && tileId && menuId.toLowerCase() !== tileId.toLowerCase()) {
					throw new Error('The selected Mii changed. Open it again and retry.');
				}
				const miiId = menuId || tileId;
				const result = await requestMain(STORE_REQUEST, STORE_RESULT, {
					id: makeId(), miiId, tileIndex: selectedTileIndex, editUrl: editUrlForMii(miiId)
				}, 20000);
				if (result.status !== 'captured' || !MII_DATA.test(result.data || '')) {
					throw new Error(result.message || 'Could not read this Mii for export. Try again.');
				}
				if (!globalThis.MiiStudioFixerExport?.show) {
					throw new Error('The Mii export options are unavailable. Refresh the page and try again.');
				}
				await globalThis.MiiStudioFixerExport.show({ data: result.data });
			} catch (error) {
				showMessage(error.message || 'Could not export this Mii. Try again.');
			} finally { exportBusy = false; }
		});
		insertActionBefore(menu.close, exportButton);
	}

	async function startImport() {
		if (busy || importBusy) return;
		if (isFull()) { showMessage(FULL_MESSAGE); return; }
		importBusy = true;
		try {
			const file = await requestMain(IMPORT_FILE_REQUEST, IMPORT_FILE_RESULT, { id: makeId() }, 600000);
			if (file.status === 'cancelled') return;
			if (file.status !== 'ready' || !MII_DATA.test(file.data || '')) {
				throw new Error(file.message || 'Could not read this Mii file.');
			}
			const capacity = await requestMain('mii-studio-fixer:restore-capacity-request',
				'mii-studio-fixer:restore-capacity-result', { id: makeId() });
			if (capacity.status === 'full') { showMessage(FULL_MESSAGE); return; }
			if (capacity.status !== 'available') {
				throw new Error(capacity.message || 'Could not check whether a Mii can be imported.');
			}
			const created = await requestMain(RESTORE_CREATE_REQUEST, RESTORE_CREATE_RESULT, {
				id: makeId(), source: 'import', data: file.data
			}, 60000);
			if (created.status === 'saved') { location.reload(); return; }
			if (created.status !== 'unavailable') {
				throw new Error(`${created.message || 'Could not verify whether Mii Studio saved this Mii.'} Refresh the saved Mii list before trying again.`);
			}
			const native = await requestMain(RESTORE_REQUEST, RESTORE_RESULT, {
				id: makeId(), source: 'import', data: file.data
			});
			if (native.status === 'full') { showMessage(FULL_MESSAGE); return; }
			if (native.status !== 'started' && native.status !== 'saved') {
				throw new Error(native.message || 'Could not import this Mii. Try again.');
			}
		} catch (error) {
			showMessage(error.message || 'Could not import this Mii. Try again.');
		} finally { importBusy = false; }
	}

	function showCreateMenu(addControl) {
		createMenu?.remove();
		const modal = document.createElement('div');
		modal.id = 'mii-studio-fixer-create-modal';
		modal.className = 'o-modal c-mii-modal active';
		modal.setAttribute('role', 'dialog');
		modal.setAttribute('aria-modal', 'true');
		modal.setAttribute('aria-label', 'Create Mii options');
		const overlay = document.createElement('div');
		overlay.className = 'o-modal__overlay';
		modal.append(overlay);
		const container = document.createElement('div');
		container.className = 'o-modal__container c-mii-modal__container';
		const nav = document.createElement('div');
		nav.className = 'c-mii-nav';
		container.append(nav);
		modal.append(container);
		function close() {
			modal.remove();
			if (createMenu === modal) {
				createMenu = null;
				createMenuClose = null;
			}
			addControl.focus?.();
		}
		createMenuClose = close;
		overlay.addEventListener('click', close);
		for (const [label, action] of [
			['Create', () => { close(); addControl.click(); }],
			['Restore', () => { close(); void showRestoreDialog(); }],
			['Import', () => { close(); void startImport(); }],
			['Close', close]
		]) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = `c-mii-nav__btn${label === 'Close' ? ' o-modal__close' : ''}`;
			button.textContent = label;
			button.addEventListener('click', action);
			nav.append(button);
		}
		(document.body || document.documentElement).append(modal);
		createMenu = modal;
		nav.firstElementChild?.focus();
	}

	function isFull() {
		return (document.body?.innerText || '').replace(/\s+/g, ' ').includes(FULL_TEXT);
	}

	async function showRestoreDialog() {
		if (isFull()) { showMessage(FULL_MESSAGE); return; }
		try {
			const capacity = await requestMain('mii-studio-fixer:restore-capacity-request',
				'mii-studio-fixer:restore-capacity-result', { id: makeId() });
			if (capacity.status === 'full') { showMessage(FULL_MESSAGE); return; }
		} catch (error) {
			showMessage(error.message || 'Could not check whether a Mii can be restored.');
			return;
		}
		try { await loadEntries(); }
		catch { showMessage('Could not load stored Miis. Try again.'); return; }
		if (!entries.length) { showMessage('No Miis stored yet.'); return; }
		const panel = showDialog();
		const choices = document.createElement('div');
		choices.className = 'mii-studio-fixer-choices';
		panel.append(choices);
		const error = addError(panel);
		for (const entry of entries) {
			addButton(choices, entry.name, false, async () => {
				if (busy) return;
				busy = true;
				for (const button of choices.querySelectorAll('button')) button.disabled = true;
				try {
					const silent = await requestMain(RESTORE_CREATE_REQUEST, RESTORE_CREATE_RESULT,
						{ id: makeId(), entryId: entry.id, data: entry.data }, 60000);
					if (silent.status === 'saved') {
						await removeRestoredEntry(silent);
						busy = false;
						closeDialog();
						location.reload();
						return;
					}
					if (silent.status !== 'unavailable') {
						throw new Error(`${silent.message || 'Could not verify whether Mii Studio saved this Mii.'} Refresh the saved Mii list before trying again.`);
					}
					const result = await requestMain(RESTORE_REQUEST, RESTORE_RESULT,
						{ id: makeId(), entryId: entry.id, data: entry.data });
					if (result.status === 'full') { busy = false; showMessage(FULL_MESSAGE); return; }
					if (result.status !== 'started' && result.status !== 'saved') {
						throw new Error(result.message || 'Could not restore this Mii. Try again.');
					}
					busy = false;
					closeDialog();
				} catch (cause) {
					busy = false;
					error.textContent = cause.message || 'Could not restore this Mii. Try again.';
					for (const button of choices.querySelectorAll('button')) button.disabled = false;
				}
			});
		}
		addButton(choices, 'Close', false, closeDialog);
		choices.firstElementChild?.focus();
	}

	function rawDataFromImage(source) {
		try {
			const url = new URL(source, location.href);
			if (url.origin !== ORIGIN || url.pathname !== '/miis/image.png') return null;
			const encoded = url.searchParams.get('data');
			if (!/^[a-f0-9]{94}$/i.test(encoded || '')) return null;
			const bytes = encoded.match(/../g).map(part => Number.parseInt(part, 16));
			return bytes.slice(1).map((_, index) =>
				(((bytes[index + 1] - 7) & 255) ^ bytes[index]).toString(16).padStart(2, '0')).join('');
		} catch { return null; }
	}

	function findMiiCard(miiId, data, tileIndex) {
		if (!MII_ID.test(miiId || '')) return null;
		if (Number.isInteger(tileIndex) && tileIndex >= 0) {
			const tile = document.querySelectorAll('.c-mii-btn')[tileIndex];
			if (tile && isVisible(tile)) return tile.querySelector('.c-mii-btn__img') || tile;
		}
		const images = [...document.querySelectorAll('img[src]')]
			.filter(image => isVisible(image) && rawDataFromImage(image.src) === data);
		const imageTiles = [...new Set(images.map(image => image.closest('.c-mii-btn') || image))];
		if (imageTiles.length === 1) return imageTiles[0].querySelector?.('.c-mii-btn__img') || images[0];
		const selectors = [
			`[data-mii-id="${miiId}"]`, `[data-id="${miiId}"]`,
			`a[href*="/miis/${miiId}/edit"]`, `a[href*="/miis/${miiId}"]`
		];
		for (const selector of selectors) {
			const match = document.querySelector(selector);
			if (match && labelOf(match) === 'Edit') continue;
			if (match && isVisible(match)) {
				const tile = match.closest('.c-mii-btn') || match.querySelector('.c-mii-btn');
				return tile?.querySelector('.c-mii-btn__img') || tile
					|| match.closest('button, a, [role="button"]') || match;
			}
		}
		return null;
	}

	async function resumePendingStore() {
		if (resumeRunning) return;
		const pending = readPendingStore();
		if (!pending) return;
		if (pending.phase === 'capture' && isEditorPage()) {
			const pageId = EDIT_PATH.exec(location.pathname)?.[1];
			if (pending.miiId && pageId !== pending.miiId) return;
			resumeRunning = true;
			try {
				pending.miiId = pageId;
				let data = '';
				for (let attempt = 0; attempt < 200; attempt++) {
					const result = await requestMain('mii-studio-fixer:store-editor-capture-request',
						'mii-studio-fixer:store-editor-capture-result', { id: makeId() }, 1000);
					data = result.status === 'captured' ? result.data : '';
					if (MII_DATA.test(data)) break;
					await new Promise(resolve => setTimeout(resolve, 100));
				}
				if (!MII_DATA.test(data)) throw new Error('Could not find Mii data in local storage. Make and revert an edit to your Mii and try again.');
				await saveEntry(pending.name, data, pending.entryId);
				pending.data = data.toLowerCase();
				pending.phase = 'erase';
				savePendingStore(pending);
				document.dispatchEvent(new CustomEvent('mii-studio-fixer:store-exit-request'));
				setTimeout(() => {
					if (isEditorPage() && readPendingStore()?.phase === 'erase') location.assign(pending.listUrl);
				}, 1200);
			} catch (error) {
				console.warn('Could not finish storing the Mii.', error);
				clearPendingStore();
				showMessage(error.message || 'Could not store this Mii. The original Mii has not been erased.');
			} finally { resumeRunning = false; }
		} else if (pending.phase === 'erase' && isListPage()) {
			resumeRunning = true;
			try {
				const saved = (await loadEntries()).find(entry => entry.id === pending.entryId
					&& (!pending.data || entry.data === pending.data));
				if (!saved) throw new Error('The stored copy is no longer available. The original Mii has not been erased.');
				let lastClick = 0;
				for (let attempt = 0; attempt < 60; attempt++) {
					let menu = getMenu();
					if (!menu && Date.now() - lastClick >= 500) {
						const card = findMiiCard(pending.miiId, saved.data, pending.tileIndex);
						if (card) { card.click(); lastClick = Date.now(); }
						menu = getMenu();
					}
					let openedId = menu ? nativeEditId(menu.edit) : null;
					if (menu && !openedId) {
						const identity = await requestMain('mii-studio-fixer:store-menu-id-request',
							'mii-studio-fixer:store-menu-id-result', { id: makeId() }, 1000);
						openedId = identity.miiId;
					}
					if (menu && openedId === pending.miiId) {
						const deletion = await requestMain(STORE_DELETE_REQUEST, STORE_DELETE_RESULT, {
							id: makeId(), miiId: pending.miiId,
							deleteUrl: deleteUrlForMii(pending.miiId)
						}, 60000);
						if (deletion.status === 'deleted') {
							clearPendingStore();
							location.reload();
							return;
						}
						if (deletion.status !== 'unavailable') {
							throw new Error(`${deletion.message || 'Could not verify whether Mii Studio erased this Mii.'} Refresh the saved Mii list before trying again.`);
						}
						pending.phase = 'confirm-erase';
						savePendingStore(pending);
						menu.erase.click();
						return;
					}
					await new Promise(resolve => setTimeout(resolve, 150));
				}
				throw new Error('Mii stored, but its Erase option could not be opened. Select that Mii and choose Erase to finish.');
			} catch (error) {
				clearPendingStore();
				showMessage(error.message);
			} finally { resumeRunning = false; }
		} else if (pending.phase === 'confirm-erase'
			&& location.origin === ORIGIN
			&& DELETE_PATH.exec(location.pathname)?.[1]?.toLowerCase() === pending.miiId?.toLowerCase()) {
			resumeRunning = true;
			try {
				const saved = (await loadEntries()).find(entry => entry.id === pending.entryId
					&& (!pending.data || entry.data === pending.data));
				if (!saved) throw new Error('The stored copy is no longer available. The original Mii has not been erased.');
				let confirm = null;
				let form = null;
				for (let attempt = 0; attempt < 60; attempt++) {
					if (document.body?.dataset?.pageId === 'mii-delete') {
						form = document.querySelector('form');
						if (form && isVisible(form)) {
							const controls = [...form.querySelectorAll('button, input[type="submit"]')]
								.filter(control => isVisible(control) && !control.disabled
									&& (control.getAttribute('type')?.toLowerCase() === 'submit'
										|| (control.tagName.toLowerCase() === 'button' && !control.getAttribute('type'))));
							const labeled = controls.filter(control => /\b(?:erase|delete)\b/i.test(labelOf(control)));
							const primary = controls.filter(control => control.classList?.contains('c-action__btn--primary'));
							confirm = labeled.length === 1 ? labeled[0]
								: primary.length === 1 ? primary[0]
									: controls.length === 1 ? controls[0] : null;
							if (confirm) break;
						}
					}
					await new Promise(resolve => setTimeout(resolve, 150));
				}
				if (!confirm) throw new Error("Could not find this Mii's Erase confirmation. The stored copy is still available.");
				let submitted = false;
				form.addEventListener('submit', () => { submitted = true; clearPendingStore(); }, { once: true });
				confirm.click();
				if (!submitted) throw new Error("Could not submit this Mii's Erase confirmation. The stored copy is still available.");
			} catch (error) {
				clearPendingStore();
				showMessage(error.message);
			} finally { resumeRunning = false; }
		}
	}

	function refresh() {
		if (isListPage()) {
			refreshExportOption();
			refreshStoreOption();
		}
		void resumePendingStore();
	}

	function scheduleRefresh() {
		if (refreshScheduled) return;
		refreshScheduled = true;
		setTimeout(() => { refreshScheduled = false; refresh(); }, 50);
	}

	chrome.storage.onChanged.addListener((changes, area) => {
		if (area === 'local' && changes[STORED_KEY]) {
			entries = Array.isArray(changes[STORED_KEY].newValue) ? changes[STORED_KEY].newValue : [];
		}
	});
	document.addEventListener('click', event => {
		if (!isListPage()) return;
		const tile = event.target?.closest?.('.c-mii-btn');
		if (tile) selectedTileIndex = [...document.querySelectorAll('.c-mii-btn')].indexOf(tile);
		if (!event.isTrusted || event.target?.closest?.('#mii-studio-fixer-create-modal')) return;
		const addControl = event.target?.closest?.('a[href], button, [role="button"]');
		if (!addControl) return;
		let isCreate = /^(?:Create|Create(?: a)? Mii)$/i.test(labelOf(addControl))
			&& !addControl.closest('.c-mii-modal');
		try {
			const href = addControl.getAttribute('href');
			if (href) {
				const url = new URL(href, location.href);
				isCreate = url.origin === ORIGIN && url.pathname === '/miis/new'
					&& url.searchParams.get('client_id') === new URL(location.href).searchParams.get('client_id');
			}
		} catch { isCreate = false; }
		if (!isCreate) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		showCreateMenu(addControl);
	}, true);
	document.addEventListener('keydown', event => {
		if (event.key === 'Escape' && dialog) { event.stopPropagation(); closeDialog(); }
		else if (event.key === 'Escape' && createMenu) {
			event.stopPropagation();
			createMenuClose?.();
		}
	});
	document.addEventListener(RESTORE_RESULT, event => {
		if (event.detail?.status === 'saved') void removeRestoredEntry(event.detail);
		if ((isEditorPage() || document.querySelector('canvas#canvas'))
			&& ['error', 'invalid'].includes(event.detail?.status)) {
			sessionStorage.removeItem(RESTORE_ERROR_KEY);
			showMessage(event.detail.message || 'Could not restore this Mii. Try again.');
		}
	});
	if (isEditorPage() || document.querySelector('canvas#canvas')) {
		try {
			const error = JSON.parse(sessionStorage.getItem(RESTORE_ERROR_KEY) || 'null');
			sessionStorage.removeItem(RESTORE_ERROR_KEY);
			if (error && Date.now() - error.at < 60000) {
				showMessage(error.message || 'Could not restore this Mii. Try again.');
			}
		} catch { sessionStorage.removeItem(RESTORE_ERROR_KEY); }
	}
	void requestMain(RESTORE_SUCCESS_REQUEST, RESTORE_SUCCESS_RESULT, { id: makeId() }, 1000)
		.then(removeRestoredEntry).catch(error => console.warn('Could not check restored Mii transfer.', error));
	loadEntries().then(refresh).catch(error => console.warn('Could not load stored Miis.', error));
	new MutationObserver(scheduleRefresh).observe(document.documentElement, { childList: true, subtree: true });
	setInterval(scheduleRefresh, 500);
})();

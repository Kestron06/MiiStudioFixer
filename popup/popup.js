const PREVIEW_MODE_STORAGE_KEY = 'mii-studio-fixer-preview-mode';
const LEGACY_PREVIEW_STORAGE_KEY = 'mii-studio-mii-loader-preview-enabled';
const STORED_MIIS_STORAGE_KEY = 'mii-studio-fixer-stored-miis-v1';
const VALID_MODES = new Set(['floating', 'replace', 'off']);
const HEX_ID = /^[a-f0-9]{16}$/;

const options = document.getElementById('preview-options');
const modeInputs = [...document.querySelectorAll('input[name="preview-mode"]')];
const warning = document.getElementById('page-warning');
const storedList = document.getElementById('stored-list');
const storedEmpty = document.getElementById('stored-empty');
const storedStatus = document.getElementById('stored-status');
const deleteDialog = document.getElementById('delete-confirmation');
const deleteMessage = document.getElementById('delete-confirmation-message');
const deleteError = document.getElementById('delete-error');
const deleteCancel = document.getElementById('delete-cancel');
const deleteConfirm = document.getElementById('delete-confirm');
let currentMode = 'off';
let pendingDeleteId = null;

function showMode(mode) {
	currentMode = VALID_MODES.has(mode) ? mode : 'off';
	for (const input of modeInputs) {
		input.checked = input.value === currentMode;
	}
}

async function loadMode() {
	try {
		const settings = await chrome.storage.local.get([
			PREVIEW_MODE_STORAGE_KEY,
			LEGACY_PREVIEW_STORAGE_KEY
		]);
		const storedMode = settings[PREVIEW_MODE_STORAGE_KEY];
		const mode = VALID_MODES.has(storedMode)
			? storedMode
			: settings[LEGACY_PREVIEW_STORAGE_KEY] === true ? 'floating' : 'off';
		showMode(mode);
		if (!VALID_MODES.has(storedMode) && typeof settings[LEGACY_PREVIEW_STORAGE_KEY] === 'boolean') {
			await chrome.storage.local.set({ [PREVIEW_MODE_STORAGE_KEY]: mode });
		}
		options.disabled = false;
	} catch (error) {
		console.warn('Could not read the preview setting.', error);
	}
}

options.addEventListener('change', async event => {
	const input = event.target;
	if (input.name !== 'preview-mode' || !VALID_MODES.has(input.value)) {
		return;
	}
	const previousMode = currentMode;
	const nextMode = input.value;
	options.disabled = true;
	showMode(nextMode);
	try {
		await chrome.storage.local.set({ [PREVIEW_MODE_STORAGE_KEY]: nextMode });
	} catch (error) {
		console.warn('Could not save the preview setting.', error);
		showMode(previousMode);
	} finally {
		options.disabled = false;
	}
});

function normalizeStoredMiis(value) {
	return Array.isArray(value)
		? value.filter(entry => entry && typeof entry.id === 'string'
			&& typeof entry.name === 'string' && typeof entry.data === 'string')
		: [];
}

function showDeleteConfirmation(entry) {
	pendingDeleteId = entry.id;
	deleteMessage.textContent = `Delete “${entry.name}” from stored Miis?`;
	deleteError.textContent = '';
	deleteError.hidden = true;
	deleteDialog.showModal();
	deleteCancel.focus();
}

function renderStoredMiis(value) {
	const entries = normalizeStoredMiis(value);
	storedList.replaceChildren();
	for (const entry of entries) {
		const item = document.createElement('li');
		const name = document.createElement('span');
		name.className = 'stored-name';
		name.textContent = entry.name;
		const deleteButton = document.createElement('button');
		deleteButton.type = 'button';
		deleteButton.className = 'delete-icon';
		deleteButton.setAttribute('aria-label', `Delete stored Mii ${entry.name}`);
		deleteButton.title = `Delete ${entry.name}`;
		deleteButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v6m4-6v6"/></svg>';
		deleteButton.addEventListener('click', () => showDeleteConfirmation(entry));
		item.append(name, deleteButton);
		storedList.appendChild(item);
	}
	storedList.hidden = entries.length === 0;
	storedEmpty.hidden = entries.length !== 0;
}

async function loadStoredMiis() {
	try {
		const values = await chrome.storage.local.get(STORED_MIIS_STORAGE_KEY);
		renderStoredMiis(values[STORED_MIIS_STORAGE_KEY]);
		storedStatus.textContent = '';
	} catch (error) {
		console.warn('Could not read stored Miis.', error);
		storedStatus.textContent = 'Could not load stored Miis.';
	}
}

deleteCancel.addEventListener('click', () => deleteDialog.close());
deleteDialog.addEventListener('close', () => { pendingDeleteId = null; });
deleteConfirm.addEventListener('click', async () => {
	const id = pendingDeleteId;
	if (id === null) return;
	deleteConfirm.disabled = true;
	deleteCancel.disabled = true;
	try {
		const values = await chrome.storage.local.get(STORED_MIIS_STORAGE_KEY);
		const entries = Array.isArray(values[STORED_MIIS_STORAGE_KEY])
			? values[STORED_MIIS_STORAGE_KEY] : [];
		const remaining = entries.filter(entry => entry?.id !== id);
		if (remaining.length !== entries.length) {
			await chrome.storage.local.set({ [STORED_MIIS_STORAGE_KEY]: remaining });
		}
		renderStoredMiis(remaining);
		storedStatus.textContent = '';
		deleteDialog.close();
	} catch (error) {
		console.warn('Could not delete stored Mii.', error);
		deleteError.textContent = 'Could not delete stored Mii. Try again.';
		deleteError.hidden = false;
	} finally {
		deleteConfirm.disabled = false;
		deleteCancel.disabled = false;
	}
});

chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName === 'local' && changes[STORED_MIIS_STORAGE_KEY]) {
		renderStoredMiis(changes[STORED_MIIS_STORAGE_KEY].newValue);
		storedStatus.textContent = '';
	}
});

function showWarning(kind) {
	if (kind === 'wrong-page') {
		warning.innerHTML = 'Please visit <a href="https://my.nintendo.com/mii" target="_blank" rel="noopener noreferrer">the Mii Studio</a>, then edit a Mii to continue.';
	} else if (kind === 'missing-id') {
		warning.textContent = 'Could not find Mii ID and/or client ID in the URL. Close and revisit the page and try again.';
	} else if (kind === 'missing-data') {
		warning.textContent = 'Could not load the current Mii from the editor. Wait for the editor to finish loading, then reopen this popup.';
	} else {
		warning.textContent = 'The popup failed to initialize. Check the popup console for details and try again.';
	}
	warning.hidden = false;
}

async function readPageMiiData(tabId, canonicalKey) {
	const [{ result }] = await chrome.scripting.executeScript({
		target: { tabId },
		args: [canonicalKey],
		func: function(fallbackKey) {
			return localStorage.getItem(encodeURIComponent(location.href))
				|| localStorage.getItem(fallbackKey);
		}
	});
	return result;
}

async function recoverPageMiiData(tabId, canonicalKey) {
	const [{ result }] = await chrome.scripting.executeScript({
		target: { tabId },
		world: 'MAIN',
		args: [canonicalKey],
		func: async function(fallbackKey) {
			const currentUrl = new URL(location.href);
			const expectedUrl = new URL(decodeURIComponent(fallbackKey));
			if (currentUrl.origin !== expectedUrl.origin
				|| currentUrl.pathname.replace(/\/$/, '') !== expectedUrl.pathname
				|| currentUrl.searchParams.get('client_id') !== expectedUrl.searchParams.get('client_id')) {
				return null;
			}

			const exactKey = encodeURIComponent(location.href);
			const existing = localStorage.getItem(exactKey) || localStorage.getItem(fallbackKey);
			if (existing) {
				return existing;
			}

			for (let attempt = 0; attempt < 20; attempt++) {
				const canvas = document.querySelector('canvas#canvas');
				for (let element = canvas; element; element = element.parentElement) {
					for (let editor = element.__vue__; editor; editor = editor.$parent) {
						if (editor.isPartsPage !== true || !editor.history?.current
							|| typeof editor.onPartsUpdated !== 'function') {
							continue;
						}
						editor.onPartsUpdated(editor.history.current);
						return localStorage.getItem(exactKey) || localStorage.getItem(fallbackKey);
					}
				}
				await new Promise(resolve => setTimeout(resolve, 100));
			}
			return null;
		}
	});
	return result;
}

async function checkCurrentPage() {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		let url;
		try {
			url = new URL(tab?.url ?? '');
		} catch {
			showWarning('wrong-page');
			return;
		}
		if (url.origin !== 'https://studio.mii.nintendo.com') {
			showWarning('wrong-page');
			return;
		}
		if (url.pathname === '/miis/new') {
			warning.textContent = 'The Mii must be saved once before we can process it.';
			warning.hidden = false;
			return;
		}
		const clientId = url.searchParams.get('client_id');
		if (url.pathname === '/' && HEX_ID.test(clientId ?? '')) {
			return;
		}
		if (!/^\/miis\/[^/]+\/edit\/?$/.test(url.pathname)) {
			showWarning('wrong-page');
			return;
		}
		const miiId = url.pathname.split('/')[2];
		if (!HEX_ID.test(miiId) || !HEX_ID.test(clientId ?? '')) {
			showWarning('missing-id');
			return;
		}

		const canonicalKey = encodeURIComponent(`https://studio.mii.nintendo.com/miis/${miiId}/edit?client_id=${clientId}`);
		let data = await readPageMiiData(tab.id, canonicalKey);
		if (!data) {
			try {
				data = await recoverPageMiiData(tab.id, canonicalKey);
			} catch (error) {
				console.warn('Could not load the current Mii from the editor.', error);
			}
		}
		if (!data) {
			showWarning('missing-data');
		}
	} catch (error) {
		console.error('Failed to initialize popup', error);
		showWarning('init-error');
	}
}

loadMode();
loadStoredMiis();
checkCurrentPage();

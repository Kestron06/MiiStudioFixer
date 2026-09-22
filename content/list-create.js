(() => {
	'use strict';

	const REQUEST_EVENT = 'mii-studio-fixer:restore-create-request';
	const RESULT_EVENT = 'mii-studio-fixer:restore-create-result';
	const SUCCESS_KEY = 'mii-studio-fixer:restore-success';
	const ORIGIN = 'https://studio.mii.nintendo.com';
	const RAW_HEX = /^[a-f0-9]{92}$/i;
	const IMAGE_HEX = /^[a-f0-9]{94}$/i;
	const MII_ID = /^[a-f0-9]{16}$/i;
	const EDIT_PATH = /^\/miis\/([a-f0-9]{16})\/edit\/?$/i;
	let busy = false;

	function report(id, status, message, entryId, data, source) {
		document.dispatchEvent(new CustomEvent(RESULT_EVENT, {
			detail: { id, status, ...(message ? { message } : {}),
				...(status === 'saved' ? { ...(source === 'import' ? { source } : { entryId }), data } : {}) }
		}));
	}

	function listIds(page, pageUrl) {
		if (page.body?.dataset?.pageId !== 'mii-list') return null;
		const ids = new Set();
		for (const link of page.querySelectorAll('a[href]')) {
			const url = new URL(link.getAttribute('href'), pageUrl);
			const match = EDIT_PATH.exec(url.pathname);
			if (url.origin === ORIGIN && match) ids.add(match[1].toLowerCase());
		}
		return ids.size <= 6 ? ids : null;
	}

	async function getPage(url, pathname, clientId) {
		const response = await fetch(url, {
			credentials: 'include', redirect: 'follow', cache: 'no-store',
			headers: { Accept: 'text/html' }
		});
		const finalUrl = new URL(response.url);
		if (!response.ok || finalUrl.origin !== ORIGIN || finalUrl.pathname !== pathname
			|| finalUrl.searchParams.get('client_id') !== clientId
			|| !response.headers.get('content-type')?.toLowerCase().includes('text/html')) {
			throw new Error('Could not verify the authenticated Mii Studio page.');
		}
		return { page: new DOMParser().parseFromString(await response.text(), 'text/html'), url: finalUrl };
	}

	document.addEventListener(REQUEST_EVENT, async event => {
		const { id, entryId, data, source } = event.detail || {};
		const isImport = source === 'import';
		if (typeof id !== 'string' || !id || (source !== undefined && !isImport)
			|| (!isImport && (typeof entryId !== 'string' || !entryId))
			|| typeof data !== 'string' || !RAW_HEX.test(data) || busy) {
			report(id, 'unavailable', 'Mii data is invalid or a Mii is already being created.');
			return;
		}
		let postStarted = false;
		busy = true;
		try {
			const listUrl = new URL(location.href);
			const clientId = listUrl.searchParams.get('client_id');
			if (listUrl.origin !== ORIGIN || listUrl.pathname !== '/' || !MII_ID.test(clientId || '')) {
				throw new Error('Open the Mii Studio saved Mii list before restoring a Mii.');
			}
			if (sessionStorage.getItem(SUCCESS_KEY)) {
				report(id, 'uncertain', 'A previous restore is still being confirmed. Refresh the saved Mii list before trying again.');
				return;
			}
			const before = await getPage(listUrl.href, '/', clientId);
			const previousIds = listIds(before.page, before.url);
			if (!previousIds || previousIds.size >= 6) {
				throw new Error('One or more Miis will need to be stored or deleted before restoring any saved Miis.');
			}
			const newUrl = new URL('/miis/new', ORIGIN);
			newUrl.searchParams.set('client_id', clientId);
			const editor = await getPage(newUrl.href, '/miis/new', clientId);
			if (editor.page.body?.dataset?.pageId !== 'mii-new') {
				throw new Error('Could not verify the new Mii page.');
			}
			const clientMetas = [...editor.page.querySelectorAll('meta[name="client-id"]')];
			const csrfMetas = [...editor.page.querySelectorAll('meta[name="csrf-token"]')];
			const csrfToken = csrfMetas[0]?.getAttribute('content');
			if (clientMetas.length !== 1 || clientMetas[0].getAttribute('content') !== clientId
				|| csrfMetas.length !== 1 || typeof csrfToken !== 'string' || !csrfToken) {
				throw new Error('Could not verify Mii Studio creation credentials.');
			}
			const raw = Uint8Array.from(data.match(/../g), part => Number.parseInt(part, 16));
			const encoded = new Uint8Array(47);
			crypto.getRandomValues(encoded.subarray(0, 1));
			for (let index = 0; index < raw.length; index++) {
				encoded[index + 1] = ((raw[index] ^ encoded[index]) + 7) & 255;
			}
			const studioData = Array.from(encoded, byte => byte.toString(16).padStart(2, '0')).join('');
			if (!IMAGE_HEX.test(studioData)) throw new Error('Could not encode the stored Mii.');
			const createUrl = new URL('/miis/create', ORIGIN);
			postStarted = true;
			const created = await fetch(createUrl.href, {
				method: 'POST', credentials: 'include', redirect: 'follow', cache: 'no-store',
				referrer: editor.url.href,
				headers: { Accept: 'text/html', 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ csrf_token: csrfToken, client_id: clientId, data: studioData })
			});
			if (!created.ok || new URL(created.url).origin !== ORIGIN) {
				throw new Error('Mii Studio did not confirm the Create request.');
			}
			const after = await getPage(listUrl.href, '/', clientId);
			const currentIds = listIds(after.page, after.url);
			if (!currentIds) throw new Error('Could not verify the saved Mii list after creating the Mii.');
			const added = [...currentIds].filter(miiId => !previousIds.has(miiId));
			if (added.length !== 1 || currentIds.size !== previousIds.size + 1) {
				throw new Error('Could not identify one newly saved Mii. Refresh the list before trying again.');
			}
			const editUrl = new URL(`/miis/${added[0]}/edit`, ORIGIN);
			editUrl.searchParams.set('client_id', clientId);
			const saved = await getPage(editUrl.href, editUrl.pathname, clientId);
			if (saved.page.body?.dataset?.pageId !== 'mii-edit') {
				throw new Error('Could not verify the newly saved Mii edit page.');
			}
			const params = saved.page.body.getAttribute('data-params');
			let savedData = null;
			if (RAW_HEX.test(params || '')) savedData = params.toLowerCase();
			else if (IMAGE_HEX.test(params || '')) {
				const bytes = Uint8Array.from(params.match(/../g), part => Number.parseInt(part, 16));
				savedData = Array.from(bytes.slice(1), (_, index) =>
					(((bytes[index + 1] - 7) & 255) ^ bytes[index]).toString(16).padStart(2, '0')).join('');
			}
			if (savedData !== data.toLowerCase()) {
				throw new Error('The newly saved Mii data does not match the stored copy.');
			}
			if (!isImport) {
				sessionStorage.setItem(SUCCESS_KEY, JSON.stringify({ entryId, data: data.toLowerCase(), at: Date.now() }));
			}
			report(id, 'saved', null, entryId, data.toLowerCase(), source);
		} catch (error) {
			report(id, postStarted ? 'uncertain' : 'unavailable',
				error?.message || 'Could not restore this Mii silently.');
		} finally { busy = false; }
	});
})();

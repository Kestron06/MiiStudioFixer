(() => {
	'use strict';

	const REQUEST_EVENT = 'mii-studio-fixer:store-delete-request';
	const RESULT_EVENT = 'mii-studio-fixer:store-delete-result';
	const ORIGIN = 'https://studio.mii.nintendo.com';
	const MII_ID = /^[a-f0-9]{16}$/i;
	const DELETE_PATH = /^\/miis\/([a-f0-9]{16})\/delete\/?$/i;
	const EDIT_PATH = /^\/miis\/([a-f0-9]{16})\/edit\/?$/i;
	let busy = false;

	function report(id, status, message) {
		document.dispatchEvent(new CustomEvent(RESULT_EVENT, {
			detail: { id, status, ...(message ? { message } : {}) }
		}));
	}

	document.addEventListener(REQUEST_EVENT, async event => {
		const { id, miiId, deleteUrl } = event.detail || {};
		if (typeof id !== 'string' || !MII_ID.test(miiId || '') || busy) {
			report(id, 'unavailable', 'Could not identify the Mii to erase on this page.');
			return;
		}
		let postStarted = false;
		busy = true;
		try {
			if (location.origin !== ORIGIN || location.pathname !== '/') {
				throw new Error('Open the saved Mii list to store a Mii.');
			}
			const clientId = new URL(location.href).searchParams.get('client_id');
			const target = new URL(deleteUrl, location.href);
			if (!MII_ID.test(clientId || '') || target.origin !== ORIGIN
				|| target.searchParams.get('client_id') !== clientId
				|| DELETE_PATH.exec(target.pathname)?.[1]?.toLowerCase() !== miiId.toLowerCase()) {
				throw new Error('The selected Mii Erase page could not be verified.');
			}
			const page = await fetch(target.href, {
				credentials: 'same-origin', redirect: 'follow', cache: 'no-store',
				headers: { Accept: 'text/html' }
			});
			const pageUrl = new URL(page.url);
			if (!page.ok || pageUrl.origin !== ORIGIN
				|| DELETE_PATH.exec(pageUrl.pathname)?.[1]?.toLowerCase() !== miiId.toLowerCase()) {
				throw new Error('The selected Mii Erase page could not be loaded.');
			}
			const deletion = new DOMParser().parseFromString(await page.text(), 'text/html');
			if (deletion.body?.dataset?.pageId !== 'mii-delete') {
				throw new Error('The selected Mii Erase form could not be verified.');
			}
			const forms = [...deletion.querySelectorAll('form')];
			if (forms.length !== 1) throw new Error('The selected Mii Erase form is unavailable.');
			const form = forms[0];
			if ((form.getAttribute('method') || '').toLowerCase() !== 'post') {
				throw new Error('The selected Mii Erase form cannot be submitted silently.');
			}
			const action = new URL(form.getAttribute('action') || pageUrl.href, pageUrl.href);
			if (action.origin !== ORIGIN || DELETE_PATH.exec(action.pathname)?.[1]?.toLowerCase() !== miiId.toLowerCase()) {
				throw new Error('The selected Mii Erase action could not be verified.');
			}
			const controls = [...form.querySelectorAll('button, input[type="submit"]')]
				.filter(control => !control.disabled && (control.getAttribute('type')?.toLowerCase() === 'submit'
					|| (control.tagName.toLowerCase() === 'button' && !control.getAttribute('type'))));
			const labeled = controls.filter(control => /\b(?:erase|delete)\b/i
				.test((control.textContent || control.value || '').trim()));
			const primary = controls.filter(control => control.classList.contains('c-action__btn--primary'));
			const submitter = labeled.length === 1 ? labeled[0]
				: primary.length === 1 ? primary[0]
					: controls.length === 1 ? controls[0] : null;
			if (!submitter) throw new Error('The selected Mii Erase confirmation is unavailable.');
			const fields = new FormData(form);
			if (fields.get('client_id') !== clientId) {
				throw new Error('The selected Mii Erase form belongs to a different client.');
			}
			if (submitter.name) fields.append(submitter.name, submitter.value || '');
			const enctype = (form.getAttribute('enctype') || 'application/x-www-form-urlencoded').toLowerCase();
			if (enctype !== 'application/x-www-form-urlencoded' && enctype !== 'multipart/form-data') {
				throw new Error('The selected Mii Erase form uses an unsupported encoding.');
			}
			postStarted = true;
			const response = await fetch(action.href, {
				method: 'POST', credentials: 'same-origin', redirect: 'follow', cache: 'no-store',
				referrer: pageUrl.href,
				headers: { Accept: 'text/html' },
				body: enctype === 'multipart/form-data' ? fields : new URLSearchParams(fields)
			});
			if (!response.ok) throw new Error('Mii Studio did not accept the Erase request.');
			const refreshed = await fetch(location.href, {
				credentials: 'same-origin', redirect: 'follow', cache: 'no-store',
				headers: { Accept: 'text/html' }
			});
			const refreshedUrl = new URL(refreshed.url);
			if (!refreshed.ok || refreshedUrl.origin !== ORIGIN || refreshedUrl.pathname !== '/'
				|| refreshedUrl.searchParams.get('client_id') !== new URL(location.href).searchParams.get('client_id')) {
				throw new Error('Could not verify the refreshed saved Mii list.');
			}
			const list = new DOMParser().parseFromString(await refreshed.text(), 'text/html');
			if (list.body?.dataset?.pageId !== 'mii-list') {
				throw new Error('Could not verify the refreshed saved Mii list.');
			}
			for (const link of list.querySelectorAll('a[href]')) {
				const url = new URL(link.getAttribute('href'), refreshedUrl.href);
				if (url.origin === ORIGIN && EDIT_PATH.exec(url.pathname)?.[1]?.toLowerCase() === miiId.toLowerCase()) {
					throw new Error('Mii Studio still lists this Mii after Erase.');
				}
			}
			report(id, 'deleted');
		} catch (error) {
			report(id, postStarted ? 'uncertain' : 'unavailable',
				error?.message || 'Could not finish erasing this Mii silently.');
		} finally { busy = false; }
	});
})();

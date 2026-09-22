(() => {
	'use strict';

	const REQUEST = 'mii-studio-fixer:popup-page-status';
	const HEX_ID = /^[a-f0-9]{16}$/;

	chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
		if (message?.type !== REQUEST) return;

		(async () => {
			const url = new URL(location.href);
			if (url.origin !== 'https://studio.mii.nintendo.com') return { status: 'wrong-page' };
			if (url.pathname === '/miis/new') return { status: 'new' };

			const clientId = url.searchParams.get('client_id');
			if (url.pathname === '/' && HEX_ID.test(clientId ?? '')) return { status: 'ready' };

			const editPage = /^\/miis\/([^/]+)\/edit\/?$/.exec(url.pathname);
			if (!editPage) return { status: 'wrong-page' };
			if (!HEX_ID.test(editPage[1]) || !HEX_ID.test(clientId ?? '')) {
				return { status: 'missing-id' };
			}

			const exactKey = encodeURIComponent(location.href);
			const canonicalKey = encodeURIComponent(`${url.origin}/miis/${editPage[1]}/edit?client_id=${clientId}`);
			for (let attempt = 0; attempt < 20; attempt++) {
				if (localStorage.getItem(exactKey) || localStorage.getItem(canonicalKey)) {
					return { status: 'ready' };
				}
				let hydrationResult;
				const onHydrationResult = event => { hydrationResult = event.detail; };
				document.addEventListener('mii-studio-fixer:hydrate-result', onHydrationResult);
				document.dispatchEvent(new Event('mii-studio-fixer:hydrate-request'));
				document.removeEventListener('mii-studio-fixer:hydrate-result', onHydrationResult);
				if (localStorage.getItem(exactKey) || localStorage.getItem(canonicalKey)) {
					return { status: 'ready' };
				}
				if (hydrationResult === 'no-data' || hydrationResult === 'error') {
					return { status: 'missing-data' };
				}
				await new Promise(resolve => setTimeout(resolve, 100));
			}
			return { status: 'missing-data' };
		})().then(sendResponse, error => {
			console.warn('Could not inspect the current Mii Studio page.', error);
			sendResponse({ status: 'error' });
		});
		return true;
	});
})();

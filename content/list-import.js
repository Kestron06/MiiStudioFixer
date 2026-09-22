(() => {
	'use strict';

	const REQUEST_EVENT = 'mii-studio-fixer:import-file-request';
	const RESULT_EVENT = 'mii-studio-fixer:import-file-result';
	const RAW_HEX = /^[a-f0-9]{92}$/i;
	let picking = false;
	let miijsPromise;

	document.addEventListener(REQUEST_EVENT, event => {
		const id = event.detail?.id;
		if (typeof id !== 'string' || !id) return;
		if (picking) {
			document.dispatchEvent(new CustomEvent(RESULT_EVENT, {
				detail: { id, status: 'error', message: 'A Mii file is already being selected.' }
			}));
			return;
		}
		picking = true;
		const input = document.createElement('input');
		input.type = 'file';
		input.hidden = true;
		(document.body || document.documentElement).append(input);
		let finished = false;
		const finish = detail => {
			if (finished) return;
			finished = true;
			picking = false;
			input.remove();
			document.dispatchEvent(new CustomEvent(RESULT_EVENT, { detail: { id, ...detail } }));
		};
		input.addEventListener('cancel', () => finish({ status: 'cancelled' }), { once: true });
		input.addEventListener('change', async () => {
			const file = input.files?.[0];
			if (!file) { finish({ status: 'cancelled' }); return; }
			try {
				let data = '';
				const bytes = new Uint8Array(await file.arrayBuffer());
				const isImage = (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71
					&& bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10)
					|| (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
					|| (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
						&& String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP');
				const text = isImage ? '' : new TextDecoder().decode(bytes).replace(/\s+/g, '');
				if (RAW_HEX.test(text)) data = text.toLowerCase();
				else {
					miijsPromise ??= import(chrome.runtime.getURL('miijs.browser.js')).then(module => module.default);
					const miijs = await miijsPromise;
					let input = bytes;
					if (isImage) {
						input = await miijs.scanQR(bytes);
						if (!input) throw new Error('Could not find a Mii QR code in the selected image.');
					} else if (/^(?:[a-f0-9]{2})+$/i.test(text)) {
						input = Uint8Array.from(text.match(/../g), pair => parseInt(pair, 16));
					} else if (/^[a-z0-9+/_-]+={0,2}$/i.test(text) && text.length >= 4) {
						try {
							input = Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=')), character => character.charCodeAt(0));
						} catch { /* Let MiiJS report an unsupported file below. */ }
					}
					if (input.length === 46 && input !== bytes) data = Array.from(input, byte => byte.toString(16).padStart(2, '0')).join('');
					else {
						let decoded;
						try { decoded = await miijs.decodeMii(input); }
						catch {
							let qrData;
							try { qrData = await miijs.scanQR(input); } catch { /* An unsupported file may not be an image. */ }
							if (!qrData) throw new Error('Could not decode the selected Mii file or find a Mii QR code.');
							decoded = await miijs.decodeMii(qrData);
						}
						const encoded = await miijs.encodeMii(decoded, miijs.MiiFormats.MNMS);
						data = Array.from(encoded, byte => byte.toString(16).padStart(2, '0')).join('');
					}
				}
				if (!RAW_HEX.test(data)) throw new Error('Could not convert the selected file into Mii Studio data.');
				finish({ status: 'ready', data, fileName: file.name });
			} catch (error) {
				finish({ status: 'error', message: error?.message || 'Could not import the selected Mii file.' });
			}
		}, { once: true });
		try { input.click(); }
		catch (error) { finish({ status: 'error', message: error?.message || 'Could not open the file selector.' }); }
	});
})();

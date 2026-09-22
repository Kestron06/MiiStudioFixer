(() => {
	'use strict';

	const FORMATS = [
		['MNMS', '.MNMS | Mii Studio'],
		['CHARINFO', '.CHARINFO | Switch/2'],
		['NFCD', '.NFCD | Switch/2'],
		['FSDEX', '.FSDEX | Switch 2/Amiibo'],
		['PNG_ALL', '.PNG | All QR'],
		['CFCD', '.CFSD/.FFSD | 3DS/Wii U (ver3)'],
		['RCD', '.RCD | Wii'],
		['NCD', '.NCD | DS']
	];
	const DEFAULTS = {
		creatorMac: '732F6D6E6D73',
		creatorName: 'Mii Loader',
		name: 'Mii Studio',
		systemId: '6D69692E746F6F6C'
	};
	const QR_FACE_ENDPOINT = 'https://studio.mii.nintendo.com/miis/image.png';
	let miijsPromise;
	let openDialog;

	function toBytes(value) {
		if (value instanceof Uint8Array) return value;
		if (value instanceof ArrayBuffer) return new Uint8Array(value);
		if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
		return new Uint8Array(value);
	}

	async function getMiijs() {
		miijsPromise ??= import(chrome.runtime.getURL('miijs.browser.js')).then(module => module.default);
		return miijsPromise;
	}

	async function getQrFace(miijs, mii) {
		const renderData = toBytes(await miijs.encodeMii(mii, miijs.MiiFormats.EMNMS));
		const hex = Array.from(renderData, byte => byte.toString(16).padStart(2, '0')).join('');
		const response = await fetch(`${QR_FACE_ENDPOINT}?data=${hex}&type=face&width=512&instanceCount=1`);
		if (!response.ok) throw new Error('Could not load this Mii\'s QR face image.');
		return new Uint8Array(await response.arrayBuffer());
	}

	async function exportBytes(data, format) {
		const miijs = await getMiijs();
		const decoded = await miijs.decodeMii(data);
		const mii = structuredClone(decoded);
		mii.meta = { ...(mii.meta || {}), ...DEFAULTS };
		if (format === 'PNG_ALL') {
			const qrData = await miijs.encodeMii(mii, miijs.MiiFormats.FEDEX);
			return toBytes(await miijs.makeQR(qrData, { image: await getQrFace(miijs, mii) }));
		}
		return toBytes(await miijs.encodeMii(mii, miijs.MiiFormats[format]));
	}

	function download(name, bytes, mimeType) {
		const url = URL.createObjectURL(new Blob([toBytes(bytes)], { type: mimeType }));
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = name;
		(document.body || document.documentElement).append(anchor);
		anchor.click();
		anchor.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	function show({ data }) {
		if (typeof data !== 'string' || !/^[a-f\d]{92}$/i.test(data)) {
			throw new Error('Could not read this Mii for export.');
		}
		if (openDialog && !openDialog()) throw new Error('An export is already running.');
		const previousFocus = document.activeElement;
		const overlay = document.createElement('div');
		overlay.id = 'mii-studio-fixer-export-dialog';
		overlay.setAttribute('role', 'presentation');
		const panel = document.createElement('div');
		panel.className = 'mii-studio-fixer-panel';
		panel.setAttribute('role', 'dialog');
		panel.setAttribute('aria-modal', 'true');
		panel.setAttribute('aria-label', 'Export');
		overlay.append(panel);
		const title = document.createElement('p');
		title.className = 'mii-studio-fixer-message';
		title.textContent = 'Export';
		panel.append(title);
		const label = document.createElement('label');
		label.textContent = 'File format';
		label.htmlFor = 'mii-studio-fixer-export-format';
		panel.append(label);
		const select = document.createElement('select');
		select.id = label.htmlFor;
		for (const [value, text] of FORMATS) {
			const option = document.createElement('option');
			option.value = value;
			option.textContent = text;
			select.append(option);
		}
		panel.append(select);
		const error = document.createElement('p');
		error.className = 'mii-studio-fixer-error';
		error.setAttribute('role', 'alert');
		panel.append(error);
		const actions = document.createElement('div');
		actions.className = 'mii-studio-fixer-actions';
		panel.append(actions);
		const save = document.createElement('button');
		save.type = 'button';
		save.className = 'mii-studio-fixer-primary';
		save.textContent = 'Download';
		actions.append(save);
		const close = document.createElement('button');
		close.type = 'button';
		close.textContent = 'Close';
		actions.append(close);
		let working = false;
		const dismiss = () => {
			if (working) return false;
			overlay.remove();
			if (openDialog === dismiss) openDialog = null;
			document.removeEventListener('keydown', onKeyDown, true);
			if (previousFocus?.isConnected) previousFocus.focus();
			return true;
		};
		const onKeyDown = event => {
			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				dismiss();
			}
		};
		overlay.addEventListener('click', event => { if (event.target === overlay) dismiss(); });
		close.addEventListener('click', dismiss);
		save.addEventListener('click', async () => {
			if (working) return;
			working = true;
			save.disabled = close.disabled = select.disabled = true;
			error.textContent = '';
			try {
				const format = select.value;
				if (!FORMATS.some(([value]) => value === format)) throw new Error('Choose an export format.');
				const bytes = await exportBytes(data, format);
				const extension = format === 'PNG_ALL' ? 'png' : format.toLowerCase();
				download(`mii.${extension}`, bytes, format === 'PNG_ALL' ? 'image/png' : 'application/octet-stream');
				working = false;
				dismiss();
			} catch (cause) {
				console.error('MiiStudioFixer could not export the Mii.', cause);
				error.textContent = cause.message || 'Could not export this Mii.';
				working = false;
				save.disabled = close.disabled = select.disabled = false;
			}
		});
		(document.body || document.documentElement).append(overlay);
		openDialog = dismiss;
		document.addEventListener('keydown', onKeyDown, true);
		select.focus();
	}

	globalThis.MiiStudioFixerExport = { show };
})();

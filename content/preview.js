(() => {
	'use strict';

	const PREVIEW_MODE_STORAGE_KEY = 'mii-studio-fixer-preview-mode';
	const LEGACY_PREVIEW_STORAGE_KEY = 'mii-studio-mii-loader-preview-enabled';
	const PREVIEW_LAYOUT_STORAGE_KEY = 'mii-studio-mii-loader-preview-layout-v1';
	const PREVIEW_ELEMENT_ID = 'mii-studio-mii-loader-real-preview';
	const MII_STUDIO_RENDER_ENDPOINT = 'https://studio.mii.nintendo.com/miis/image.png';
	const MII_ID_REGEX = /^\/miis\/([a-f\d]{16})\/edit\/?$/i;
	const CLIENT_ID_REGEX = /^[a-f\d]{16}$/i;
	const POLL_INTERVAL_MS = 750;
	const UPDATE_DEBOUNCE_MS = 250;
	const RETRY_INITIAL_MS = 2000;
	const RETRY_MAX_MS = 30000;
	const MIN_PREVIEW_WIDTH = 96;
	const MIN_PREVIEW_HEIGHT = 96;
	const MAX_PREVIEW_DIMENSION = 512;
	const VIEWPORT_GUTTER = 16;
	const SNAP_DISTANCE = 28;
	const KEYBOARD_STEP = 8;
	const SETTLE_ANIMATION_MS = 320;
	const RESIZE_DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
	const SHADOW_STYLES = `
		* {
			box-sizing: border-box;
		}

		figure {
			position: absolute;
			inset: 0;
			display: grid;
			place-items: center;
			margin: 0;
			border-radius: inherit;
			overflow: hidden;
			cursor: grab;
			touch-action: none;
			transition:
				transform 180ms cubic-bezier(0.22, 1, 0.36, 1),
				filter 180ms ease;
		}

		.preview-image {
			position: absolute;
			left: 50%;
			top: -46.97%;
			display: none;
			width: auto;
			max-width: none;
			height: 155.15%;
			object-fit: fill;
			transform: translateX(-50%);
			pointer-events: none;
			user-select: none;
		}

		.preview-status {
			padding: 12px;
			color: #5f6368;
			font: 600 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
			text-align: center;
			pointer-events: none;
			user-select: none;
		}

		.drag-affordance {
			position: absolute;
			top: 7px;
			left: 50%;
			z-index: 2;
			width: 28px;
			height: 4px;
			border-radius: 999px;
			background: rgba(31, 31, 31, 0.42);
			opacity: 0;
			transform: translateX(-50%);
			transition: opacity 150ms ease;
			pointer-events: none;
		}

		.preview-close {
			position: absolute;
			top: 6px;
			right: 6px;
			z-index: 4;
			display: grid;
			place-items: center;
			width: 26px;
			height: 26px;
			padding: 0;
			border: 1px solid rgba(0, 0, 0, 0.17);
			border-radius: 50%;
			background: rgba(255, 255, 255, 0.94);
			box-shadow: 0 2px 8px rgba(0, 0, 0, 0.17);
			color: #363636;
			font: 600 18px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
			cursor: pointer;
			opacity: 0;
			pointer-events: none;
			transition: opacity 150ms ease, background 150ms ease;
		}

		:host(:hover) .preview-close,
		:host(:focus-within) .preview-close {
			opacity: 1;
			pointer-events: auto;
		}

		.preview-close:hover {
			background: #fff;
		}

		.preview-close:focus-visible {
			outline: 2px solid #c7172f;
			outline-offset: 2px;
		}

		@media (hover: none) {
			.preview-close {
				opacity: 1;
				pointer-events: auto;
			}
		}

		.resize-handle {
			position: absolute;
			z-index: 3;
			display: block;
			touch-action: none;
		}

		.viewport-insets {
			position: absolute;
			visibility: hidden;
			pointer-events: none;
			padding: max(16px, env(safe-area-inset-top))
				max(16px, env(safe-area-inset-right))
				max(16px, env(safe-area-inset-bottom))
				max(16px, env(safe-area-inset-left));
		}

		.interaction-announcement {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}

		.resize-handle[data-resize="n"],
		.resize-handle[data-resize="s"] {
			left: 24px;
			right: 24px;
			height: 14px;
			cursor: ns-resize;
		}

		.resize-handle[data-resize="n"] {
			top: 0;
		}

		.resize-handle[data-resize="s"] {
			bottom: 0;
		}

		.resize-handle[data-resize="e"],
		.resize-handle[data-resize="w"] {
			top: 24px;
			bottom: 24px;
			width: 14px;
			cursor: ew-resize;
		}

		.resize-handle[data-resize="e"] {
			right: 0;
		}

		.resize-handle[data-resize="w"] {
			left: 0;
		}

		.resize-handle[data-resize="ne"],
		.resize-handle[data-resize="nw"],
		.resize-handle[data-resize="se"],
		.resize-handle[data-resize="sw"] {
			width: 24px;
			height: 24px;
		}

		.resize-handle[data-resize="ne"] {
			top: 0;
			right: 0;
			cursor: nesw-resize;
		}

		.resize-handle[data-resize="nw"] {
			top: 0;
			left: 0;
			cursor: nwse-resize;
		}

		.resize-handle[data-resize="se"] {
			right: 0;
			bottom: 0;
			cursor: nwse-resize;
		}

		.resize-handle[data-resize="sw"] {
			bottom: 0;
			left: 0;
			cursor: nesw-resize;
		}

		.resize-handle[data-resize="se"]::after {
			content: "";
			position: absolute;
			right: 4px;
			bottom: 4px;
			width: 9px;
			height: 9px;
			border-right: 2px solid rgba(31, 31, 31, 0.45);
			border-bottom: 2px solid rgba(31, 31, 31, 0.45);
			border-bottom-right-radius: 2px;
			opacity: 0.7;
			transition: opacity 150ms ease;
		}

		.resize-handle[data-resize="se"]:hover::after,
		:host([data-interaction="resize"]) .resize-handle[data-resize="se"]::after {
			opacity: 1;
		}

		:host(:hover) .drag-affordance,
		:host(:focus-visible) .drag-affordance,
		:host([data-interaction]) .drag-affordance {
			opacity: 0.72;
		}

		:host([data-interaction]) figure {
			transform: scale(0.985);
			filter: saturate(1.04);
		}

		:host([data-interaction="move"]) figure {
			cursor: grabbing;
		}

		:host([data-settling]) figure {
			animation: preview-settle 300ms cubic-bezier(0.22, 1, 0.36, 1);
		}

		:host([data-state="ready"]) .preview-image {
			display: block;
		}

		:host([data-state="ready"]) .preview-status {
			display: none;
		}

		:host([data-state="error"]) .preview-status {
			color: #8d1727;
		}

		@keyframes preview-settle {
			0% { transform: scale(0.985); }
			58% { transform: scale(1.018); }
			100% { transform: scale(1); }
		}

		@media (prefers-reduced-motion: reduce) {
			figure,
			.drag-affordance,
			.resize-handle[data-resize="se"]::after {
				transition: none;
			}

			:host([data-settling]) figure {
				animation: none;
			}
		}
	`;

	let previewMode = 'off';
	let hasExplicitPreviewMode = false;
	let pollTimer = null;
	let updateTimer = null;
	let retryTimer = null;
	let retryDelayMs = RETRY_INITIAL_MS;
	let lastObservedFingerprint = null;
	let renderGeneration = 0;
	let storedPreviewLayout = null;
	let layoutSaveTimer = null;
	let layoutWritePromise = Promise.resolve();
	let viewportUpdateFrame = null;
	let miijsPromise;
	let overlay;
	let canvasReplacement = null;
	let readyCanvasRenderUrl = '';
	let readyCanvasStorageKey = '';
	let lastHydrationKey = '';
	let lastHydrationAt = 0;

	function snapshotStorageKey(snapshot) {
		return snapshot.fingerprint.split('\u0000', 1)[0];
	}

	function removeCanvasReplacement() {
		const current = canvasReplacement;
		if (!current) {
			return;
		}

		canvasReplacement = null;
		current.observer?.disconnect();
		if (current.pendingImage) {
			current.pendingImage.onload = null;
			current.pendingImage.onerror = null;
			current.pendingImage.removeAttribute('src');
		}
		current.canvas.removeAttribute('data-real-mii-preview-hidden');
		current.host.remove();
		if (current.changedParentPosition && current.parent.style.getPropertyValue('position') === 'relative') {
			current.parent.style.setProperty('position', current.parentPosition, current.parentPositionPriority);
		}
	}

	function syncCanvasReplacementGeometry(current) {
		if (!current.canvas.isConnected || !current.host.isConnected) {
			return;
		}

		current.host.style.left = `${current.canvas.offsetLeft}px`;
		current.host.style.top = `${current.canvas.offsetTop}px`;
		current.host.style.width = `${current.canvas.offsetWidth}px`;
		current.host.style.height = `${current.canvas.offsetHeight}px`;
	}

	function syncCanvasReplacement() {
		if (previewMode !== 'replace' || !readyCanvasRenderUrl) {
			removeCanvasReplacement();
			return;
		}

		const canvas = document.getElementById('canvas');
		if (canvas?.tagName !== 'CANVAS' || !canvas.parentElement) {
			removeCanvasReplacement();
			return;
		}

		if (canvasReplacement && (canvasReplacement.canvas !== canvas || !canvasReplacement.host.isConnected)) {
			removeCanvasReplacement();
		}

		if (!canvasReplacement) {
			const parent = canvas.parentElement;
			const host = document.createElement('div');
			host.id = 'real-mii-preview-canvas-replacement';
			host.setAttribute('aria-label', 'Full body Mii preview');
			host.style.visibility = 'hidden';
			const parentPosition = parent.style.getPropertyValue('position');
			const parentPositionPriority = parent.style.getPropertyPriority('position');
			const changedParentPosition = getComputedStyle(parent).position === 'static';
			if (changedParentPosition) {
				parent.style.setProperty('position', 'relative');
			}
			canvas.after(host);
			const current = {
				canvas, parent, host, parentPosition, parentPositionPriority,
				changedParentPosition, image: null, pendingImage: null, pendingUrl: '', url: '', observer: null
			};
			canvasReplacement = current;
			if (typeof ResizeObserver === 'function') {
				current.observer = new ResizeObserver(() => syncCanvasReplacementGeometry(current));
				current.observer.observe(canvas);
			}
		}

		const current = canvasReplacement;
		syncCanvasReplacementGeometry(current);
		if (current.url === readyCanvasRenderUrl || current.pendingUrl === readyCanvasRenderUrl) {
			return;
		}

		if (current.pendingImage) {
			current.pendingImage.onload = null;
			current.pendingImage.onerror = null;
			current.pendingImage.removeAttribute('src');
		}
		const image = document.createElement('img');
		image.className = 'real-mii-preview-canvas-image';
		image.alt = 'Full body image of the current Mii';
		image.draggable = false;
		image.decoding = 'async';
		image.referrerPolicy = 'no-referrer';
		current.pendingImage = image;
		current.pendingUrl = readyCanvasRenderUrl;
		image.onload = () => {
			if (canvasReplacement !== current || current.pendingImage !== image || current.pendingUrl !== readyCanvasRenderUrl) {
				return;
			}
			image.onload = null;
			image.onerror = null;
			current.image?.remove();
			current.host.appendChild(image);
			current.image = image;
			current.url = current.pendingUrl;
			current.pendingImage = null;
			current.pendingUrl = '';
			syncCanvasReplacementGeometry(current);
			current.canvas.setAttribute('data-real-mii-preview-hidden', '');
			current.host.style.visibility = 'visible';
			clearPreviewRetry();
		};
		image.onerror = () => {
			if (canvasReplacement !== current || current.pendingImage !== image) {
				return;
			}
			readyCanvasRenderUrl = '';
			readyCanvasStorageKey = '';
			removeCanvasReplacement();
			schedulePreviewRetry(getStudioMiiSnapshot().fingerprint);
		};
		image.src = readyCanvasRenderUrl;
	}

	function getStudioMiiSnapshot() {
		try {
			const currentUrl = new URL(location.href);
			const pathMatch = MII_ID_REGEX.exec(currentUrl.pathname);
			const clientId = currentUrl.searchParams.get('client_id') ?? '';

			if (!pathMatch || !CLIENT_ID_REGEX.test(clientId)) {
				return { data: '', fingerprint: '' };
			}

			const [, miiId] = pathMatch;
			const editorUrl = `${currentUrl.origin}/miis/${miiId}/edit?client_id=${clientId}`;
			const exactKey = encodeURIComponent(location.href);
			const fallbackKey = encodeURIComponent(editorUrl);
			const exactData = localStorage.getItem(exactKey)?.trim() ?? '';
			const fallbackData = exactData ? '' : localStorage.getItem(fallbackKey)?.trim() ?? '';
			const storageKey = exactData || !fallbackData ? exactKey : fallbackKey;
			const data = exactData || fallbackData;

			return {
				data,
				fingerprint: `${storageKey}\u0000${data}`
			};
		}
		catch {
			return { data: '', fingerprint: '' };
		}
	}

	function hydrateMissingMiiData(snapshot) {
		const storageKey = snapshotStorageKey(snapshot);
		if (!storageKey) {
			return;
		}

		const now = Date.now();
		if (storageKey === lastHydrationKey && now - lastHydrationAt < 2000) {
			return;
		}
		lastHydrationKey = storageKey;
		lastHydrationAt = now;
		document.dispatchEvent(new Event('mii-studio-fixer:hydrate-request'));
	}

	function applyShadowStyles(shadowRoot) {
		try {
			const styleSheet = new CSSStyleSheet();
			styleSheet.replaceSync(SHADOW_STYLES);
			shadowRoot.adoptedStyleSheets = [styleSheet];
		}
		catch {
			const style = document.createElement('style');
			style.textContent = SHADOW_STYLES;
			shadowRoot.appendChild(style);
		}
	}

	function clamp(value, minimum, maximum) {
		return Math.min(maximum, Math.max(minimum, value));
	}

	function finiteNumber(value, fallback) {
		return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
	}

	function getViewportBounds(currentOverlay = overlay) {
		const viewport = window.visualViewport;
		const left = finiteNumber(viewport?.offsetLeft, 0);
		const top = finiteNumber(viewport?.offsetTop, 0);
		const width = Math.max(1, finiteNumber(viewport?.width, 0)
			|| document.documentElement.clientWidth || window.innerWidth || 1);
		const height = Math.max(1, finiteNumber(viewport?.height, 0)
			|| document.documentElement.clientHeight || window.innerHeight || 1);
		const insets = currentOverlay?.insets
			? getComputedStyle(currentOverlay.insets)
			: null;
		const gutter = side => Math.max(VIEWPORT_GUTTER, parseFloat(insets?.getPropertyValue(`padding-${side}`)) || 0);
		const leftInset = Math.min(gutter('left'), Math.max(0, (width - 1) / 2));
		const rightInset = Math.min(gutter('right'), Math.max(0, width - leftInset - 1));
		const topInset = Math.min(gutter('top'), Math.max(0, (height - 1) / 2));
		const bottomInset = Math.min(gutter('bottom'), Math.max(0, height - topInset - 1));

		return {
			left: left + leftInset,
			top: top + topInset,
			right: left + width - rightInset,
			bottom: top + height - bottomInset
		};
	}

	function constrainRect(rect, bounds) {
		const availableWidth = Math.max(1, bounds.right - bounds.left);
		const availableHeight = Math.max(1, bounds.bottom - bounds.top);
		const width = clamp(finiteNumber(rect.width, MIN_PREVIEW_WIDTH), 1,
			Math.min(MAX_PREVIEW_DIMENSION, availableWidth));
		const height = clamp(finiteNumber(rect.height, MIN_PREVIEW_HEIGHT), 1,
			Math.min(MAX_PREVIEW_DIMENSION, availableHeight));

		return {
			x: clamp(finiteNumber(rect.x, bounds.left), bounds.left, bounds.right - width),
			y: clamp(finiteNumber(rect.y, bounds.top), bounds.top, bounds.bottom - height),
			width,
			height
		};
	}

	function normalizeStoredLayout(value) {
		if (!value || value.v !== 1
			|| !Number.isFinite(value.width) || !Number.isFinite(value.height)
			|| !Number.isFinite(value.xRatio) || !Number.isFinite(value.yRatio)) {
			return null;
		}

		return {
			v: 1,
			width: clamp(value.width, MIN_PREVIEW_WIDTH, MAX_PREVIEW_DIMENSION),
			height: clamp(value.height, MIN_PREVIEW_HEIGHT, MAX_PREVIEW_DIMENSION),
			xRatio: clamp(value.xRatio, 0, 1),
			yRatio: clamp(value.yRatio, 0, 1),
			snapX: ['left', 'right'].includes(value.snapX) ? value.snapX : null,
			snapY: ['top', 'bottom'].includes(value.snapY) ? value.snapY : null
		};
	}

	function rectFromLayout(layout, bounds) {
		const availableWidth = Math.max(1, bounds.right - bounds.left);
		const availableHeight = Math.max(1, bounds.bottom - bounds.top);
		const width = clamp(layout?.width ?? clamp(window.innerWidth * 0.12, 96, 144),
			Math.min(MIN_PREVIEW_WIDTH, availableWidth), Math.min(MAX_PREVIEW_DIMENSION, availableWidth));
		const height = clamp(layout?.height ?? width,
			Math.min(MIN_PREVIEW_HEIGHT, availableHeight), Math.min(MAX_PREVIEW_DIMENSION, availableHeight));
		const xRange = Math.max(0, availableWidth - width);
		const yRange = Math.max(0, availableHeight - height);

		return {
			x: bounds.left + (layout?.snapX === 'left' ? 0
				: layout?.snapX === 'right' || !layout ? xRange : xRange * layout.xRatio),
			y: bounds.top + (layout?.snapY === 'top' ? 0
				: layout?.snapY === 'bottom' || !layout ? yRange : yRange * layout.yRatio),
			width,
			height
		};
	}

	function getSnapEdges(rect, bounds) {
		return {
			snapX: Math.abs(rect.x - bounds.left) < 1 ? 'left'
				: Math.abs(rect.x + rect.width - bounds.right) < 1 ? 'right' : null,
			snapY: Math.abs(rect.y - bounds.top) < 1 ? 'top'
				: Math.abs(rect.y + rect.height - bounds.bottom) < 1 ? 'bottom' : null
		};
	}

	function layoutFromRect(rect, bounds) {
		const xRange = Math.max(0, bounds.right - bounds.left - rect.width);
		const yRange = Math.max(0, bounds.bottom - bounds.top - rect.height);

		return {
			v: 1,
			width: rect.width,
			height: rect.height,
			xRatio: xRange > 0 ? clamp((rect.x - bounds.left) / xRange, 0, 1) : 1,
			yRatio: yRange > 0 ? clamp((rect.y - bounds.top) / yRange, 0, 1) : 1,
			...getSnapEdges(rect, bounds)
		};
	}

	function updateOverlayRect(currentOverlay, rect, bounds = getViewportBounds(currentOverlay)) {
		const nextRect = constrainRect(rect, bounds);
		currentOverlay.rect = nextRect;
		currentOverlay.bounds = bounds;
		currentOverlay.host.style.setProperty('--preview-x', `${nextRect.x}px`);
		currentOverlay.host.style.setProperty('--preview-y', `${nextRect.y}px`);
		currentOverlay.host.style.setProperty('--preview-width', `${nextRect.width}px`);
		currentOverlay.host.style.setProperty('--preview-height', `${nextRect.height}px`);
		return nextRect;
	}

	function resizeRect(start, direction, deltaX, deltaY, bounds) {
		const minimumWidth = Math.min(MIN_PREVIEW_WIDTH, bounds.right - bounds.left);
		const minimumHeight = Math.min(MIN_PREVIEW_HEIGHT, bounds.bottom - bounds.top);
		let left = start.x;
		let right = start.x + start.width;
		let top = start.y;
		let bottom = start.y + start.height;

		if (direction.includes('w')) {
			left = clamp(start.x + deltaX, Math.max(bounds.left, right - MAX_PREVIEW_DIMENSION), right - minimumWidth);
		}
		if (direction.includes('e')) {
			right = clamp(start.x + start.width + deltaX, left + minimumWidth,
				Math.min(bounds.right, left + MAX_PREVIEW_DIMENSION));
		}
		if (direction.includes('n')) {
			top = clamp(start.y + deltaY, Math.max(bounds.top, bottom - MAX_PREVIEW_DIMENSION), bottom - minimumHeight);
		}
		if (direction.includes('s')) {
			bottom = clamp(start.y + start.height + deltaY, top + minimumHeight,
				Math.min(bounds.bottom, top + MAX_PREVIEW_DIMENSION));
		}

		return constrainRect({ x: left, y: top, width: right - left, height: bottom - top }, bounds);
	}

	function snapRect(rect, bounds, mode = 'move', direction = '', deltaX = 0, deltaY = 0, allowKeyboardDetach = false) {
		const next = { ...rect };
		const nearestX = Math.abs(rect.x - bounds.left) <= Math.abs(bounds.right - rect.x - rect.width) ? 'left' : 'right';
		const nearestY = Math.abs(rect.y - bounds.top) <= Math.abs(bounds.bottom - rect.y - rect.height) ? 'top' : 'bottom';

		if (mode === 'move') {
			if (nearestX === 'left' && (!allowKeyboardDetach || deltaX <= 0) && rect.x - bounds.left <= SNAP_DISTANCE) {
				next.x = bounds.left;
			}
			else if (nearestX === 'right' && (!allowKeyboardDetach || deltaX >= 0) && bounds.right - rect.x - rect.width <= SNAP_DISTANCE) {
				next.x = bounds.right - rect.width;
			}
			if (nearestY === 'top' && (!allowKeyboardDetach || deltaY <= 0) && rect.y - bounds.top <= SNAP_DISTANCE) {
				next.y = bounds.top;
			}
			else if (nearestY === 'bottom' && (!allowKeyboardDetach || deltaY >= 0) && bounds.bottom - rect.y - rect.height <= SNAP_DISTANCE) {
				next.y = bounds.bottom - rect.height;
			}
		}
		else {
			if (direction.includes('w') && (!allowKeyboardDetach || deltaX <= 0) && rect.x - bounds.left <= SNAP_DISTANCE) {
				next.width += next.x - bounds.left;
				next.x = bounds.left;
			}
			if (direction.includes('e') && (!allowKeyboardDetach || deltaX >= 0) && bounds.right - rect.x - rect.width <= SNAP_DISTANCE) {
				next.width = bounds.right - next.x;
			}
			if (direction.includes('n') && (!allowKeyboardDetach || deltaY <= 0) && rect.y - bounds.top <= SNAP_DISTANCE) {
				next.height += next.y - bounds.top;
				next.y = bounds.top;
			}
			if (direction.includes('s') && (!allowKeyboardDetach || deltaY >= 0) && bounds.bottom - rect.y - rect.height <= SNAP_DISTANCE) {
				next.height = bounds.bottom - next.y;
			}
		}

		return constrainRect(next, bounds);
	}

	function persistPreviewLayout() {
		if (!storedPreviewLayout) {
			return;
		}

		const layout = { ...storedPreviewLayout };
		layoutWritePromise = layoutWritePromise
			.then(() => chrome.storage.local.set({ [PREVIEW_LAYOUT_STORAGE_KEY]: layout }))
			.catch(error => console.warn('Real Mii Preview layout could not be saved.', error));
	}

	function flushLayoutSave() {
		if (layoutSaveTimer === null) {
			return;
		}

		clearTimeout(layoutSaveTimer);
		layoutSaveTimer = null;
		persistPreviewLayout();
	}

	function rememberOverlayLayout(currentOverlay, delay = 0) {
		storedPreviewLayout = layoutFromRect(currentOverlay.rect, currentOverlay.bounds);
		clearTimeout(layoutSaveTimer);
		layoutSaveTimer = setTimeout(() => {
			layoutSaveTimer = null;
			persistPreviewLayout();
		}, delay);
	}

	function announceOverlayLayout(currentOverlay, action = 'moved') {
		const { snapX, snapY } = getSnapEdges(currentOverlay.rect, currentOverlay.bounds);
		const edges = [snapX, snapY].filter(Boolean);
		currentOverlay.announcement.textContent = `Preview ${edges.length ? `snapped to ${edges.join(' and ')}` : action}, ${Math.round(currentOverlay.rect.width)} by ${Math.round(currentOverlay.rect.height)} pixels.`;
	}

	function settleOverlay(currentOverlay, rect, bounds, { save = true, saveDelay = 0, action = 'moved' } = {}) {
		currentOverlay.host.removeAttribute('data-interaction');
		void currentOverlay.host.getBoundingClientRect();
		updateOverlayRect(currentOverlay, rect, bounds);
		currentOverlay.host.removeAttribute('data-settling');
		void currentOverlay.host.getBoundingClientRect();
		currentOverlay.host.setAttribute('data-settling', '');
		clearTimeout(currentOverlay.settleTimer);
		currentOverlay.settleTimer = setTimeout(() => currentOverlay.host.removeAttribute('data-settling'), SETTLE_ANIMATION_MS);
		if (save) {
			rememberOverlayLayout(currentOverlay, saveDelay);
			clearTimeout(currentOverlay.announcementTimer);
			if (saveDelay > 0) {
				currentOverlay.announcementTimer = setTimeout(() => {
					currentOverlay.announcementTimer = null;
					announceOverlayLayout(currentOverlay, action);
				}, saveDelay);
			}
			else {
				announceOverlayLayout(currentOverlay, action);
			}
		}
	}

	function updateInteractionRect(currentOverlay) {
		const active = currentOverlay.interaction;
		if (!active) {
			return;
		}

		const bounds = getViewportBounds(currentOverlay);
		const start = constrainRect(active.startRect, bounds);
		const deltaX = active.clientX - active.startClientX;
		const deltaY = active.clientY - active.startClientY;
		const rect = active.mode === 'resize'
			? resizeRect(start, active.direction, deltaX, deltaY, bounds)
			: constrainRect({ ...start, x: start.x + deltaX, y: start.y + deltaY }, bounds);
		updateOverlayRect(currentOverlay, rect, bounds);
	}

	function endInteraction(currentOverlay, { commit = true, animate = true } = {}) {
		const active = currentOverlay.interaction;
		if (!active) {
			return;
		}

		currentOverlay.interaction = null;
		if (active.frame !== null) {
			cancelAnimationFrame(active.frame);
		}
		if (active.source.hasPointerCapture?.(active.pointerId)) {
			active.source.releasePointerCapture(active.pointerId);
		}

		if (!currentOverlay.host.isConnected) {
			return;
		}

		if (!commit) {
			if (animate) {
				settleOverlay(currentOverlay, active.startRect, getViewportBounds(currentOverlay), { save: false });
			}
			else {
				currentOverlay.host.removeAttribute('data-interaction');
				updateOverlayRect(currentOverlay, active.startRect);
			}
			return;
		}

		const bounds = getViewportBounds(currentOverlay);
		const deltaX = active.clientX - active.startClientX;
		const deltaY = active.clientY - active.startClientY;
		const rect = snapRect(currentOverlay.rect, bounds, active.mode, active.direction, deltaX, deltaY);
		settleOverlay(currentOverlay, rect, bounds, { action: active.mode === 'resize' ? 'resized' : 'moved' });
	}

	function beginInteraction(currentOverlay, event, mode, direction = '') {
		if (currentOverlay.interaction || event.isPrimary === false || event.button !== 0) {
			return;
		}

		const source = event.currentTarget;
		try {
			source.setPointerCapture(event.pointerId);
		}
		catch {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		// If a previous snap is still animating, start at what the user actually grabbed.
		const visibleRect = currentOverlay.host.getBoundingClientRect();
		currentOverlay.host.focus({ preventScroll: true });
		clearTimeout(currentOverlay.settleTimer);
		currentOverlay.host.removeAttribute('data-settling');
		currentOverlay.host.setAttribute('data-interaction', mode);
		const startRect = updateOverlayRect(currentOverlay, {
			x: visibleRect.left,
			y: visibleRect.top,
			width: visibleRect.width,
			height: visibleRect.height
		});
		currentOverlay.interaction = {
			mode,
			direction,
			pointerId: event.pointerId,
			source,
			startRect,
			startClientX: event.clientX,
			startClientY: event.clientY,
			clientX: event.clientX,
			clientY: event.clientY,
			frame: null
		};
	}

	function onInteractionMove(currentOverlay, event) {
		const active = currentOverlay.interaction;
		if (!active || event.pointerId !== active.pointerId) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		active.clientX = event.clientX;
		active.clientY = event.clientY;
		if (active.frame === null) {
			active.frame = requestAnimationFrame(() => {
				active.frame = null;
				updateInteractionRect(currentOverlay);
			});
		}
	}

	function onInteractionEnd(currentOverlay, event) {
		const active = currentOverlay.interaction;
		if (!active || event.pointerId !== active.pointerId) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		active.clientX = event.clientX;
		active.clientY = event.clientY;
		updateInteractionRect(currentOverlay);
		endInteraction(currentOverlay);
	}

	function onOverlayKeydown(currentOverlay, event) {
		if (currentOverlay.interaction) {
			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				endInteraction(currentOverlay, { commit: false });
			}
			return;
		}

		const steps = {
			ArrowLeft: [-KEYBOARD_STEP, 0],
			ArrowRight: [KEYBOARD_STEP, 0],
			ArrowUp: [0, -KEYBOARD_STEP],
			ArrowDown: [0, KEYBOARD_STEP]
		};
		const step = steps[event.key];
		if (!step || event.altKey || event.ctrlKey || event.metaKey) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		const [deltaX, deltaY] = step;
		const bounds = getViewportBounds(currentOverlay);
		const direction = deltaX ? 'e' : 's';
		const rect = event.shiftKey
			? resizeRect(currentOverlay.rect, direction, deltaX, deltaY, bounds)
			: constrainRect({ ...currentOverlay.rect,
				x: currentOverlay.rect.x + deltaX, y: currentOverlay.rect.y + deltaY }, bounds);
		const snapped = snapRect(rect, bounds, event.shiftKey ? 'resize' : 'move', direction, deltaX, deltaY, true);
		settleOverlay(currentOverlay, snapped, bounds, { saveDelay: 220, action: event.shiftKey ? 'resized' : 'moved' });
	}

	function scheduleViewportUpdate() {
		if (!overlay || overlay.interaction || viewportUpdateFrame !== null) {
			return;
		}

		viewportUpdateFrame = requestAnimationFrame(() => {
			viewportUpdateFrame = null;
			if (!overlay || overlay.interaction) {
				return;
			}

			const bounds = getViewportBounds(overlay);
			const layout = storedPreviewLayout ?? layoutFromRect(overlay.rect, overlay.bounds);
			updateOverlayRect(overlay, rectFromLayout(layout, bounds), bounds);
		});
	}

	function ensureOverlay() {
		if (overlay) {
			if (!overlay.host.isConnected) {
				document.documentElement.appendChild(overlay.host);
			}

			return overlay;
		}

		const host = document.createElement('div');
		host.id = PREVIEW_ELEMENT_ID;
		host.dataset.state = 'loading';
		host.setAttribute('data-positioning', '');
		host.tabIndex = 0;
		host.setAttribute('role', 'group');
		host.setAttribute('aria-label', 'Real Mii Preview');
		host.setAttribute('aria-description', 'Drag to move; drag an edge or corner to resize. Use arrow keys to move and Shift plus arrow keys to resize.');
		host.setAttribute('aria-busy', 'true');
		let currentOverlay;

		const shadowRoot = host.attachShadow({ mode: 'closed' });
		applyShadowStyles(shadowRoot);

		const figure = document.createElement('figure');
		figure.setAttribute('role', 'group');
		figure.setAttribute('aria-label', 'Real Mii Preview');

		const status = document.createElement('figcaption');
		status.className = 'preview-status';
		status.setAttribute('role', 'status');
		status.setAttribute('aria-live', 'polite');
		status.textContent = 'Loading preview…';

		figure.appendChild(status);
		shadowRoot.appendChild(figure);
		const dragAffordance = document.createElement('span');
		dragAffordance.className = 'drag-affordance';
		dragAffordance.setAttribute('aria-hidden', 'true');
		shadowRoot.appendChild(dragAffordance);
		const closeButton = document.createElement('button');
		closeButton.className = 'preview-close';
		closeButton.type = 'button';
		closeButton.setAttribute('aria-label', 'Turn off floating preview');
		closeButton.title = 'Turn off floating preview';
		closeButton.textContent = '\u00d7';
		closeButton.addEventListener('pointerdown', event => event.stopPropagation());
		closeButton.addEventListener('click', async event => {
			event.preventDefault();
			event.stopPropagation();
			closeButton.disabled = true;
			try {
				await chrome.storage.local.set({ [PREVIEW_MODE_STORAGE_KEY]: 'off' });
				setPreviewMode('off');
			}
			catch (error) {
				console.warn('Real Mii Preview could not be turned off.', error);
				closeButton.disabled = false;
			}
		});
		shadowRoot.appendChild(closeButton);

		const insets = document.createElement('span');
		insets.className = 'viewport-insets';
		insets.setAttribute('aria-hidden', 'true');
		shadowRoot.appendChild(insets);

		const announcement = document.createElement('span');
		announcement.className = 'interaction-announcement';
		announcement.setAttribute('role', 'status');
		announcement.setAttribute('aria-live', 'polite');
		shadowRoot.appendChild(announcement);

		for (const direction of RESIZE_DIRECTIONS) {
			const handle = document.createElement('span');
			handle.className = 'resize-handle';
			handle.dataset.resize = direction;
			handle.setAttribute('aria-hidden', 'true');
			handle.addEventListener('pointerdown', event => {
				if (overlay === currentOverlay) {
					beginInteraction(currentOverlay, event, 'resize', direction);
				}
			});
			shadowRoot.appendChild(handle);
		}

		figure.addEventListener('pointerdown', event => {
			if (overlay === currentOverlay) {
				beginInteraction(currentOverlay, event, 'move');
			}
		});
		shadowRoot.addEventListener('pointermove', event => {
			if (overlay === currentOverlay) {
				onInteractionMove(currentOverlay, event);
			}
		});
		shadowRoot.addEventListener('pointerup', event => {
			if (overlay === currentOverlay) {
				onInteractionEnd(currentOverlay, event);
			}
		});
		shadowRoot.addEventListener('pointercancel', event => {
			if (overlay === currentOverlay && currentOverlay.interaction?.pointerId === event.pointerId) {
				endInteraction(currentOverlay, { commit: false });
			}
		});
		shadowRoot.addEventListener('lostpointercapture', event => {
			if (overlay === currentOverlay && currentOverlay.interaction?.pointerId === event.pointerId) {
				endInteraction(currentOverlay);
			}
		});
		host.addEventListener('keydown', event => {
			if (overlay === currentOverlay) {
				onOverlayKeydown(currentOverlay, event);
			}
		});
		host.addEventListener('dragstart', event => event.preventDefault());

		currentOverlay = {
			announcement,
			announcementTimer: null,
			bounds: null,
			figure,
			host,
			image: null,
			insets,
			interaction: null,
			rect: null,
			settleTimer: null,
			status
		};
		overlay = currentOverlay;
		document.documentElement.appendChild(host);
		const bounds = getViewportBounds(currentOverlay);
		updateOverlayRect(currentOverlay, rectFromLayout(storedPreviewLayout, bounds), bounds);
		requestAnimationFrame(() => host.removeAttribute('data-positioning'));
		return overlay;
	}

	function removeOverlay() {
		flushLayoutSave();
		if (viewportUpdateFrame !== null) {
			cancelAnimationFrame(viewportUpdateFrame);
			viewportUpdateFrame = null;
		}

		if (!overlay) {
			return;
		}

		endInteraction(overlay, { commit: false, animate: false });
		clearTimeout(overlay.settleTimer);
		clearTimeout(overlay.announcementTimer);
		if (overlay.image) {
			overlay.image.onload = null;
			overlay.image.onerror = null;
			overlay.image.removeAttribute('src');
		}

		overlay.host.remove();
		overlay = null;
	}

	function showLoadingState() {
		const currentOverlay = ensureOverlay();
		currentOverlay.host.setAttribute('aria-busy', 'true');

		if (currentOverlay.host.dataset.state !== 'ready') {
			currentOverlay.host.dataset.state = 'loading';
			currentOverlay.status.textContent = 'Loading preview…';
		}
	}

	function showErrorState() {
		const currentOverlay = ensureOverlay();
		readyCanvasRenderUrl = '';
		readyCanvasStorageKey = '';
		removeCanvasReplacement();

		if (currentOverlay.image) {
			currentOverlay.image.removeAttribute('src');
			currentOverlay.image.remove();
			currentOverlay.image = null;
		}

		currentOverlay.host.dataset.state = 'error';
		currentOverlay.host.setAttribute('aria-busy', 'false');
		currentOverlay.status.textContent = 'Real Mii Preview unavailable';
	}

	function showReadyState(image) {
		const currentOverlay = ensureOverlay();

		if (currentOverlay.image) {
			currentOverlay.image.removeAttribute('src');
			currentOverlay.image.remove();
		}

		currentOverlay.figure.insertBefore(image, currentOverlay.status);
		currentOverlay.image = image;
		currentOverlay.host.dataset.state = 'ready';
		currentOverlay.host.setAttribute('aria-busy', 'false');
		currentOverlay.status.textContent = '';
	}

	function toUint8Array(data) {
		if (data instanceof Uint8Array) {
			return data;
		}
		if (data instanceof ArrayBuffer) {
			return new Uint8Array(data);
		}
		if (ArrayBuffer.isView(data)) {
			return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
		}
		return new Uint8Array(data);
	}

	function bytesToHex(data) {
		return Array.from(toUint8Array(data), byte => byte.toString(16).padStart(2, '0')).join('');
	}

	async function getMiijs() {
		if (!miijsPromise) {
			miijsPromise = import(chrome.runtime.getURL('miijs.browser.js'))
				.then(module => module.default)
				.catch(error => {
					miijsPromise = null;
					throw error;
				});
		}

		return miijsPromise;
	}

	async function getRenderUrl(miiData) {
		const miijs = await getMiijs();
		const decodedMii = await miijs.decodeMii(miiData);
		const renderData = await miijs.encodeMii(decodedMii, miijs.MiiFormats.EMNMS);
		const renderUrl = new URL(MII_STUDIO_RENDER_ENDPOINT);
		renderUrl.searchParams.set('data', bytesToHex(renderData));
		renderUrl.searchParams.set('type', 'all_body');
		renderUrl.searchParams.set('width', '512');
		renderUrl.searchParams.set('instanceCount', '1');
		return renderUrl.href;
	}

	function loadPreviewImage(renderUrl) {
		return new Promise((resolve, reject) => {
			const image = document.createElement('img');
			image.className = 'preview-image';
			image.alt = 'Real Mii Preview of the current Mii';
			image.draggable = false;
			image.decoding = 'async';
			image.referrerPolicy = 'no-referrer';
			image.onload = () => {
				image.onload = null;
				image.onerror = null;
				resolve(image);
			};
			image.onerror = () => {
				image.onload = null;
				image.onerror = null;
				reject(new Error('The Mii Studio renderer did not return an image.'));
			};
			image.src = renderUrl;
		});
	}

	function isRenderCurrent(generation, fingerprint) {
		return previewMode !== 'off'
			&& generation === renderGeneration
			&& getStudioMiiSnapshot().fingerprint === fingerprint;
	}

	function clearPreviewRetry({ resetDelay = true } = {}) {
		clearTimeout(retryTimer);
		retryTimer = null;

		if (resetDelay) {
			retryDelayMs = RETRY_INITIAL_MS;
		}
	}

	function schedulePreviewRetry(fingerprint) {
		clearTimeout(retryTimer);
		const retryDelay = retryDelayMs;
		retryDelayMs = Math.min(retryDelayMs * 2, RETRY_MAX_MS);

		retryTimer = setTimeout(() => {
			retryTimer = null;

			if (previewMode === 'off' || getStudioMiiSnapshot().fingerprint !== fingerprint) {
				return;
			}

			checkForPreviewUpdate({ force: true, immediate: true });
		}, retryDelay);
	}

	async function renderPreview(snapshot) {
		const generation = ++renderGeneration;
		if (previewMode === 'floating') {
			showLoadingState();
		}

		try {
			const renderUrl = await getRenderUrl(snapshot.data);
			if (!isRenderCurrent(generation, snapshot.fingerprint)) {
				return;
			}

			if (previewMode === 'floating') {
				const image = await loadPreviewImage(renderUrl);
				if (!isRenderCurrent(generation, snapshot.fingerprint)) {
					image.removeAttribute('src');
					return;
				}

				showReadyState(image);
				clearPreviewRetry();
			}
			else {
				readyCanvasRenderUrl = renderUrl;
				readyCanvasStorageKey = snapshotStorageKey(snapshot);
				syncCanvasReplacement();
			}
		}
		catch (error) {
			if (!isRenderCurrent(generation, snapshot.fingerprint)) {
				return;
			}

			console.warn('Real Mii Preview could not be updated.', error);
			if (previewMode === 'floating') {
				showErrorState();
			}
			else {
				readyCanvasRenderUrl = '';
				readyCanvasStorageKey = '';
				removeCanvasReplacement();
			}
			schedulePreviewRetry(snapshot.fingerprint);
		}
	}

	function checkForPreviewUpdate({ force = false, immediate = false } = {}) {
		if (previewMode === 'off') {
			return;
		}

		let snapshot = getStudioMiiSnapshot();
		if (!snapshot.data) {
			hydrateMissingMiiData(snapshot);
			snapshot = getStudioMiiSnapshot();
		}
		const unchanged = snapshot.fingerprint === lastObservedFingerprint;

		if (unchanged && !force) {
			if (previewMode === 'floating' && snapshot.data && overlay && !overlay.host.isConnected) {
				document.documentElement.appendChild(overlay.host);
			}
			if (previewMode === 'replace' && readyCanvasStorageKey === snapshotStorageKey(snapshot)) {
				syncCanvasReplacement();
			}
			return;
		}
		if (readyCanvasStorageKey && readyCanvasStorageKey !== snapshotStorageKey(snapshot)) {
			readyCanvasRenderUrl = '';
			readyCanvasStorageKey = '';
			removeCanvasReplacement();
		}

		const dataChanged = snapshot.fingerprint !== lastObservedFingerprint;
		lastObservedFingerprint = snapshot.fingerprint;
		clearTimeout(updateTimer);
		updateTimer = null;
		clearPreviewRetry({ resetDelay: dataChanged });
		renderGeneration++;

		if (!snapshot.data) {
			removeOverlay();
			readyCanvasRenderUrl = '';
			readyCanvasStorageKey = '';
			removeCanvasReplacement();
			return;
		}

		updateTimer = setTimeout(() => {
			updateTimer = null;
			void renderPreview(snapshot);
		}, immediate ? 0 : UPDATE_DEBOUNCE_MS);
	}

	function setPreviewMode(mode) {
		const nextMode = ['floating', 'replace'].includes(mode) ? mode : 'off';

		if (previewMode === nextMode) {
			if (nextMode !== 'off') {
				checkForPreviewUpdate({ force: true, immediate: true });
			}
			return;
		}

		previewMode = nextMode;
		lastObservedFingerprint = null;
		renderGeneration++;
		clearTimeout(updateTimer);
		updateTimer = null;
		clearPreviewRetry();
		clearInterval(pollTimer);
		pollTimer = null;
		removeOverlay();
		readyCanvasRenderUrl = '';
		readyCanvasStorageKey = '';
		removeCanvasReplacement();

		if (previewMode === 'off') {
			return;
		}

		checkForPreviewUpdate({ immediate: true });
		pollTimer = setInterval(() => checkForPreviewUpdate(), POLL_INTERVAL_MS);
	}

	chrome.storage.onChanged.addListener((changes, areaName) => {
		if (areaName !== 'local') {
			return;
		}

		if (changes[PREVIEW_MODE_STORAGE_KEY]) {
			hasExplicitPreviewMode = true;
			setPreviewMode(changes[PREVIEW_MODE_STORAGE_KEY].newValue);
		}
		else if (!hasExplicitPreviewMode && changes[LEGACY_PREVIEW_STORAGE_KEY]) {
			setPreviewMode(changes[LEGACY_PREVIEW_STORAGE_KEY].newValue === true ? 'floating' : 'off');
		}
	});

	window.addEventListener('focus', () => checkForPreviewUpdate({ force: true, immediate: true }));
	window.addEventListener('pageshow', () => checkForPreviewUpdate({ force: true, immediate: true }));
	window.addEventListener('popstate', () => checkForPreviewUpdate({ immediate: true }));
	window.addEventListener('hashchange', () => checkForPreviewUpdate({ immediate: true }));
	window.addEventListener('resize', scheduleViewportUpdate);
	window.visualViewport?.addEventListener('resize', scheduleViewportUpdate);
	window.visualViewport?.addEventListener('scroll', scheduleViewportUpdate);
	window.addEventListener('keydown', event => {
		if (overlay?.interaction && event.key === 'Escape') {
			onOverlayKeydown(overlay, event);
		}
	}, true);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') {
			checkForPreviewUpdate({ force: true, immediate: true });
		}
	});

	chrome.storage.local.get([PREVIEW_MODE_STORAGE_KEY, LEGACY_PREVIEW_STORAGE_KEY, PREVIEW_LAYOUT_STORAGE_KEY])
		.then(settings => {
			storedPreviewLayout = normalizeStoredLayout(settings[PREVIEW_LAYOUT_STORAGE_KEY]);
			hasExplicitPreviewMode = Object.hasOwn(settings, PREVIEW_MODE_STORAGE_KEY);
			setPreviewMode(hasExplicitPreviewMode
				? settings[PREVIEW_MODE_STORAGE_KEY]
				: settings[LEGACY_PREVIEW_STORAGE_KEY] === true ? 'floating' : 'off');
		})
		.catch(error => {
			console.warn('Real Mii Preview setting could not be read.', error);
			setPreviewMode('off');
		});
})();

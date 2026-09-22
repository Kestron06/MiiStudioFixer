(() => {
	'use strict';

	const REQUEST_EVENT = 'mii-studio-fixer:hydrate-request';
	const RESULT_EVENT = 'mii-studio-fixer:hydrate-result';

	function findEditor() {
		const canvas = document.querySelector('canvas#canvas');
		if (!canvas) {
			return null;
		}

		const visited = new Set();
		for (let element = canvas; element; element = element.parentElement) {
			let component = element.__vue__;
			while (component && !visited.has(component)) {
				visited.add(component);
				if (typeof component.onPartsUpdated === 'function'
					&& component.isPartsPage === true
					&& component.history?.current) {
					return component;
				}
				component = component.$parent;
			}
		}
		return null;
	}

	function hydrate() {
		const key = encodeURIComponent(location.href);
		if (localStorage.getItem(key)) {
			return 'already-present';
		}

		const editor = findEditor();
		if (!editor) {
			return 'unavailable';
		}

		editor.onPartsUpdated(editor.history.current);
		return localStorage.getItem(key) ? 'hydrated' : 'no-data';
	}

	document.addEventListener(REQUEST_EVENT, () => {
		let result;
		try {
			result = hydrate();
		} catch (error) {
			console.warn('Real Mii Preview could not load the current Mii into local storage.', error);
			result = 'error';
		}
		document.dispatchEvent(new CustomEvent(RESULT_EVENT, { detail: result }));
	});
})();

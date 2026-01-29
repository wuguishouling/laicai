import { Notify } from './util/notify.js';
import { UI } from './ui.js';
import { Foxtrick as Cookies } from './util/cookies.js';
import { ContextMenuCopy } from './shortcuts-and-tweaks/context-menu-copy.js';
import { ScraperController } from './scraper-controller.js';

'use strict';


/**
 * Set up an offscreen document to mimic (most) of what the background
 * page did.
 *
 * https://developer.chrome.com/docs/extensions/reference/api/offscreen
 */
async function setupOffscreenDocument() {
	const path = 'content/background.html?_offscreen=1';
	// Check all windows controlled by the service worker to see if one
	// of them is the offscreen document with the given path
	const offscreenUrl = chrome.runtime.getURL(path);
	const existingContexts = await chrome.runtime.getContexts({
		contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
		documentUrls: [offscreenUrl]
	});

	if (existingContexts.length > 0) {
		return;
	}

	// create offscreen document
	if (offscreenPromise) {
		await offscreenPromise;
	} else {
		offscreenPromise = chrome.offscreen.createDocument({
			url: path,
			reasons: [chrome.offscreen.Reason.DOM_PARSER],
			justification: 'testing',
		});
		await offscreenPromise;
		offscreenPromise = null;
	}
}

let offscreenPromise; // A global promise to avoid concurrency issues
setupOffscreenDocument();

// Update action icon.
chrome.runtime.onInstalled.addListener(UI.actionListener.bind(UI));

// Listeners for code that cannot be run in offscreen document context.
chrome.runtime.onMessage.addListener((msg, sender, responseCallback) => {
	// Handle scraper messages (using 'type' instead of 'req')
	if (msg.type === 'SCRAPE_MATCH') {
		ScraperController.handleScrapeMatch(msg.matchId, msg.url, msg.options)
			.then(data => responseCallback({ data }))
			.catch(error => responseCallback({ error: error.message }));
		return true;
	}

	if (msg.type === 'CHECK_CHPP_STATUS') {
		ScraperController.checkChppStatus()
			.then(status => responseCallback(status));
		return true;
	}

	// Handle file download requests
	if (msg.type === 'DOWNLOAD_FILE') {
		const { content, filename, mimeType } = msg;

		// Use data URI since URL.createObjectURL is not available in service workers
		const base64Content = btoa(unescape(encodeURIComponent(content)));
		const dataUri = `data:${mimeType || 'application/json'};base64,${base64Content}`;

		chrome.downloads.download({
			url: dataUri,
			filename: filename,
			saveAs: true
		}, (downloadId) => {
			if (chrome.runtime.lastError) {
				responseCallback({ error: chrome.runtime.lastError.message });
			} else {
				responseCallback({ success: true, downloadId: downloadId });
			}
		});
		return true;
	}

	switch (msg.req) {
		case 'cookiesGet':
			Cookies.cookies.get(msg.key, msg.name) // never rejects
				.then(responseCallback);
			return true;

		case 'cookiesSet':
			Cookies.cookies.set(msg.key, msg.value, msg.name) // never rejects
				.then(responseCallback);
			return true;

		case 'updateContextMenu':
			ContextMenuCopy.handler(msg);
			return true;

		case 'newTab':
			setupOffscreenDocument().then(() => {
				chrome.tabs.create({ url: msg.url })
					.then(responseCallback);
			});
			return true;

		case 'notify':
			Notify.create(msg.msg, sender, msg)
				.then(responseCallback);
			return true;
	}
	return false;
});

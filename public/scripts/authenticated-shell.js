import { eventSource, event_types } from './events.js';
import { selected_group } from './group-chats.js';
import { closeWelcomeScreenOverlay, openWelcomeScreenOverlay } from './welcome-screen.js';

const shellRoutes = {
    'ai-config': {
        icon: '#leftNavDrawerIcon',
        panel: '#left-nav-panel',
        title: 'AI Response Configuration',
    },
    api: {
        icon: '#API-status-top',
        panel: '#rm_api_block',
        title: 'API Connections',
    },
    formatting: {
        icon: '#advanced-formatting-button .drawer-icon',
        panel: '#AdvancedFormatting',
        title: 'AI Response Formatting',
    },
    'world-info': {
        icon: '#WIDrawerIcon',
        panel: '#WorldInfo',
        title: 'World Info',
    },
    'user-settings': {
        icon: '#user-settings-button .drawer-icon',
        panel: '#user-settings-block',
        title: 'User Settings',
    },
    backgrounds: {
        icon: '#backgrounds-button .drawer-icon',
        panel: '#Backgrounds',
        title: 'Backgrounds',
    },
    extensions: {
        icon: '#extensions-settings-button .drawer-icon',
        panel: '#rm_extensions_block',
        title: 'Extensions',
    },
    persona: {
        icon: '#persona-management-button .drawer-icon',
        panel: '#PersonaManagement',
        title: 'Persona Management',
    },
    characters: {
        icon: '#rightNavDrawerIcon',
        panel: '#right-nav-panel',
        title: 'Choose a character',
    },
};

const knownDrawerIds = new Set([
    'ai-config-button',
    'sys-settings-button',
    'advanced-formatting-button',
    'WI-SP-button',
    'user-settings-button',
    'backgrounds-button',
    'extensions-settings-button',
    'persona-management-button',
    'rightNavHolder',
]);

const workspaceTitle = document.querySelector('#st-workspace-title');
const legacyLanguageSelect = document.querySelector('#ui_language_select');
const shellLanguageSelect = document.querySelector('#st-shell-language');
const moreDialog = document.querySelector('#st-shell-more');
const moreCloseButton = document.querySelector('#st-shell-more-close');
const extensionRouteContainers = document.querySelectorAll('#st-shell-desktop-extension-routes, #st-shell-extension-routes');
const legacyTopBar = document.querySelector('#top-bar');
const chatElement = document.querySelector('#chat');
const sendForm = document.querySelector('#send_form');
const characterPanel = document.querySelector('#right-nav-panel');
const characterDetailsButton = document.querySelector('#st-shell-character-details');
const characterContextCloseButton = document.querySelector('#st-shell-character-context-close');
const characterPanelOriginalRole = characterPanel?.getAttribute('role');
const characterPanelOriginalAriaModal = characterPanel?.getAttribute('aria-modal');
const characterPanelOriginalAriaLabel = characterPanel?.getAttribute('aria-label');
const desktopMedia = window.matchMedia('(min-width: 721px)');
const pinnedWorkspaceMedia = window.matchMedia('(min-width: 1281px)');
const observedExtensionPanels = new WeakSet();
let moreOpener = null;
let requestedRoute = null;
let extensionRouteSequence = 0;
let homeOpening = false;
let homeRequest = 0;
let syncFrame = 0;
let pendingCharacterSelection = null;
let pendingGroupSelection = null;

function getOpenRoute() {
    return Object.entries(shellRoutes).find(([, route]) => {
        const panel = document.querySelector(route.panel);
        return panel?.classList.contains('openDrawer')
            && !panel.classList.contains('st-shell-character-context')
            && (!pinnedWorkspaceMedia.matches || !panel.classList.contains('pinnedOpen'));
    })?.[0];
}

function setWorkspaceTitle(title, translate = true) {
    if (!workspaceTitle) {
        return;
    }

    if (translate && workspaceTitle.getAttribute('data-i18n') === title) {
        return;
    }

    workspaceTitle.textContent = title;
    if (translate) {
        workspaceTitle.setAttribute('data-i18n', title);
    } else {
        workspaceTitle.removeAttribute('data-i18n');
    }
}

function applyCurrentView(currentRoute, openExtensionPanel = null) {
    const chatTitle = currentRoute === 'chat'
        ? document.querySelector('#rm_button_selected_ch h2')?.textContent.trim() || chatElement?.querySelector('.mes .ch_name')?.textContent.trim()
        : '';
    const extensionTitle = openExtensionPanel?.getAttribute('data-shell-extension-title') || '';
    const title = extensionTitle || (shellRoutes[currentRoute]?.title ?? (currentRoute === 'home' ? 'Recent Chats' : chatTitle || 'Chat'));

    document.body.dataset.shellView = currentRoute;
    setWorkspaceTitle(title, !chatTitle && !extensionTitle);
    if (characterDetailsButton instanceof HTMLButtonElement) {
        characterDetailsButton.hidden = currentRoute !== 'chat' || !chatTitle;
        characterDetailsButton.setAttribute('aria-expanded', String(characterPanel?.classList.contains('openDrawer') ?? false));
    }

    document.querySelectorAll('[data-shell-route]').forEach((button) => {
        const isCurrent = button.getAttribute('data-shell-route') === currentRoute;
        button.classList.toggle('is-active', isCurrent);
        if (isCurrent) {
            button.setAttribute('aria-current', 'page');
        } else {
            button.removeAttribute('aria-current');
        }
    });

    document.querySelectorAll('.st-shell-extension-route[data-shell-extension-route]').forEach((button) => {
        const isCurrent = button.getAttribute('data-shell-extension-route') === openExtensionPanel?.getAttribute('data-shell-extension-route');
        button.classList.toggle('is-active', isCurrent);
        if (isCurrent) {
            button.setAttribute('aria-current', 'page');
        } else {
            button.removeAttribute('aria-current');
        }
    });
}

function syncCurrentView() {
    syncFrame = 0;
    const openRoute = getOpenRoute();
    const openExtensionPanel = document.querySelector('.st-shell-extension-panel.openDrawer');
    const hasWelcomePanel = Boolean(chatElement?.querySelector(':scope > .welcomePanel'));
    const requestedPanel = requestedRoute && shellRoutes[requestedRoute]
        ? document.querySelector(shellRoutes[requestedRoute].panel)
        : null;
    const requestedPanelIsSupplemental = pinnedWorkspaceMedia.matches && requestedPanel?.classList.contains('pinnedOpen');
    const requestedViewIsAvailable = requestedRoute === 'home'
        ? hasWelcomePanel || homeOpening
        : requestedRoute === 'chat'
            ? !hasWelcomePanel
            : requestedPanel?.classList.contains('openDrawer') && !requestedPanelIsSupplemental;
    const currentRoute = openExtensionPanel
        ? 'extension'
        : openRoute || (requestedViewIsAvailable ? requestedRoute : hasWelcomePanel ? 'home' : 'chat');

    applyCurrentView(currentRoute, openExtensionPanel);
}

function queueViewSync() {
    if (!syncFrame) {
        syncFrame = requestAnimationFrame(syncCurrentView);
    }
}

function closeOpenPanels(exceptRoute = null) {
    for (const [routeName, route] of Object.entries(shellRoutes)) {
        if (routeName === exceptRoute) {
            continue;
        }

        const panel = document.querySelector(route.panel);
        const preservePinnedPanel = pinnedWorkspaceMedia.matches && panel?.classList.contains('pinnedOpen');
        if (panel?.classList.contains('openDrawer') && !preservePinnedPanel) {
            document.querySelector(route.icon)?.click();
        }
    }

    document.querySelectorAll('.st-shell-extension-panel.openDrawer').forEach((panel) => {
        panel.closest('.drawer')?.querySelector(':scope > .drawer-toggle .drawer-icon')?.click();
    });
}

function normalizePinnedPanelsForViewport() {
    if (pinnedWorkspaceMedia.matches || document.body.classList.contains('movingUI')) {
        return;
    }

    const requestedPanel = requestedRoute && shellRoutes[requestedRoute]
        ? document.querySelector(shellRoutes[requestedRoute].panel)
        : null;
    for (const route of Object.values(shellRoutes)) {
        const panel = document.querySelector(route.panel);
        const keepAsCompactRoute = panel === requestedPanel && panel?.classList.contains('pinnedOpen');
        if (panel?.classList.contains('openDrawer') && panel.classList.contains('pinnedOpen') && !keepAsCompactRoute) {
            document.querySelector(route.icon)?.click();
        }
    }
}

function openPanel(routeName) {
    const route = shellRoutes[routeName];
    if (!route) {
        return;
    }

    closeOpenPanels(routeName);

    if (routeName === 'characters') {
        pendingCharacterSelection = null;
        pendingGroupSelection = null;
        setCharacterContextModal(false);
        characterPanel?.classList.remove('st-shell-character-context');
        document.querySelector('#rm_button_characters')?.click();
    }

    const panel = document.querySelector(route.panel);
    if (!panel?.classList.contains('openDrawer')) {
        document.querySelector(route.icon)?.click();
    }

    queueViewSync();
}

function showHome() {
    closeOpenPanels();
    const request = ++homeRequest;
    homeOpening = true;
    document.body.classList.add('st-shell-home-opening');
    void openWelcomeScreenOverlay().catch(error => console.error('Failed to open the welcome screen:', error)).finally(() => {
        if (request !== homeRequest) {
            return;
        }
        homeOpening = false;
        document.body.classList.remove('st-shell-home-opening');
        queueViewSync();
    });
}

function cancelHomeOpening() {
    homeRequest++;
    homeOpening = false;
    document.body.classList.remove('st-shell-home-opening');
}

function showChat() {
    closeWelcomeScreenOverlay();
    closeOpenPanels();
    queueViewSync();
    const sendTextarea = document.querySelector('#send_textarea');
    if (sendTextarea instanceof HTMLTextAreaElement && sendTextarea.offsetParent !== null) {
        sendTextarea.focus({ preventScroll: true });
    }
}

function restoreCharacterPanelAttribute(attribute, value) {
    if (!(characterPanel instanceof HTMLElement)) {
        return;
    }

    if (value === null || value === undefined) {
        characterPanel.removeAttribute(attribute);
    } else {
        characterPanel.setAttribute(attribute, value);
    }
}

function setCharacterContextModal(active) {
    if (!(characterPanel instanceof HTMLElement)) {
        return;
    }

    if (active) {
        characterPanel.setAttribute('role', 'dialog');
        characterPanel.setAttribute('aria-modal', 'true');
        characterPanel.setAttribute('aria-label', characterDetailsButton?.getAttribute('aria-label') || 'Character details');
        return;
    }

    restoreCharacterPanelAttribute('role', characterPanelOriginalRole);
    restoreCharacterPanelAttribute('aria-modal', characterPanelOriginalAriaModal);
    restoreCharacterPanelAttribute('aria-label', characterPanelOriginalAriaLabel);
}

function isMobileCharacterContextOpen() {
    return !desktopMedia.matches
        && characterPanel?.classList.contains('st-shell-character-context')
        && characterPanel.classList.contains('openDrawer');
}

function getCharacterContextFocusableElements() {
    if (!(characterPanel instanceof HTMLElement)) {
        return [];
    }

    const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
    return Array.from(characterPanel.querySelectorAll(selector)).filter(element => element instanceof HTMLElement && element.offsetParent !== null);
}

function closeCharacterContext(restoreFocus = false) {
    setCharacterContextModal(false);
    if (characterPanel?.classList.contains('openDrawer')) {
        document.querySelector('#rightNavDrawerIcon')?.click();
    }
    characterDetailsButton?.setAttribute('aria-expanded', 'false');
    if (restoreFocus && characterDetailsButton instanceof HTMLButtonElement && !characterDetailsButton.hidden) {
        characterDetailsButton.focus({ preventScroll: true });
    }
}

function openCharacterContext() {
    if (!document.querySelector('#rm_button_selected_ch h2')?.textContent.trim()) {
        return;
    }

    cancelHomeOpening();
    closeWelcomeScreenOverlay();
    requestedRoute = 'chat';
    characterPanel?.classList.add('st-shell-character-context');
    document.querySelector('#rm_button_selected_ch')?.click();
    if (!characterPanel?.classList.contains('openDrawer')) {
        document.querySelector('#rightNavDrawerIcon')?.click();
    }
    applyCurrentView('chat');
    if (!desktopMedia.matches) {
        setCharacterContextModal(true);
        requestAnimationFrame(() => {
            if (isMobileCharacterContextOpen()) {
                characterContextCloseButton?.focus({ preventScroll: true });
            }
        });
    }
    queueViewSync();
}

function showSelectedEntityChat() {
    cancelHomeOpening();
    closeWelcomeScreenOverlay();
    requestedRoute = 'chat';
    characterPanel?.classList.add('st-shell-character-context');
    applyCurrentView('chat');
    if (!desktopMedia.matches) {
        closeCharacterContext();
    }
    queueViewSync();
}

function showSelectedCharacterChat(characterId) {
    if (pendingCharacterSelection !== String(characterId)) {
        return;
    }

    pendingCharacterSelection = null;
    showSelectedEntityChat();
}

function showSelectedGroupChat() {
    if (pendingGroupSelection !== String(selected_group)) {
        return;
    }

    pendingGroupSelection = null;
    showSelectedEntityChat();
}

function openMore(button) {
    if (!(moreDialog instanceof HTMLDialogElement) || moreDialog.open) {
        return;
    }

    moreOpener = button;
    moreDialog.showModal();
    moreDialog.scrollTop = 0;
    moreCloseButton?.focus({ preventScroll: true });
}

function closeMore() {
    if (moreDialog instanceof HTMLDialogElement && moreDialog.open) {
        moreDialog.close();
    }
}

function activateRoute(routeName) {
    const routePanel = shellRoutes[routeName] ? document.querySelector(shellRoutes[routeName].panel) : null;
    const routeIsSupplemental = pinnedWorkspaceMedia.matches && routePanel?.classList.contains('pinnedOpen');
    const welcomePanel = chatElement?.querySelector(':scope > .welcomePanel');
    const chatIsUnavailable = routeName === 'chat' && welcomePanel && !welcomePanel.hasAttribute('data-shell-preserves-chat');
    if (chatIsUnavailable) {
        requestedRoute = 'home';
        applyCurrentView('home');
        closeOpenPanels();
        return;
    }

    if (!routeIsSupplemental) {
        requestedRoute = routeName;
        if (routeName !== 'home') {
            cancelHomeOpening();
            closeWelcomeScreenOverlay();
        }
        applyCurrentView(routeName);
    }

    if (routeName === 'home') {
        showHome();
        return;
    }

    if (routeName === 'chat') {
        showChat();
        return;
    }

    openPanel(routeName);
}

function syncConnectionStatus() {
    document.body.classList.toggle('st-shell-is-connected', !sendForm?.classList.contains('no-connection'));
}

function syncLanguageOptions() {
    if (!(legacyLanguageSelect instanceof HTMLSelectElement) || !(shellLanguageSelect instanceof HTMLSelectElement)) {
        return;
    }

    const legacySignature = Array.from(legacyLanguageSelect.options, option => `${option.value}:${option.textContent}`).join('|');
    const shellSignature = Array.from(shellLanguageSelect.options, option => `${option.value}:${option.textContent}`).join('|');

    if (legacySignature !== shellSignature) {
        shellLanguageSelect.replaceChildren(...Array.from(legacyLanguageSelect.options, option => option.cloneNode(true)));
    }

    shellLanguageSelect.value = legacyLanguageSelect.value;
}

function syncLegacyTopBar() {
    document.body.classList.toggle('st-shell-has-legacy-top-bar', Boolean(legacyTopBar?.children.length));
}

function syncExtensionRoutes() {
    extensionRouteContainers.forEach(container => container.replaceChildren());
    document.querySelectorAll('#top-settings-holder > .drawer').forEach((drawer) => {
        if (knownDrawerIds.has(drawer.id)) {
            return;
        }

        const icon = drawer.querySelector('.drawer-icon');
        if (!(icon instanceof HTMLElement)) {
            return;
        }

        const label = icon.getAttribute('title') || icon.getAttribute('aria-label') || drawer.id;
        const panel = drawer.querySelector(':scope > .drawer-content');
        let extensionRouteId = '';
        if (panel instanceof HTMLElement) {
            panel.classList.add('st-shell-extension-panel');
            panel.setAttribute('data-shell-extension-title', label);
            extensionRouteId = panel.getAttribute('data-shell-extension-route') || `extension-${++extensionRouteSequence}`;
            panel.setAttribute('data-shell-extension-route', extensionRouteId);
            if (!observedExtensionPanels.has(panel)) {
                observedExtensionPanels.add(panel);
                new MutationObserver(queueViewSync).observe(panel, { attributes: true, attributeFilter: ['class'] });
            }
        }

        extensionRouteContainers.forEach((container) => {
            const button = document.createElement('button');
            const buttonIcon = document.createElement('i');
            const buttonLabel = document.createElement('span');
            button.type = 'button';
            button.className = 'st-shell-nav-item st-shell-extension-route';
            button.setAttribute('aria-label', label);
            if (extensionRouteId) {
                button.setAttribute('data-shell-extension-route', extensionRouteId);
            }
            buttonIcon.className = 'fa-solid fa-puzzle-piece';
            buttonIcon.setAttribute('aria-hidden', 'true');
            buttonLabel.textContent = label;
            button.append(buttonIcon, buttonLabel);
            button.addEventListener('click', () => {
                closeMore();
                requestedRoute = null;
                if (panel instanceof HTMLElement) {
                    cancelHomeOpening();
                    closeWelcomeScreenOverlay();
                    applyCurrentView('extension', panel);
                }
                if (!panel?.classList.contains('openDrawer')) {
                    closeOpenPanels();
                    icon.click();
                }
                queueViewSync();
            });
            container.append(button);
        });
    });
    queueViewSync();
}

function isEntityCardActivation(event, card) {
    if (!(event.target instanceof Element)) {
        return false;
    }

    const nestedControl = event.target.closest('button, a[href], input, select, textarea, [contenteditable="true"], [role="button"], .tag');
    return !nestedControl || nestedControl === card;
}

document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || document.querySelector('#bulkEditButton')?.classList.contains('bulk_edit_overlay_active')) {
        return;
    }

    const character = event.target.closest('.character_select[data-chid]');
    if (character instanceof HTMLElement) {
        if (!isEntityCardActivation(event, character)) {
            return;
        }
        const characterId = character.dataset.chid ?? null;
        pendingCharacterSelection = characterId;
        pendingGroupSelection = null;
        queueMicrotask(() => {
            if (event.cancelBubble && pendingCharacterSelection === characterId) {
                pendingCharacterSelection = null;
            }
        });
        return;
    }

    const group = event.target.closest('.group_select[data-grid]');
    if (group instanceof HTMLElement) {
        if (!isEntityCardActivation(event, group)) {
            return;
        }
        const groupId = group.dataset.grid ?? null;
        const reselectingCurrentGroup = groupId === String(selected_group);
        pendingGroupSelection = groupId;
        pendingCharacterSelection = null;
        queueMicrotask(() => {
            if (event.cancelBubble) {
                if (pendingGroupSelection === groupId) {
                    pendingGroupSelection = null;
                }
                return;
            }
            if (reselectingCurrentGroup) {
                showSelectedGroupChat();
            }
        });
    }
}, true);

document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) {
        return;
    }

    const moreButton = event.target.closest('[data-shell-action="more"]');
    if (moreButton instanceof HTMLButtonElement) {
        openMore(moreButton);
        return;
    }

    const routeButton = event.target.closest('[data-shell-route]');
    if (!(routeButton instanceof HTMLButtonElement)) {
        return;
    }

    event.preventDefault();
    closeMore();
    activateRoute(String(routeButton.dataset.shellRoute));
});

document.addEventListener('keydown', (event) => {
    if (!isMobileCharacterContextOpen()) {
        return;
    }

    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeCharacterContext(true);
        return;
    }

    if (event.key !== 'Tab') {
        return;
    }

    const focusableElements = getCharacterContextFocusableElements();
    const firstElement = focusableElements.at(0);
    const lastElement = focusableElements.at(-1);
    if (!(firstElement instanceof HTMLElement) || !(lastElement instanceof HTMLElement)) {
        event.preventDefault();
        characterContextCloseButton?.focus({ preventScroll: true });
        return;
    }

    const activeElement = document.activeElement;
    if (event.shiftKey && (activeElement === firstElement || !characterPanel?.contains(activeElement))) {
        event.preventDefault();
        lastElement.focus({ preventScroll: true });
    } else if (!event.shiftKey && (activeElement === lastElement || !characterPanel?.contains(activeElement))) {
        event.preventDefault();
        firstElement.focus({ preventScroll: true });
    }
}, true);

document.addEventListener('focusin', (event) => {
    if (isMobileCharacterContextOpen() && event.target instanceof Node && !characterPanel?.contains(event.target)) {
        characterContextCloseButton?.focus({ preventScroll: true });
    }
}, true);

moreCloseButton?.addEventListener('click', closeMore);
characterDetailsButton?.addEventListener('click', openCharacterContext);
characterContextCloseButton?.addEventListener('click', () => closeCharacterContext(true));
moreDialog?.addEventListener('close', () => {
    if (moreOpener instanceof HTMLElement && moreOpener.isConnected) {
        moreOpener.focus({ preventScroll: true });
    }
    moreOpener = null;
});
moreDialog?.addEventListener('click', (event) => {
    if (event.target === moreDialog) {
        closeMore();
    }
});

shellLanguageSelect?.addEventListener('change', () => {
    if (!(legacyLanguageSelect instanceof HTMLSelectElement) || !(shellLanguageSelect instanceof HTMLSelectElement)) {
        return;
    }

    legacyLanguageSelect.value = shellLanguageSelect.value;
    legacyLanguageSelect.dispatchEvent(new Event('change', { bubbles: true }));
});

for (const route of Object.values(shellRoutes)) {
    const panel = document.querySelector(route.panel);
    if (panel) {
        new MutationObserver(() => {
            normalizePinnedPanelsForViewport();
            if (panel === characterPanel) {
                const isOpen = panel.classList.contains('openDrawer');
                characterDetailsButton?.setAttribute('aria-expanded', String(isOpen));
                if (!isOpen) {
                    setCharacterContextModal(false);
                }
            }
            queueViewSync();
        }).observe(panel, { attributes: true, attributeFilter: ['class'] });
    }
}

if (chatElement) {
    new MutationObserver(queueViewSync).observe(chatElement, { childList: true });
}

const selectedCharacterTitle = document.querySelector('#rm_button_selected_ch h2');
if (selectedCharacterTitle) {
    new MutationObserver(queueViewSync).observe(selectedCharacterTitle, { childList: true, subtree: true, characterData: true });
}

if (sendForm) {
    new MutationObserver(syncConnectionStatus).observe(sendForm, { attributes: true, attributeFilter: ['class'] });
}

let movingUIActive = document.body.classList.contains('movingUI');
new MutationObserver(() => {
    const isMovingUI = document.body.classList.contains('movingUI');
    if (isMovingUI && !movingUIActive) {
        cancelHomeOpening();
        closeWelcomeScreenOverlay();
    }
    movingUIActive = isMovingUI;
    normalizePinnedPanelsForViewport();
    queueViewSync();
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });

if (legacyLanguageSelect) {
    new MutationObserver(syncLanguageOptions).observe(legacyLanguageSelect, { childList: true });
}

const topSettingsHolder = document.querySelector('#top-settings-holder');
if (topSettingsHolder) {
    new MutationObserver(syncExtensionRoutes).observe(topSettingsHolder, { childList: true });
}

if (legacyTopBar) {
    new MutationObserver(syncLegacyTopBar).observe(legacyTopBar, { childList: true });
}

desktopMedia.addEventListener('change', (event) => {
    if (event.matches) {
        closeMore();
        setCharacterContextModal(false);
    } else if (characterPanel?.classList.contains('st-shell-character-context')) {
        closeCharacterContext();
    }
});
pinnedWorkspaceMedia.addEventListener('change', () => {
    normalizePinnedPanelsForViewport();
    queueViewSync();
});

window.addEventListener('load', () => {
    normalizePinnedPanelsForViewport();
    syncLegacyTopBar();
    syncLanguageOptions();
    syncConnectionStatus();
    syncExtensionRoutes();
    syncCurrentView();
    document.body.classList.add('st-shell-ready');
});

eventSource.on(event_types.APP_READY, () => {
    normalizePinnedPanelsForViewport();
    syncLegacyTopBar();
    syncLanguageOptions();
    syncConnectionStatus();
    syncExtensionRoutes();
    syncCurrentView();
    document.body.classList.add('st-shell-app-ready');
});
eventSource.on(event_types.CHARACTER_EDITOR_OPENED, showSelectedCharacterChat);
eventSource.on(event_types.CHAT_CHANGED, showSelectedGroupChat);

syncLegacyTopBar();
syncLanguageOptions();
syncConnectionStatus();
syncExtensionRoutes();
syncCurrentView();

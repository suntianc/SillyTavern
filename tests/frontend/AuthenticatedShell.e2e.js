/* global globalThis */
import { test, expect } from '@playwright/test';

async function expectNoHorizontalOverflow(page) {
    const hasHorizontalOverflow = await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth);
    expect(hasHorizontalOverflow).toBe(false);
}

async function expectVisibleInViewport(locator, viewport) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

async function expectVisibleTargetsAreLargeEnough(locator) {
    const result = await locator.evaluateAll((elements) => {
        const visibleElements = elements.filter((element) => {
            const rect = element.getBoundingClientRect();
            const style = globalThis.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        });
        return {
            count: visibleElements.length,
            allLargeEnough: visibleElements.every((element) => {
                const rect = element.getBoundingClientRect();
                return rect.width >= 44 && rect.height >= 44;
            }),
        };
    });
    expect(result.count).toBeGreaterThan(0);
    expect(result.allLargeEnough).toBe(true);
}

async function expectStyledSelect(locator) {
    await expect(locator).toBeVisible();
    const styles = await locator.evaluate((element) => {
        const style = globalThis.getComputedStyle(element);
        return {
            appearance: style.appearance,
            backgroundColor: style.backgroundColor,
            backgroundImage: style.backgroundImage,
            borderStyle: style.borderStyle,
            borderRadius: style.borderRadius,
            height: element.getBoundingClientRect().height,
        };
    });
    expect.soft(styles.appearance).toBe('none');
    expect.soft(styles.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect.soft(styles.backgroundImage).not.toBe('none');
    expect.soft(styles.borderStyle).toBe('solid');
    expect.soft(styles.borderRadius).not.toBe('0px');
    expect.soft(styles.height).toBeGreaterThanOrEqual(40);
}

async function mockCharacterChatPersistence(page, chatName) {
    await page.route('**/api/characters/edit*', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{}',
    }));
    await page.route('**/api/characters/get', async (route) => {
        const response = await route.fetch();
        const character = await response.json();
        await route.fulfill({ response, json: { ...character, chat: chatName } });
    });
}

test.describe('Authenticated application shell', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            if (!globalThis.localStorage.getItem('language')) {
                globalThis.localStorage.setItem('language', 'en');
            }
        });
    });

    test('resumes a character latest chat and keeps its details beside the chat', async ({ page }) => {
        const chatName = 'Seraphina - 2023-5-12 @21h 32m 29s 224ms';
        let requestedChat = null;
        let chatLoadCount = 0;
        await mockCharacterChatPersistence(page, chatName);
        await page.route('**/api/settings/save', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
        await page.route('**/api/chats/save', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
        await page.route('**/api/chats/get', (route) => {
            requestedChat = route.request().postDataJSON()?.file_name;
            chatLoadCount++;
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([
                    { chat_metadata: {} },
                    {
                        name: 'Seraphina',
                        is_user: false,
                        is_system: false,
                        send_date: '2026-08-11 @00h 00m 00s 000ms',
                        mes: 'Loaded from the latest character chat',
                        extra: {},
                        swipe_id: 0,
                        swipes: ['Loaded from the latest character chat'],
                        swipe_info: [{}],
                    },
                ]),
            });
        });

        const viewport = { width: 1366, height: 768 };
        await page.setViewportSize(viewport);
        await page.goto('/');
        await page.locator('#st-shell-rail [data-shell-route="characters"]').click();
        await page.locator('#rm_print_characters_block .character_select').filter({ hasText: 'Seraphina' }).first().click();

        const loadedMessage = page.locator('#chat .mes_text', { hasText: 'Loaded from the latest character chat' });
        await expect(loadedMessage).toBeVisible();
        expect(requestedChat).toBe(chatName);
        expect(chatLoadCount).toBe(1);
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'chat');
        await expect(page.locator('#st-shell-rail [data-shell-route="chat"]')).toHaveAttribute('aria-current', 'page');
        await expect(page.locator('#st-workspace-title')).toHaveText('Seraphina');
        await expect(page.locator('#right-nav-panel')).toHaveClass(/openDrawer/);
        await expect(page.locator('#right-nav-panel')).not.toHaveClass(/pinnedOpen/);
        await expect(page.locator('#rm_button_panel_pin')).not.toBeChecked();
        await expect(page.locator('#rm_ch_create_block')).toBeVisible();
        await expect.poll(() => page.locator('#rm_ch_create_block').evaluate(element => Number(globalThis.getComputedStyle(element).opacity))).toBeGreaterThan(0.99);
        await expectVisibleInViewport(page.locator('#send_form'), viewport);

        const layout = await page.locator('#chat').evaluate((chat) => {
            const message = Array.from(chat.querySelectorAll('.mes_text')).find(element => element.textContent.includes('Loaded from the latest character chat'));
            const messageRect = message.getBoundingClientRect();
            const topmost = globalThis.document.elementFromPoint(messageRect.left + messageRect.width / 2, messageRect.top + messageRect.height / 2);
            const chatRect = chat.getBoundingClientRect();
            const detailsRect = globalThis.document.querySelector('#right-nav-panel').getBoundingClientRect();
            return {
                messageIsTopmost: message.contains(topmost),
                chatRight: chatRect.right,
                detailsLeft: detailsRect.left,
                detailsWidth: detailsRect.width,
            };
        });
        expect(layout.messageIsTopmost).toBe(true);
        expect(layout.chatRight).toBeLessThanOrEqual(layout.detailsLeft + 1);
        expect(layout.detailsWidth).toBeGreaterThanOrEqual(320);

        const compactViewport = { width: 900, height: 600 };
        await page.setViewportSize(compactViewport);
        await expectVisibleInViewport(page.locator('#send_form'), compactViewport);
        await expectNoHorizontalOverflow(page);
        const compactLayout = await page.locator('#chat').evaluate((chat) => {
            const message = Array.from(chat.querySelectorAll('.mes_text')).find(element => element.textContent.includes('Loaded from the latest character chat'));
            const messageRect = message.getBoundingClientRect();
            const topmost = globalThis.document.elementFromPoint(messageRect.left + messageRect.width / 2, messageRect.top + messageRect.height / 2);
            const chatRect = chat.getBoundingClientRect();
            const detailsRect = globalThis.document.querySelector('#right-nav-panel').getBoundingClientRect();
            return {
                messageIsTopmost: message.contains(topmost),
                chatWidth: chatRect.width,
                chatRight: chatRect.right,
                detailsLeft: detailsRect.left,
            };
        });
        expect(compactLayout.messageIsTopmost).toBe(true);
        expect(compactLayout.chatWidth).toBeGreaterThanOrEqual(288);
        expect(compactLayout.chatRight).toBeLessThanOrEqual(compactLayout.detailsLeft + 1);

        const mobileViewport = { width: 390, height: 844 };
        await page.setViewportSize(mobileViewport);
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'chat');
        await expect(page.locator('#right-nav-panel')).not.toHaveClass(/openDrawer/);
        await expectVisibleInViewport(page.locator('#send_form'), mobileViewport);
        const detailsButton = page.getByRole('button', { name: 'Character details', exact: true });
        await expect(detailsButton).toBeVisible();
        await expect(detailsButton).toHaveAttribute('aria-expanded', 'false');
        await detailsButton.click();
        const characterDetailsPanel = page.locator('#right-nav-panel');
        await expect(characterDetailsPanel).toHaveClass(/openDrawer/);
        await expect(characterDetailsPanel).toHaveAttribute('role', 'dialog');
        await expect(characterDetailsPanel).toHaveAttribute('aria-modal', 'true');
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'chat');
        await expect(detailsButton).toHaveAttribute('aria-expanded', 'true');
        const closeDetails = page.getByRole('button', { name: 'Close character details' });
        await expect(closeDetails).toBeVisible();
        await expect(closeDetails).toBeFocused();
        await page.locator('#send_textarea').focus();
        await expect(closeDetails).toBeFocused();
        await closeDetails.click();
        await expect(page.locator('#right-nav-panel')).not.toHaveClass(/openDrawer/);
        await expect(detailsButton).toBeFocused();
        await expect(loadedMessage).toBeVisible();

        await detailsButton.click();
        await expect(page.locator('#right-nav-panel')).toHaveClass(/openDrawer/);
        await page.keyboard.press('Escape');
        await expect(page.locator('#right-nav-panel')).not.toHaveClass(/openDrawer/);
        await expect(detailsButton).toBeFocused();

        await page.setViewportSize(viewport);
        await page.locator('#st-shell-rail [data-shell-route="characters"]').click();
        await page.locator('#rm_print_characters_block .character_select').filter({ hasText: 'Seraphina' }).first().click();
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'chat');
        await expect(page.locator('#right-nav-panel')).toHaveClass(/openDrawer/);
        expect(chatLoadCount).toBe(1);
    });

    test('starts the native greeting chat when a character has no history', async ({ page }) => {
        let characterName;
        let greeting;
        let requestedChat;
        await page.route('**/api/characters/all', async (route) => {
            const response = await route.fetch();
            const characters = await response.json();
            characterName = characters[0].name;
            greeting = characters[0].first_mes;
            characters[0].chat = '';
            characters[0].shallow = false;
            await route.fulfill({ response, json: characters });
        });
        await page.route('**/api/chats/get', (route) => {
            requestedChat = route.request().postDataJSON()?.file_name;
            return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        });
        for (const pattern of ['**/api/chats/save', '**/api/characters/edit*', '**/api/settings/save']) {
            await page.route(pattern, route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
        }

        await page.setViewportSize({ width: 1366, height: 768 });
        await page.goto('/');
        await page.locator('#st-shell-rail [data-shell-route="characters"]').click();
        await page.locator('#rm_print_characters_block .character_select').filter({ hasText: characterName }).first().click();

        expect(requestedChat).toBeTruthy();
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'chat');
        await expect(page.locator('#right-nav-panel')).toHaveClass(/openDrawer/);
        const firstMessage = page.locator('#chat > .mes[is_user="false"] .mes_text').first();
        await expect(firstMessage).toBeVisible();
        await expect(firstMessage).toContainText(greeting.replace(/^[*_]+/, '').slice(0, 24));
        await expect(page.locator('#send_textarea')).toBeVisible();
    });

    test('resumes a group latest chat and keeps its details beside the chat', async ({ page }) => {
        let groupChatLoadCount = 0;
        await page.route('**/api/groups/all', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([{
                id: 'authenticated-shell-group',
                name: 'Authenticated Shell Group',
                members: ['default_Seraphina.png'],
                disabled_members: [],
                chat_id: 'authenticated-shell-group-latest',
                chats: ['authenticated-shell-group-latest'],
                activation_strategy: 0,
                generation_mode: 0,
                allow_self_responses: false,
                fav: false,
            }]),
        }));
        await page.route('**/api/chats/group/get', (route) => {
            groupChatLoadCount++;
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([
                    { chat_metadata: {} },
                    {
                        name: 'Seraphina',
                        is_user: false,
                        is_system: false,
                        send_date: '2026-08-11 @00h 00m 00s 000ms',
                        mes: 'Loaded from the latest group chat',
                        extra: {},
                        swipe_id: 0,
                        swipes: ['Loaded from the latest group chat'],
                        swipe_info: [{}],
                    },
                ]),
            });
        });
        for (const pattern of ['**/api/groups/edit', '**/api/chats/group/save', '**/api/settings/save']) {
            await page.route(pattern, route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
        }

        await page.setViewportSize({ width: 1366, height: 768 });
        await page.goto('/');
        await page.locator('#st-shell-rail [data-shell-route="characters"]').click();
        await page.locator('#rm_print_characters_block .group_select').filter({ hasText: 'Authenticated Shell Group' }).click();

        await expect(page.locator('#chat .mes_text', { hasText: 'Loaded from the latest group chat' })).toBeVisible();
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'chat');
        await expect(page.locator('#st-shell-rail [data-shell-route="chat"]')).toHaveAttribute('aria-current', 'page');
        await expect(page.locator('#right-nav-panel')).toHaveClass(/openDrawer/);
        await expect(page.locator('#rm_group_chats_block')).toBeVisible();
        expect(groupChatLoadCount).toBe(1);

        await page.locator('#st-shell-rail [data-shell-route="characters"]').click();
        const currentGroupCard = page.locator('#rm_print_characters_block .group_select').filter({ hasText: 'Authenticated Shell Group' });
        await currentGroupCard.evaluate((card) => {
            const tagExpander = globalThis.document.createElement('button');
            tagExpander.type = 'button';
            tagExpander.className = 'tag placeholder-expander test-group-tag-expander';
            tagExpander.textContent = '...';
            tagExpander.addEventListener('click', event => event.stopPropagation());
            card.append(tagExpander);
        });
        await currentGroupCard.locator('.test-group-tag-expander').click();
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'characters');
        expect(groupChatLoadCount).toBe(1);

        await currentGroupCard.click();
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'chat');
        await expect(page.locator('#right-nav-panel')).toHaveClass(/openDrawer/);
        expect(groupChatLoadCount).toBe(1);
    });

    test('keeps the workspace, composer, and legacy contracts usable on desktop', async ({ page }) => {
        await page.route('**/api/chats/save', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
        const viewport = { width: 900, height: 600 };
        await page.setViewportSize(viewport);
        await page.goto('/');

        await expect(page.locator('#st-shell-rail')).toBeVisible();
        await expect(page.locator('#st-shell-mobile-nav')).toBeHidden();
        await expect(page.locator('#st-workspace-title')).toHaveText('Recent Chats');
        await expectVisibleInViewport(page.locator('#send_form'), viewport);
        await expectNoHorizontalOverflow(page);
        const unavailableChatState = await page.locator('#st-shell-rail [data-shell-route="chat"]').evaluate((button) => {
            button.click();
            return {
                view: globalThis.document.body.dataset.shellView,
                title: globalThis.document.querySelector('#st-workspace-title').textContent,
                welcomeVisible: globalThis.getComputedStyle(globalThis.document.querySelector('.welcomePanel')).display !== 'none',
            };
        });
        expect(unavailableChatState).toEqual({ view: 'home', title: 'Recent Chats', welcomeVisible: true });

        await page.evaluate(() => {
            const extensionButton = globalThis.document.createElement('button');
            extensionButton.id = 'test-top-bar-extension';
            extensionButton.textContent = 'Legacy toolbar action';
            extensionButton.addEventListener('click', () => globalThis.document.body.dataset.testTopBarExtensionClicked = 'true');
            globalThis.document.querySelector('#top-bar').append(extensionButton);
        });
        await expect(page.locator('body')).toHaveClass(/st-shell-has-legacy-top-bar/);
        await expect(page.locator('#top-bar')).toBeVisible();
        await page.getByRole('button', { name: 'Legacy toolbar action' }).click();
        await expect(page.locator('body')).toHaveAttribute('data-test-top-bar-extension-clicked', 'true');
        const legacyToolbarBox = await page.locator('#top-bar').boundingBox();
        const shiftedWorkspaceBox = await page.locator('#sheld').boundingBox();
        expect(Math.abs(legacyToolbarBox.y + legacyToolbarBox.height - shiftedWorkspaceBox.y)).toBeLessThanOrEqual(1);
        await expectVisibleInViewport(page.locator('#send_form'), viewport);
        await page.locator('#test-top-bar-extension').evaluate(element => element.remove());
        await expect(page.locator('body')).not.toHaveClass(/st-shell-has-legacy-top-bar/);
        await expect(page.locator('#top-bar')).toBeHidden();

        const customStyle = await page.addStyleTag({ content: '#sheld { left: 260px; width: calc(100dvw - 260px); }' });
        await expect(page.locator('#sheld')).toHaveCSS('left', '260px');
        await customStyle.evaluate(element => element.remove());

        await page.locator('.st-shell-skip-link').focus();
        await expect(page.locator('.st-shell-skip-link')).toBeFocused();
        await expect(page.locator('.st-shell-skip-link')).toBeVisible();
        await expect(page.locator('.st-shell-skip-link')).toHaveCSS('outline-style', 'solid');
        await page.keyboard.press('Enter');
        await expect(page.locator('#chat')).toBeFocused();
        await page.locator('.st-shell-skip-link').focus();
        await page.keyboard.press('Tab');
        await expect(page.locator('#st-shell-rail [data-shell-route="home"]')).toBeFocused();

        for (const selector of [
            '#top-settings-holder',
            '#right-nav-panel',
            '#rm_print_characters_block',
            '#chat',
            '#send_form',
            '#send_textarea',
            '#send_but',
            '#mes_stop',
            '#mes_continue',
            '#mes_impersonate',
            '#file_form_input',
            '#qr_container',
            '#option_regenerate',
            '#message_template .mes_edit',
            '#message_template .mes_edit_delete',
            '#message_template .swipe_left',
            '#message_template .swipe_right',
        ]) {
            await expect(page.locator(selector)).toHaveCount(1);
        }

        const welcomePanel = page.locator('.welcomePanel');
        await welcomePanel.locator('.hideRecentChats').click();
        await expect(welcomePanel).toHaveClass(/recentHidden/);
        await welcomePanel.locator('.showRecentChats').click();
        await expect(welcomePanel).not.toHaveClass(/recentHidden/);
        const welcomeShortcuts = welcomePanel.locator('.welcomeShortcuts a');
        await expect(welcomeShortcuts).toHaveCount(3);
        for (const shortcut of await welcomeShortcuts.all()) {
            await expect(shortcut).toBeVisible();
            await expect(shortcut).toHaveAttribute('aria-label', /\S/);
        }
        await expect(welcomePanel.locator('.openTemporaryChat')).toBeVisible();
        await welcomePanel.locator('.openTemporaryChat').click();
        await expect(page.locator('.welcomePanel')).toHaveCount(0);
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'chat');
        await page.locator('#st-shell-rail [data-shell-route="home"]').click();
        await expect(page.locator('.welcomePanel')).toBeVisible();
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'home');

        await page.locator('#send_form').evaluate(element => element.classList.remove('no-connection'));
        await expect(page.locator('body')).toHaveClass(/st-shell-is-connected/);
        await page.locator('#send_form').evaluate(element => element.classList.add('no-connection'));
        await expect(page.locator('body')).not.toHaveClass(/st-shell-is-connected/);
        await page.locator('#send_form').evaluate(element => element.classList.remove('no-connection'));

        await page.locator('body').evaluate(element => element.dataset.generating = 'true');
        await expect(page.locator('#send_form')).toHaveCSS('border-top-color', 'rgba(198, 75, 82, 0.62)');
        await page.locator('body').evaluate(element => element.removeAttribute('data-generating'));

        await page.locator('[data-shell-route="characters"]').first().click();
        await expect(page.locator('#right-nav-panel')).toHaveClass(/openDrawer/);
        await expect(page.locator('#rm_characters_block')).toBeVisible();
        for (const selector of [
            '#rm_button_create',
            '#character_import_button',
            '#character_search_bar',
            '#character_sort_order',
            '#charListGridToggle',
            '#bulkEditButton',
            '#rm_print_characters_pagination',
            '#group_list_template .group_select',
        ]) {
            await expect(page.locator(selector)).toHaveCount(1);
        }
        await expect(page.locator('.rm_tag_filter')).toHaveCount(3);
        await expect(page.locator('#rm_button_create')).toBeVisible();
        await expect(page.locator('#character_import_button')).toBeVisible();
        await expect(page.locator('#rm_print_characters_pagination')).toBeVisible();
        await expect(page.locator('[data-shell-route="characters"]').first()).toHaveAttribute('aria-current', 'page');
        await expect(page.locator('[data-shell-route="home"]').first()).not.toHaveAttribute('aria-current', 'page');
        await expectVisibleTargetsAreLargeEnough(page.locator('#right-nav-panel [role="button"]'));

        await page.route('**/api/settings/save', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
        const gridWasEnabled = await page.locator('body').evaluate(element => element.classList.contains('charListGrid'));
        await page.locator('#charListGridToggle').click();
        expect(await page.locator('body').evaluate(element => element.classList.contains('charListGrid'))).toBe(!gridWasEnabled);
        await page.locator('#charListGridToggle').click();

        const characterCard = page.locator('.character_select[data-chid]:visible').first();
        await expect(characterCard).toBeVisible();
        await page.locator('#bulkEditButton').click();
        await expect(page.locator('#bulkEditButton')).toHaveClass(/bulk_edit_overlay_active/);
        await page.locator('#bulkSelectAllButton').click();
        await expect(characterCard).toHaveClass(/character_selected/);
        await page.locator('#bulkSelectAllButton').click();
        await expect(characterCard).not.toHaveClass(/character_selected/);
        await characterCard.click({ button: 'right' });
        await expect(page.locator('#character_context_menu')).toBeVisible();
        await page.locator('#character_context_menu').evaluate(element => element.classList.add('hidden'));
        await page.locator('#bulkEditButton').click();
        await expect(page.locator('#bulkEditButton')).not.toHaveClass(/bulk_edit_overlay_active/);

        const originalSortOption = await page.locator('#character_sort_order').inputValue();
        await page.locator('#character_sort_order').selectOption({ label: 'Z-A' });
        await expect(page.locator('#character_sort_order option:checked')).toHaveText('Z-A');
        await page.locator('#character_sort_order').selectOption(originalSortOption);
        const characterSearch = page.locator('#character_search_bar');
        await page.locator('#form_character_search_form').evaluate(element => element.style.display = 'none');
        await page.locator('#rm_button_search').click();
        await expect(characterSearch).toBeVisible();
        const initialCharacterCount = await page.locator('.character_select[data-chid]:visible').count();
        await characterSearch.fill('__authenticated_shell_no_match__');
        await expect(page.locator('.character_select[data-chid]:visible')).toHaveCount(0);
        await characterSearch.fill('');
        await expect(page.locator('.character_select[data-chid]:visible')).toHaveCount(initialCharacterCount);
        const favoritesTagFilter = page.locator('.rm_tag_filter:visible .filterByFavorites');
        await favoritesTagFilter.click();
        await expect(favoritesTagFilter).toHaveAttribute('data-toggle-state', 'SELECTED');
        await favoritesTagFilter.click();
        await expect(favoritesTagFilter).toHaveAttribute('data-toggle-state', 'EXCLUDED');
        await favoritesTagFilter.click();
        await expect(favoritesTagFilter).toHaveAttribute('data-toggle-state', 'UNDEFINED');

        await page.locator('#rm_button_group_chats').click();
        await expect(page.locator('#rm_group_chats_block')).toBeVisible();
        await page.locator('#st-shell-rail [data-shell-route="characters"]').click();
        await expect(page.locator('#rm_print_characters_block')).toBeVisible();
        await page.locator('.character_select[data-chid]:visible').first().click();
        await expect(page.locator('#rm_ch_create_block')).toBeVisible();
        await page.locator('#st-shell-rail [data-shell-route="characters"]').click();
        await expect(page.locator('#rm_print_characters_block')).toBeVisible();

        const panelBox = await page.locator('#right-nav-panel').boundingBox();
        const headerBox = await page.locator('#st-workspace-header').boundingBox();
        expect(Math.abs(panelBox.y - (headerBox.y + headerBox.height))).toBeLessThanOrEqual(1);
        expect(panelBox.y + panelBox.height).toBe(viewport.height);

        await page.setViewportSize({ width: 1366, height: 768 });
        await page.locator('#rm_button_panel_pin').evaluate((checkbox) => {
            checkbox.checked = true;
            checkbox.closest('#right-nav-panel').classList.add('pinnedOpen');
        });
        const pinnedPanelBox = await page.locator('#right-nav-panel').boundingBox();
        const narrowedWorkspaceBox = await page.locator('#sheld').boundingBox();
        expect(Math.abs(narrowedWorkspaceBox.x + narrowedWorkspaceBox.width - pinnedPanelBox.x)).toBeLessThanOrEqual(1);
        await page.locator('#st-shell-rail [data-shell-route="formatting"]').click();
        await expect(page.locator('#right-nav-panel')).toHaveClass(/openDrawer.*pinnedOpen|pinnedOpen.*openDrawer/);
        await expect(page.locator('#AdvancedFormatting')).toHaveClass(/openDrawer/);
        const formattingBox = await page.locator('#AdvancedFormatting').boundingBox();
        expect(formattingBox.x + formattingBox.width).toBeLessThanOrEqual(pinnedPanelBox.x + 1);

        await page.locator('#st-shell-rail [data-shell-route="ai-config"]').click();
        await page.locator('#lm_button_panel_pin').evaluate((checkbox) => {
            checkbox.checked = true;
            checkbox.closest('#left-nav-panel').classList.add('pinnedOpen');
        });
        await page.locator('#st-shell-rail [data-shell-route="world-info"]').click();
        await page.locator('#WI_panel_pin').evaluate((checkbox) => {
            checkbox.checked = true;
            checkbox.closest('#WorldInfo').classList.add('pinnedOpen');
        });
        await page.locator('#st-shell-rail [data-shell-route="home"]').click();
        await expect(page.locator('#right-nav-panel')).toHaveClass(/openDrawer.*pinnedOpen|pinnedOpen.*openDrawer/);
        await expect(page.locator('#left-nav-panel')).toHaveClass(/openDrawer.*pinnedOpen|pinnedOpen.*openDrawer/);
        await expect(page.locator('#WorldInfo')).toHaveClass(/openDrawer.*pinnedOpen|pinnedOpen.*openDrawer/);
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'home');
        await expect(page.locator('#st-shell-rail [data-shell-route="home"]')).toHaveAttribute('aria-current', 'page');
        const pinnedLeftBox = await page.locator('#left-nav-panel').boundingBox();
        const pinnedWorldInfoBox = await page.locator('#WorldInfo').boundingBox();
        const pinnedRightBox = await page.locator('#right-nav-panel').boundingBox();
        const composedWorkspaceBox = await page.locator('#sheld').boundingBox();
        expect(pinnedLeftBox.x + pinnedLeftBox.width).toBeLessThanOrEqual(composedWorkspaceBox.x + 1);
        expect(composedWorkspaceBox.x + composedWorkspaceBox.width).toBeLessThanOrEqual(pinnedWorldInfoBox.x + 1);
        expect(pinnedWorldInfoBox.x + pinnedWorldInfoBox.width).toBeLessThanOrEqual(pinnedRightBox.x + 1);

        await page.locator('#st-shell-rail [data-shell-route="characters"]').click();
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'home');
        await expect(page.locator('#st-shell-rail [data-shell-route="home"]')).toHaveAttribute('aria-current', 'page');
        await expect(page.locator('#st-shell-rail [data-shell-route="characters"]')).not.toHaveAttribute('aria-current', 'page');

        await page.setViewportSize({ width: 1280, height: 720 });
        for (const panel of ['#right-nav-panel', '#left-nav-panel', '#WorldInfo']) {
            await expect(page.locator(panel)).not.toHaveClass(/openDrawer/);
        }
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'home');
        await expectVisibleInViewport(page.locator('#send_form'), { width: 1280, height: 720 });
        expect((await page.locator('#send_form').boundingBox()).width).toBeGreaterThan(500);
        await page.setViewportSize({ width: 1366, height: 768 });

        await page.evaluate(() => {
            for (const [checkboxId, panelId] of [
                ['rm_button_panel_pin', 'right-nav-panel'],
                ['lm_button_panel_pin', 'left-nav-panel'],
                ['WI_panel_pin', 'WorldInfo'],
            ]) {
                const checkbox = globalThis.document.getElementById(checkboxId);
                checkbox.checked = false;
                globalThis.document.getElementById(panelId).classList.remove('pinnedOpen');
            }
        });

        const routePanels = [
            ['ai-config', '#left-nav-panel'],
            ['api', '#rm_api_block'],
            ['formatting', '#AdvancedFormatting'],
            ['world-info', '#WorldInfo'],
            ['persona', '#PersonaManagement'],
            ['backgrounds', '#Backgrounds'],
            ['user-settings', '#user-settings-block'],
            ['extensions', '#rm_extensions_block'],
        ];
        for (const [route, panel] of routePanels) {
            await page.locator(`#st-shell-rail [data-shell-route="${route}"]`).click();
            await expect(page.locator(panel)).toHaveClass(/openDrawer/);
            await expect(page.locator(`#st-shell-rail [data-shell-route="${route}"]`)).toHaveAttribute('aria-current', 'page');
        }

        await page.locator('[data-shell-route="chat"]').first().click();
        await expect(page.locator('#right-nav-panel')).not.toHaveClass(/openDrawer/);
        for (const [, panel] of routePanels) {
            await expect(page.locator(panel)).not.toHaveClass(/openDrawer/);
        }
        await expectVisibleInViewport(page.locator('#send_form'), { width: 1366, height: 768 });

        await page.evaluate(() => {
            const drawer = globalThis.document.createElement('div');
            drawer.id = 'test-desktop-extension-drawer';
            drawer.className = 'drawer';
            drawer.innerHTML = '<div class="drawer-toggle"><button class="drawer-icon" title="Desktop test extension">X</button></div><div class="drawer-content closedDrawer"></div>';
            drawer.querySelector('.drawer-icon').addEventListener('click', () => {
                const panel = drawer.querySelector('.drawer-content');
                panel.classList.toggle('openDrawer');
                panel.classList.toggle('closedDrawer');
                globalThis.document.body.dataset.testDesktopExtensionOpened = 'true';
            });
            globalThis.document.querySelector('#top-settings-holder').append(drawer);
        });
        const desktopExtensionRoute = page.locator('#st-shell-desktop-extension-routes').getByRole('button', { name: 'Desktop test extension' });
        await expect(desktopExtensionRoute).toBeVisible();
        await desktopExtensionRoute.click();
        const desktopExtensionPanel = page.locator('#test-desktop-extension-drawer .drawer-content');
        await expect(page.locator('body')).toHaveAttribute('data-test-desktop-extension-opened', 'true');
        await expect(desktopExtensionPanel).toHaveClass(/openDrawer/);
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'extension');
        await expect(page.locator('#st-workspace-title')).toHaveText('Desktop test extension');
        await expect(desktopExtensionRoute).toHaveAttribute('aria-current', 'page');
        await expect(desktopExtensionPanel).not.toHaveAttribute('aria-current', 'page');
        const desktopExtensionBox = await desktopExtensionPanel.boundingBox();
        const desktopHeaderBox = await page.locator('#st-workspace-header').boundingBox();
        expect(Math.abs(desktopExtensionBox.y - (desktopHeaderBox.y + desktopHeaderBox.height))).toBeLessThanOrEqual(1);
        expect(desktopExtensionBox.y + desktopExtensionBox.height).toBe(768);
        await expectNoHorizontalOverflow(page);
        await page.locator('#st-shell-rail [data-shell-route="home"]').click();
        await expect(desktopExtensionPanel).not.toHaveClass(/openDrawer/);

        await page.setViewportSize(viewport);
        await page.locator('body').evaluate(element => element.classList.add('movingUI'));
        await expect(page.locator('#st-shell-rail')).toBeHidden();
        await expect(page.locator('#top-bar')).toBeVisible();
        await expect(page.locator('#sheld')).toHaveCSS('left', '0px');
        await expect(page.locator('#sheld')).toHaveCSS('width', `${viewport.width}px`);
        await page.locator('body').evaluate(element => element.classList.remove('movingUI'));
        await expect(page.locator('#st-shell-rail')).toBeVisible();
    });

    test('converges overlapping welcome requests into one screen', async ({ page }) => {
        let releaseRecentChats;
        const recentChatsGate = new Promise(resolve => releaseRecentChats = resolve);
        let recentChatRequests = 0;
        await page.route('**/api/chats/recent', async (route) => {
            recentChatRequests++;
            await recentChatsGate;
            return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        });

        await page.setViewportSize({ width: 900, height: 600 });
        await page.goto('/');
        await expect.poll(() => recentChatRequests).toBeGreaterThan(0);
        await page.locator('#st-shell-rail [data-shell-route="home"]').click();
        await expect.poll(() => recentChatRequests).toBeGreaterThan(1);
        releaseRecentChats();

        await expect(page.locator('.welcomePanel')).toHaveCount(1);
        await expect(page.locator('.welcomePanel')).not.toHaveAttribute('data-shell-preserves-chat', '');
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'home');
        await page.locator('#st-shell-rail [data-shell-route="chat"]').click();
        await expect(page.locator('.welcomePanel')).toHaveCount(1);
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'home');
    });

    test('does not append welcome messages after assistant loading is superseded', async ({ page }) => {
        let markAssistantRequestStarted;
        let releaseAssistantRequest;
        let assistantRequestGated = false;
        const assistantRequestStarted = new Promise(resolve => markAssistantRequestStarted = resolve);

        await page.setViewportSize({ width: 900, height: 600 });
        await page.goto('/');
        const assistantAvatar = await page.evaluate(async () => (await import('/scripts/welcome-screen.js')).getPermanentAssistantAvatar());
        await page.route('**/api/characters/get', async (route) => {
            const requestedAvatar = route.request().postDataJSON()?.avatar_url;
            if (assistantRequestGated || requestedAvatar !== assistantAvatar) {
                return route.continue();
            }
            assistantRequestGated = true;
            markAssistantRequestStarted();
            await new Promise(resolve => releaseAssistantRequest = resolve);
            await route.continue();
        });
        await page.evaluate(async (assistantAvatar) => {
            const script = await import('/script.js');
            const welcomeScreen = await import('/scripts/welcome-screen.js');
            let assistant = script.characters.find(character => character.avatar === assistantAvatar);
            if (!assistant) {
                assistant = { avatar: assistantAvatar, name: 'Assistant fixture' };
                script.characters.push(assistant);
            }
            assistant.shallow = true;
            globalThis.testWelcomePromise = welcomeScreen.openWelcomeScreen({ force: true });
        }, assistantAvatar);
        await assistantRequestStarted;
        let temporaryMessages;
        try {
            await expect(page.locator('.welcomePanel')).toBeVisible();
            await page.locator('.openTemporaryChat').click();
            await expect(page.locator('.welcomePanel')).toHaveCount(0);
            temporaryMessages = await page.locator('#chat > .mes').count();
            expect(temporaryMessages).toBeGreaterThan(0);
        } finally {
            releaseAssistantRequest?.();
        }

        await page.evaluate(() => globalThis.testWelcomePromise);
        await expect(page.locator('#chat > .mes')).toHaveCount(temporaryMessages);
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'chat');
    });

    test('closes the active named chat before starting a temporary chat from Home', async ({ page }) => {
        await page.route('**/api/chats/recent', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([{
                file_name: 'named-before-temporary.jsonl',
                avatar: 'default_Seraphina.png',
                last_mes: '2026-08-10 @20h 38m 00s 000ms',
                mes: 'Named chat before temporary chat',
                chat_items: 1,
                file_size: '1 KB',
            }]),
        }));
        await mockCharacterChatPersistence(page, 'named-before-temporary');
        await page.route('**/api/settings/save', route => route.fulfill({ status: 200, body: '{}' }));
        await page.route('**/api/chats/save', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
        await page.route('**/api/chats/get', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
                { chat_metadata: {} },
                {
                    name: 'Seraphina',
                    is_user: false,
                    is_system: false,
                    send_date: '2026-08-10 @20h 38m 00s 000ms',
                    mes: 'Named chat before temporary chat',
                    extra: {},
                },
            ]),
        }));

        await page.setViewportSize({ width: 900, height: 600 });
        await page.goto('/');
        await page.locator('.recentChatOpen').first().focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#chat')).toContainText('Named chat before temporary chat');
        expect(await page.evaluate(async () => (await import('/script.js')).getCurrentChatId())).toBeDefined();

        await page.locator('#st-shell-rail [data-shell-route="home"]').click();
        await expect(page.locator('.welcomePanel[data-shell-preserves-chat]')).toBeVisible();
        await page.locator('.openTemporaryChat').click();
        await expect(page.locator('.welcomePanel')).toHaveCount(0);

        await expect.poll(() => page.evaluate(async () => {
            const script = await import('/script.js');
            return {
                currentChatId: script.getCurrentChatId() ?? null,
                hasAssistantNote: script.chat.some(message => message.extra?.type === script.system_message_types.ASSISTANT_NOTE),
            };
        })).toEqual({ currentChatId: null, hasAssistantNote: true });
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'chat');
    });

    test('does not reopen Home after a delayed recent-chat operation finishes', async ({ page }) => {
        let markRenameStarted;
        let releaseRename;
        let renameFinished = false;
        const renameStarted = new Promise(resolve => markRenameStarted = resolve);
        await page.route('**/api/chats/recent', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([{
                file_name: 'delayed-operation.jsonl',
                avatar: 'default_Seraphina.png',
                last_mes: '2026-08-10 @20h 38m 00s 000ms',
                mes: 'Delayed operation fixture',
                chat_items: 1,
                file_size: '1 KB',
            }]),
        }));
        await page.route('**/api/chats/rename', async (route) => {
            markRenameStarted();
            await new Promise(resolve => releaseRename = resolve);
            await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
            renameFinished = true;
        });
        await page.route('**/api/characters/merge-attributes', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

        await page.setViewportSize({ width: 900, height: 600 });
        await page.goto('/');
        await page.locator('.openTemporaryChat').click();
        await page.locator('#st-shell-rail [data-shell-route="home"]').click();
        await expect(page.locator('.welcomePanel[data-shell-preserves-chat]')).toBeVisible();

        await page.locator('.recentChat').first().locator('.renameChat').click();
        await expect(page.locator('dialog.popup')).toBeVisible();
        await page.locator('dialog.popup .popup-input').fill('Renamed by regression');
        await page.locator('dialog.popup .popup-button-ok').click();
        await renameStarted;
        try {
            await page.locator('#st-shell-rail [data-shell-route="chat"]').click();
            await expect(page.locator('.welcomePanel')).toHaveCount(0);
            await expect.poll(() => page.evaluate(async () => {
                const script = await import('/script.js');
                return script.chat.some(message => message.extra?.type === script.system_message_types.ASSISTANT_NOTE);
            })).toBe(true);
        } finally {
            releaseRename?.();
        }

        await expect.poll(() => renameFinished).toBe(true);
        await expect(page.locator('.toast-success')).toContainText('Chat renamed.');
        const temporaryChat = await page.evaluate(async () => {
            const script = await import('/script.js');
            return {
                currentChatId: script.getCurrentChatId(),
                hasAssistantNote: script.chat.some(message => message.extra?.type === script.system_message_types.ASSISTANT_NOTE),
            };
        });
        expect(temporaryChat.currentChatId).toBeUndefined();
        expect(temporaryChat.hasAssistantNote).toBe(true);
        await expect(page.locator('.welcomePanel')).toHaveCount(0);
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'chat');
    });

    test('reports a failed Welcome render without appending welcome messages', async ({ page }) => {
        let holdRecentChats = false;
        let releaseRecentChats;
        let markRecentRequestStarted;
        const recentRequestStarted = new Promise(resolve => markRecentRequestStarted = resolve);
        await page.route('**/api/chats/recent', async (route) => {
            if (holdRecentChats) {
                markRecentRequestStarted();
                await new Promise(resolve => releaseRecentChats = resolve);
            }
            await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        });

        await page.setViewportSize({ width: 900, height: 600 });
        await page.goto('/');
        holdRecentChats = true;
        await page.evaluate(async () => {
            const welcome = await import('/scripts/welcome-screen.js');
            globalThis.testWelcomeResult = welcome.openWelcomeScreen({ force: true });
            return true;
        });
        await recentRequestStarted;
        await page.locator('#chat').evaluate(element => element.remove());
        releaseRecentChats();

        const result = await page.evaluate(() => globalThis.testWelcomeResult);
        const chatLength = await page.evaluate(async () => (await import('/script.js')).chat.length);
        expect(result).toBe(false);
        expect(chatLength).toBe(0);
    });

    test('cancels a stale Home request when a temporary chat changes', async ({ page }) => {
        let holdRecentChats = false;
        let releaseRecentChats;
        let markRecentRequestStarted;
        const recentRequestStarted = new Promise(resolve => markRecentRequestStarted = resolve);
        await page.route('**/api/chats/recent', async (route) => {
            if (holdRecentChats) {
                markRecentRequestStarted();
                await new Promise(resolve => releaseRecentChats = resolve);
            }
            return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        });

        await page.setViewportSize({ width: 900, height: 600 });
        await page.goto('/');
        await page.locator('.openTemporaryChat').click();
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'chat');

        holdRecentChats = true;
        await page.locator('#st-shell-rail [data-shell-route="home"]').click();
        await recentRequestStarted;
        await page.evaluate(async () => {
            const { newAssistantChat } = await import('/script.js');
            await newAssistantChat({ temporary: true });
        });
        releaseRecentChats();

        await expect(page.locator('.welcomePanel')).toHaveCount(0);
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'chat');
    });

    test('switches from chat to non-chat routes atomically', async ({ page }) => {
        await page.setViewportSize({ width: 900, height: 600 });
        await page.goto('/');
        await page.locator('.openTemporaryChat').click();
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'chat');

        const routes = [
            ['characters', 'Choose a character', '#right-nav-panel'],
            ['world-info', 'World Info', '#WorldInfo'],
            ['persona', 'Persona Management', '#PersonaManagement'],
            ['ai-config', 'AI Response Configuration', '#left-nav-panel'],
            ['formatting', 'AI Response Formatting', '#AdvancedFormatting'],
            ['backgrounds', 'Backgrounds', '#Backgrounds'],
            ['user-settings', 'User Settings', '#user-settings-block'],
            ['extensions', 'Extensions', '#rm_extensions_block'],
            ['api', 'API Connections', '#rm_api_block'],
        ];

        for (const [route, title, panel] of routes) {
            const immediateState = await page.locator(`#st-shell-rail [data-shell-route="${route}"]`).evaluate((button, panelSelector) => {
                button.click();
                return {
                    view: globalThis.document.body.dataset.shellView,
                    title: globalThis.document.querySelector('#st-workspace-title').textContent,
                    panelOpen: globalThis.document.querySelector(panelSelector).classList.contains('openDrawer'),
                };
            }, panel);
            expect(immediateState).toEqual({ view: route, title, panelOpen: true });
            await expect(page.locator(panel)).toHaveClass(/openDrawer/);
            await page.locator('#st-shell-rail [data-shell-route="chat"]').click();
            await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'chat');
        }

        const immediateHomeState = await page.locator('#st-shell-rail [data-shell-route="home"]').evaluate((button) => {
            button.click();
            const messages = Array.from(globalThis.document.querySelectorAll('#chat > .mes'));
            return {
                view: globalThis.document.body.dataset.shellView,
                title: globalThis.document.querySelector('#st-workspace-title').textContent,
                messageCount: messages.length,
                messagesHidden: messages.every(message => globalThis.getComputedStyle(message).display === 'none'),
            };
        });
        expect(immediateHomeState).toEqual({
            view: 'home',
            title: 'Recent Chats',
            messageCount: 1,
            messagesHidden: true,
        });
        await expect(page.locator('.welcomePanel[data-shell-preserves-chat]')).toBeVisible();
    });

    test('restores the current chat before entering movingUI', async ({ page }) => {
        await page.setViewportSize({ width: 900, height: 600 });
        await page.goto('/');
        await page.locator('.openTemporaryChat').click();
        const currentMessage = page.locator('#chat > .mes').first();
        await expect(currentMessage).toBeVisible();
        await page.locator('#st-shell-rail [data-shell-route="home"]').click();
        await expect(page.locator('.welcomePanel[data-shell-preserves-chat]')).toBeVisible();
        await expect(currentMessage).toBeHidden();

        await page.locator('body').evaluate(element => element.classList.add('movingUI'));
        await expect(page.locator('.welcomePanel[data-shell-preserves-chat]')).toHaveCount(0);
        await expect(currentMessage).toBeVisible();
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'chat');
        await expect(page.locator('#st-shell-rail')).toBeHidden();
    });

    test('does not restore Home scroll after a canceled recent-chat refresh', async ({ page }) => {
        let holdRecentChats = false;
        let releaseRecentChats;
        let markRecentRequestStarted;
        const recentRequestStarted = new Promise(resolve => markRecentRequestStarted = resolve);
        await page.route('**/api/chats/recent', async (route) => {
            if (holdRecentChats) {
                markRecentRequestStarted();
                await new Promise(resolve => releaseRecentChats = resolve);
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([{
                    file_name: 'scroll-probe.jsonl',
                    avatar: 'default_Seraphina.png',
                    last_mes: '2026-08-10 @20h 38m 00s 000ms',
                    mes: 'Scroll probe',
                    chat_items: 1,
                    file_size: '1 KB',
                }]),
            });
        });

        await page.setViewportSize({ width: 900, height: 600 });
        await page.goto('/');
        await page.locator('.openTemporaryChat').click();
        await page.locator('#st-shell-rail [data-shell-route="home"]').click();
        await expect(page.locator('.welcomePanel[data-shell-preserves-chat]')).toBeVisible();
        await page.locator('#chat').evaluate((element) => {
            let scrollTop = 120;
            element.dataset.testScrollWrites = '0';
            Object.defineProperty(element, 'scrollTop', {
                configurable: true,
                get: () => scrollTop,
                set: (value) => {
                    scrollTop = value;
                    element.dataset.testScrollWrites = String(Number(element.dataset.testScrollWrites) + 1);
                },
            });
        });

        await page.locator('.recentChatsSettings').click();
        await expect(page.locator('dialog.popup')).toBeVisible();
        holdRecentChats = true;
        await page.locator('dialog.popup .popup-button-ok').click();
        await recentRequestStarted;
        await page.locator('#st-shell-rail [data-shell-route="chat"]').click();
        await expect(page.locator('.welcomePanel')).toHaveCount(0);
        await page.locator('#chat').evaluate(element => element.dataset.testScrollWrites = '0');
        const refreshedResponse = page.waitForResponse('**/api/chats/recent');
        releaseRecentChats();
        await refreshedResponse;
        await page.evaluate(() => new Promise(resolve => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))));
        await expect(page.locator('#chat')).toHaveAttribute('data-test-scroll-writes', '0');
    });

    test('does not restore normal Welcome scroll after a chat opens', async ({ page }) => {
        await mockCharacterChatPersistence(page, 'normal-scroll-probe');
        let holdRecentChats = false;
        let releaseRecentChats;
        let markRecentRequestStarted;
        const recentRequestStarted = new Promise(resolve => markRecentRequestStarted = resolve);
        await page.route('**/api/chats/recent', async (route) => {
            if (holdRecentChats) {
                markRecentRequestStarted();
                await new Promise(resolve => releaseRecentChats = resolve);
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([{
                    file_name: 'normal-scroll-probe.jsonl',
                    avatar: 'default_Seraphina.png',
                    last_mes: '2026-08-10 @20h 38m 00s 000ms',
                    mes: 'Normal scroll probe',
                    chat_items: 1,
                    file_size: '1 KB',
                }]),
            });
        });
        await page.route('**/api/settings/save', route => route.fulfill({ status: 200, body: '{}' }));
        await page.route('**/api/chats/save', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
        await page.route('**/api/chats/get', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
                { chat_metadata: {} },
                {
                    name: 'Seraphina',
                    is_user: false,
                    is_system: false,
                    send_date: '2026-08-10 @20h 38m 00s 000ms',
                    mes: 'Normal refresh replacement chat',
                    extra: {},
                },
            ]),
        }));

        await page.setViewportSize({ width: 900, height: 600 });
        await page.goto('/');
        await page.locator('.recentChatsSettings').click();
        await expect(page.locator('dialog.popup')).toBeVisible();
        holdRecentChats = true;
        await page.locator('dialog.popup .popup-button-ok').click();
        await recentRequestStarted;
        await page.locator('.recentChatOpen').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#chat')).toContainText('Normal refresh replacement chat');
        await expect(page.locator('#send_textarea')).toBeFocused();
        await page.evaluate(() => new Promise(resolve => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))));
        await page.locator('#chat').evaluate((element) => {
            let scrollTop = element.scrollTop;
            element.dataset.testScrollWrites = '0';
            Object.defineProperty(element, 'scrollTop', {
                configurable: true,
                get: () => scrollTop,
                set: (value) => {
                    scrollTop = value;
                    element.dataset.testScrollWrites = String(Number(element.dataset.testScrollWrites) + 1);
                },
            });
        });
        const refreshedResponse = page.waitForResponse('**/api/chats/recent');
        const canceledRefresh = page.waitForEvent('console', {
            predicate: message => message.type() === 'debug' && message.text() === 'Chat changed while fetching recent chats.',
        });
        releaseRecentChats();

        await refreshedResponse;
        await canceledRefresh;
        await page.evaluate(() => new Promise(resolve => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))));
        await expect(page.locator('#chat')).toHaveAttribute('data-test-scroll-writes', '0');
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'chat');
    });

    test('styles shell navigation selection and dropdowns', async ({ page }) => {
        await page.setViewportSize({ width: 900, height: 600 });
        await page.goto('/');
        await page.locator('#st-shell-rail [data-shell-route="characters"]').click();
        await expect(page.locator('#right-nav-panel')).toHaveClass(/openDrawer/);

        const activeCharacterRoute = page.locator('#st-shell-rail [data-shell-route="characters"]');
        await expect.soft(activeCharacterRoute).toHaveCSS('box-shadow', 'none');
        const routeBackgrounds = await page.locator('#st-shell-rail').evaluate((rail) => ({
            active: globalThis.getComputedStyle(rail.querySelector('[data-shell-route="characters"]')).backgroundColor,
            inactive: globalThis.getComputedStyle(rail.querySelector('[data-shell-route="home"]')).backgroundColor,
        }));
        expect.soft(routeBackgrounds.active).not.toBe(routeBackgrounds.inactive);
        await expectStyledSelect(page.locator('#st-shell-language'));
        await expectStyledSelect(page.locator('#character_sort_order'));

        await page.setViewportSize({ width: 390, height: 844 });
        const activeMobileRoute = page.locator('#st-shell-mobile-nav [data-shell-route="characters"]');
        await expect.soft(activeMobileRoute).toHaveCSS('box-shadow', 'none');
        await expect.soft(activeMobileRoute).toHaveCSS('background-image', 'none');
        const mobileRouteBackgrounds = await page.locator('#st-shell-mobile-nav').evaluate((nav) => ({
            active: globalThis.getComputedStyle(nav.querySelector('[data-shell-route="characters"]')).backgroundColor,
            inactive: globalThis.getComputedStyle(nav.querySelector('[data-shell-route="chat"]')).backgroundColor,
        }));
        expect.soft(mobileRouteBackgrounds.active).not.toBe(mobileRouteBackgrounds.inactive);
    });

    test('returns from recent chats to the loaded current chat', async ({ page }) => {
        await mockCharacterChatPersistence(page, 'synthetic-current');
        await page.route('**/api/chats/recent', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([{
                file_name: 'synthetic-current.jsonl',
                avatar: 'default_Seraphina.png',
                last_mes: '2026-08-10 @20h 38m 00s 000ms',
                mes: 'Synthetic current message',
                chat_items: 1,
                file_size: '1 KB',
            }]),
        }));
        await page.route('**/api/settings/save', route => route.fulfill({ status: 200, body: '{}' }));
        await page.route('**/api/chats/save', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
        let chatLoadRequests = 0;
        await page.route('**/api/chats/get', (route) => {
            chatLoadRequests++;
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([
                    { chat_metadata: {} },
                    {
                        name: 'Seraphina',
                        is_user: false,
                        is_system: false,
                        send_date: '2026-08-10 @20h 38m 00s 000ms',
                        mes: 'Synthetic current message',
                        extra: {},
                        swipe_id: 0,
                        swipes: ['Synthetic current message'],
                        swipe_info: [{}],
                    },
                ]),
            });
        });
        await page.setViewportSize({ width: 900, height: 600 });
        await page.goto('/');

        await page.locator('.recentChatOpen').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#chat')).toContainText('Synthetic current message');
        await expect(page.locator('#st-workspace-title')).toHaveText('Seraphina');
        await expect.poll(() => page.evaluate(() => globalThis.SillyTavern.getContext().chatId)).toBe('synthetic-current');
        const activeChatId = await page.evaluate(() => globalThis.SillyTavern.getContext().chatId);
        const activeMessage = page.locator('#chat .mes_text', { hasText: 'Synthetic current message' });
        const composer = page.locator('#send_textarea');
        await expect(activeMessage).toBeVisible();
        await composer.fill('Preserved draft');
        const chatLoadRequestsBeforeHome = chatLoadRequests;
        expect(chatLoadRequestsBeforeHome).toBeGreaterThan(0);
        await page.locator('#st-shell-rail [data-shell-route="home"]').click();
        await expect(page.locator('.welcomePanel[data-shell-preserves-chat]')).toBeVisible();
        await expect(activeMessage).toBeHidden();
        await expect(composer).toHaveValue('Preserved draft');
        expect(await page.evaluate(() => globalThis.SillyTavern.getContext().chatId)).toBe(activeChatId);
        await page.locator('.recentChatOpen').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('.welcomePanel')).toHaveCount(0);
        await expect(activeMessage).toBeVisible();
        await expect(composer).toHaveValue('Preserved draft');
        expect(chatLoadRequests).toBe(chatLoadRequestsBeforeHome);

        await page.locator('#st-shell-rail [data-shell-route="home"]').click();
        await expect(page.locator('.welcomePanel[data-shell-preserves-chat]')).toBeVisible();
        await page.locator('#st-shell-rail [data-shell-route="chat"]').click();
        await expect(page.locator('.welcomePanel')).toHaveCount(0);
        await expect(activeMessage).toBeVisible();
        await expect(composer).toHaveValue('Preserved draft');
        expect(chatLoadRequests).toBe(chatLoadRequestsBeforeHome);
        await expect(page.locator('#chat')).toContainText('Synthetic current message');
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'chat');
        await expect(page.locator('#st-workspace-title')).toHaveText('Seraphina');
    });

    test('keeps Home open when a late chat-changed notification confirms the captured chat', async ({ page }) => {
        let holdRecentChats = false;
        let releaseRecentChats;
        let markRecentRequestStarted;
        const recentRequestStarted = new Promise(resolve => markRecentRequestStarted = resolve);
        const recentChat = [{
            file_name: 'late-chat-notification.jsonl',
            avatar: 'default_Seraphina.png',
            last_mes: '2026-08-10 @20h 38m 00s 000ms',
            mes: 'Late chat notification fixture',
            chat_items: 1,
            file_size: '1 KB',
        }];
        await mockCharacterChatPersistence(page, 'late-chat-notification');
        await page.route('**/api/chats/recent', async (route) => {
            if (holdRecentChats) {
                markRecentRequestStarted();
                await new Promise(resolve => releaseRecentChats = resolve);
            }
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(recentChat) });
        });
        await page.route('**/api/settings/save', route => route.fulfill({ status: 200, body: '{}' }));
        await page.route('**/api/chats/save', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
        await page.route('**/api/chats/get', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
                { chat_metadata: {} },
                {
                    name: 'Seraphina',
                    is_user: false,
                    is_system: false,
                    send_date: '2026-08-10 @20h 38m 00s 000ms',
                    mes: 'Late chat notification fixture',
                    extra: {},
                },
            ]),
        }));

        await page.setViewportSize({ width: 900, height: 600 });
        await page.goto('/');
        await expect(page.locator('.recentChatOpen')).toBeVisible();
        await page.locator('.recentChatOpen').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#chat')).toContainText('Late chat notification fixture');
        await expect.poll(() => page.evaluate(async () => (await import('/script.js')).getCurrentChatId())).toBe('late-chat-notification');

        holdRecentChats = true;
        await page.locator('#st-shell-rail [data-shell-route="home"]').click();
        await recentRequestStarted;
        try {
            await page.evaluate(async () => {
                const { eventSource, event_types, getCurrentChatId } = await import('/script.js');
                await eventSource.emit(event_types.CHAT_CHANGED, getCurrentChatId());
            });
        } finally {
            releaseRecentChats?.();
        }

        await expect(page.locator('.welcomePanel[data-shell-preserves-chat]')).toBeVisible();
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'home');
    });

    test('keeps recent-chat actions and keyboard opening wired to the existing flow', async ({ page }) => {
        await mockCharacterChatPersistence(page, 'synthetic-0');
        const recentChats = Array.from({ length: 4 }, (_, index) => ({
            file_name: `synthetic-${index}.jsonl`,
            avatar: 'default_Seraphina.png',
            last_mes: '2026-08-10 @20h 38m 00s 000ms',
            mes: `Synthetic recent message ${index}`,
            chat_items: index + 1,
            file_size: '1 KB',
        }));
        await page.route('**/api/chats/recent', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(recentChats),
        }));
        await page.route('**/api/settings/save', route => route.fulfill({ status: 200, body: '{}' }));
        await page.setViewportSize({ width: 900, height: 600 });
        await page.goto('/');

        await expect(page.locator('body')).toHaveClass(/st-shell-app-ready/);
        await expect(page.locator('.recentChat')).toHaveCount(4);
        await expect(page.locator('.recentChat.hidden')).toHaveCount(1);
        await page.locator('.showMoreChats').click();
        await expect(page.locator('.recentChat.hidden')).toHaveCount(0);
        await page.locator('.showMoreChats').click();
        await expect(page.locator('.recentChat.hidden')).toHaveCount(1);

        await page.locator('.recentChat').first().locator('.pinChat').click();
        await expect(page.locator('.recentChat .pinChat.active')).toHaveCount(1);
        await page.locator('.recentChat .pinChat.active').click();
        await expect(page.locator('.recentChat .pinChat.active')).toHaveCount(0);

        await page.locator('.recentChat').first().locator('.renameChat').click();
        await expect(page.locator('dialog.popup')).toBeVisible();
        await page.locator('dialog.popup .popup-button-cancel').click();
        await expect(page.locator('dialog.popup')).toBeHidden();

        await page.locator('.recentChat').first().locator('.deleteChat').click();
        await expect(page.locator('dialog.popup')).toBeVisible();
        await page.locator('dialog.popup .popup-button-cancel').click();
        await expect(page.locator('dialog.popup')).toBeHidden();

        await page.route('**/api/chats/save', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
        await page.route('**/api/chats/get', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
                { chat_metadata: {} },
                {
                    name: 'Seraphina',
                    is_user: false,
                    is_system: false,
                    send_date: '2026-08-10 @20h 38m 00s 000ms',
                    mes: 'Synthetic loaded message',
                    extra: {},
                    swipe_id: 0,
                    swipes: ['Synthetic loaded message', 'Synthetic alternate message'],
                    swipe_info: [{}, {}],
                },
            ]),
        }));
        const recentChatOpen = page.locator('.recentChat').first().locator('.recentChatOpen');
        await expect(recentChatOpen).toHaveAccessibleName(/Open chat.*Seraphina/);
        await recentChatOpen.focus();
        await expect(recentChatOpen).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.locator('.welcomePanel')).toHaveCount(0);
        await expect(page.locator('#chat')).toContainText('Synthetic loaded message');
        const loadedMessage = page.locator('#chat .mes').first();
        await loadedMessage.hover();
        await expect(loadedMessage.locator('.mes_edit')).toBeVisible();
        await loadedMessage.locator('.mes_edit').click();
        await expect(loadedMessage.locator('.mes_edit_delete')).toBeVisible();
        await loadedMessage.locator('.mes_edit_cancel').click();
        await loadedMessage.hover();
        await expect(loadedMessage.locator('.swipe_right')).toBeVisible();
        await loadedMessage.locator('.swipe_right').click();
        await expect(loadedMessage).toContainText('Synthetic alternate message');
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'chat');
        await expect(page.locator('#st-workspace-title')).toHaveText('Seraphina');

        await page.locator('#send_form').evaluate(element => element.classList.remove('no-connection'));
        await expect(page.locator('#send_but')).toBeVisible();
        await page.locator('#options_button').click();
        await expect(page.locator('#option_regenerate')).toBeVisible();
        await expect(page.locator('#option_impersonate')).toBeVisible();
        await expect(page.locator('#option_continue')).toBeVisible();
        await page.locator('#options_button').click();

        await expect(page.locator('#extensionsMenuButton')).toBeVisible();
        await page.locator('#extensionsMenuButton').click();
        await expect(page.locator('#attachFile')).toBeVisible();
        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.locator('#attachFile').click();
        await fileChooserPromise;

        await page.locator('#send_but').evaluate(element => element.style.display = 'none');
        await page.locator('#mes_stop').evaluate(element => element.style.display = 'flex');
        await expect(page.locator('#mes_stop')).toBeVisible();
        await expectVisibleInViewport(page.locator('#send_form'), { width: 900, height: 600 });

        await page.setViewportSize({ width: 1366, height: 768 });
        await page.locator('#st-shell-rail [data-shell-route="characters"]').click();
        await page.locator('#rm_button_panel_pin').evaluate((checkbox) => {
            checkbox.checked = true;
            checkbox.closest('#right-nav-panel').classList.add('pinnedOpen');
        });
        await page.locator('#st-shell-rail [data-shell-route="chat"]').click();
        await expect(page.locator('#right-nav-panel')).toHaveClass(/openDrawer.*pinnedOpen|pinnedOpen.*openDrawer/);
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'chat');
        await expect(page.locator('#st-shell-rail [data-shell-route="chat"]')).toHaveAttribute('aria-current', 'page');
        await expect(page.locator('#st-workspace-title')).toHaveText('Seraphina');
        const pinnedPanelBox = await page.locator('#right-nav-panel').boundingBox();
        const chatWorkspaceBox = await page.locator('#sheld').boundingBox();
        expect(chatWorkspaceBox.x + chatWorkspaceBox.width).toBeLessThanOrEqual(pinnedPanelBox.x + 1);

        await page.setViewportSize({ width: 900, height: 600 });
        await page.locator('#st-shell-rail [data-shell-route="chat"]').click();
        await expect(page.locator('#right-nav-panel')).not.toHaveClass(/openDrawer/);
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'chat');
        await expectVisibleInViewport(page.locator('#send_form'), { width: 900, height: 600 });
    });

    test('resynchronizes dynamically changed extension routes', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/');
        await page.evaluate(() => {
            const createDrawer = (id, title) => {
                const drawer = globalThis.document.createElement('div');
                drawer.id = id;
                drawer.className = 'drawer';
                drawer.innerHTML = `<div class="drawer-toggle"><button class="drawer-icon" title="${title}">X</button></div><div class="drawer-content closedDrawer"></div>`;
                drawer.querySelector('.drawer-icon').addEventListener('click', () => {
                    const panel = drawer.querySelector('.drawer-content');
                    panel.classList.toggle('openDrawer');
                    panel.classList.toggle('closedDrawer');
                });
                return drawer;
            };
            globalThis.document.querySelector('#top-settings-holder').append(createDrawer('changing-extension', 'Changing extension'));
        });

        await page.locator('[data-shell-action="more"]').click();
        await page.getByRole('button', { name: 'Changing extension' }).click();
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'extension');
        await page.evaluate(() => new Promise(resolve => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))));
        await page.evaluate(() => {
            const drawer = globalThis.document.createElement('div');
            drawer.id = 'later-extension';
            drawer.className = 'drawer';
            drawer.innerHTML = '<div class="drawer-toggle"><button class="drawer-icon" title="Later extension">X</button></div><div class="drawer-content closedDrawer"></div>';
            globalThis.document.querySelector('#top-settings-holder').append(drawer);
        });
        await expect(page.locator('#st-shell-extension-routes [aria-label="Later extension"]')).toHaveCount(1);
        await expect(page.locator('#st-shell-extension-routes [aria-label="Changing extension"]')).toHaveClass(/is-active/);

        await page.evaluate(() => globalThis.document.querySelector('#changing-extension').remove());
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'home');
        await expect(page.locator('#st-workspace-title')).toHaveText('Recent Chats');
    });

    test('uses a bottom dock and modal More sheet on mobile', async ({ page }) => {
        const viewport = { width: 390, height: 844 };
        await page.setViewportSize(viewport);
        await page.goto('/');

        await expect(page.locator('#st-shell-rail')).toBeHidden();
        await expect(page.locator('#st-shell-mobile-nav')).toBeVisible();
        await expectVisibleInViewport(page.locator('#send_form'), viewport);
        await expectNoHorizontalOverflow(page);

        await expectVisibleTargetsAreLargeEnough(page.locator('#st-shell-mobile-nav button'));
        const connectionChip = page.locator('.st-shell-connection-chip');
        await expect(connectionChip).toHaveAccessibleName('Not connected to API!');
        await page.locator('#send_form').evaluate(element => element.classList.remove('no-connection'));
        await expect(connectionChip).toHaveAccessibleName('Connected');
        await page.locator('#send_form').evaluate(element => element.classList.add('no-connection'));

        await page.evaluate(() => {
            const extensionButton = globalThis.document.createElement('button');
            extensionButton.id = 'test-mobile-top-bar-extension';
            extensionButton.textContent = 'Mobile legacy action';
            globalThis.document.querySelector('#top-bar').append(extensionButton);
        });
        await expect(page.locator('#top-bar')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Mobile legacy action' })).toBeVisible();
        const mobileToolbarBox = await page.locator('#top-bar').boundingBox();
        const mobileWorkspaceBox = await page.locator('#sheld').boundingBox();
        expect(Math.abs(mobileToolbarBox.y + mobileToolbarBox.height - mobileWorkspaceBox.y)).toBeLessThanOrEqual(1);
        await expectVisibleInViewport(page.locator('#send_form'), viewport);
        await page.locator('#test-mobile-top-bar-extension').evaluate(element => element.remove());
        await expect(page.locator('#top-bar')).toBeHidden();

        const moreButton = page.locator('[data-shell-action="more"]');
        await moreButton.click();
        await expect(page.locator('#st-shell-more')).toHaveAttribute('open', '');
        await expect(page.locator('#st-shell-more-close')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(page.locator('#st-shell-more')).not.toHaveAttribute('open', '');
        await expect(moreButton).toBeFocused();

        await page.evaluate(() => {
            const drawer = globalThis.document.createElement('div');
            drawer.id = 'test-extension-drawer';
            drawer.className = 'drawer';
            drawer.innerHTML = '<div class="drawer-toggle"><button class="drawer-icon" title="Test extension panel">X</button></div><div class="drawer-content closedDrawer"></div>';
            drawer.querySelector('.drawer-icon').addEventListener('click', () => {
                const panel = drawer.querySelector('.drawer-content');
                panel.classList.toggle('openDrawer');
                panel.classList.toggle('closedDrawer');
                globalThis.document.body.dataset.testExtensionOpened = 'true';
            });
            globalThis.document.querySelector('#top-settings-holder').append(drawer);
        });

        await moreButton.click();
        const immediateExtensionState = await page.getByRole('button', { name: 'Test extension panel' }).evaluate((button) => {
            button.click();
            return {
                view: globalThis.document.body.dataset.shellView,
                title: globalThis.document.querySelector('#st-workspace-title').textContent,
            };
        });
        expect(immediateExtensionState).toEqual({ view: 'extension', title: 'Test extension panel' });
        const extensionPanel = page.locator('#test-extension-drawer .drawer-content');
        await expect(page.locator('body')).toHaveAttribute('data-test-extension-opened', 'true');
        await expect(page.locator('#st-shell-more')).not.toHaveAttribute('open', '');
        await expect(extensionPanel).toHaveClass(/openDrawer/);
        await expect(page.locator('body')).toHaveAttribute('data-shell-view', 'extension');
        await expect(page.locator('#st-workspace-title')).toHaveText('Test extension panel');
        const extensionPanelBox = await extensionPanel.boundingBox();
        const extensionHeaderBox = await page.locator('#st-workspace-header').boundingBox();
        const extensionMobileNavBox = await page.locator('#st-shell-mobile-nav').boundingBox();
        expect(Math.abs(extensionPanelBox.y - (extensionHeaderBox.y + extensionHeaderBox.height))).toBeLessThanOrEqual(1);
        expect(Math.abs(extensionPanelBox.y + extensionPanelBox.height - extensionMobileNavBox.y)).toBeLessThanOrEqual(1);

        await page.locator('#st-shell-mobile-nav [data-shell-route="characters"]').click();
        await expect(extensionPanel).not.toHaveClass(/openDrawer/);
        await expect(page.locator('#right-nav-panel')).toHaveClass(/openDrawer/);
        await expectVisibleTargetsAreLargeEnough(page.locator('#right-nav-panel [role="button"]'));
        const panelBox = await page.locator('#right-nav-panel').boundingBox();
        const headerBox = await page.locator('#st-workspace-header').boundingBox();
        const mobileNavBox = await page.locator('#st-shell-mobile-nav').boundingBox();
        expect(Math.abs(panelBox.y - (headerBox.y + headerBox.height))).toBeLessThanOrEqual(1);
        expect(Math.abs(panelBox.y + panelBox.height - mobileNavBox.y)).toBeLessThanOrEqual(1);
        await expectNoHorizontalOverflow(page);

        const compactViewport = { width: 320, height: 568 };
        await page.setViewportSize(compactViewport);
        const compactPanelBox = await page.locator('#right-nav-panel').boundingBox();
        const compactHeaderBox = await page.locator('#st-workspace-header').boundingBox();
        const compactNavBox = await page.locator('#st-shell-mobile-nav').boundingBox();
        expect(Math.abs(compactPanelBox.y - (compactHeaderBox.y + compactHeaderBox.height))).toBeLessThanOrEqual(1);
        expect(Math.abs(compactPanelBox.y + compactPanelBox.height - compactNavBox.y)).toBeLessThanOrEqual(1);
        await expectNoHorizontalOverflow(page);

        await page.locator('#st-shell-mobile-nav [data-shell-route="chat"]').click();
        await expect(page.locator('#right-nav-panel')).not.toHaveClass(/openDrawer/);
        await expectVisibleInViewport(page.locator('#send_form'), compactViewport);

        await moreButton.click();
        const scrolledTop = await page.locator('#st-shell-more').evaluate((element) => {
            element.scrollTop = element.scrollHeight;
            return element.scrollTop;
        });
        expect(scrolledTop).toBeGreaterThan(0);
        await page.keyboard.press('Escape');
        await moreButton.click();
        expect(await page.locator('#st-shell-more').evaluate(element => element.scrollTop)).toBe(0);
        await page.keyboard.press('Escape');
    });

    test('mirrors the existing locale selector instead of reducing language support', async ({ page }) => {
        await page.setViewportSize({ width: 1366, height: 768 });
        await page.goto('/');

        const shellLanguage = page.locator('#st-shell-language');
        await expect(shellLanguage).toHaveValue('en');
        await expect(shellLanguage.locator('option[value="zh-cn"]')).toHaveCount(1);

        await shellLanguage.selectOption('zh-cn');
        await expect(page.locator('html')).toHaveAttribute('lang', 'zh-cn');
        await expect(page.locator('[data-shell-route="characters"]').first()).toContainText('角色');
        await expect(page.locator('.st-shell-nav-label[data-i18n="User Settings"]')).toContainText('用户设置');
        await expect(page.locator('.recentChatsSettings')).toHaveAttribute('title', '最近聊天设置');
        await expect(page.locator('#ui_language_select')).toHaveValue('zh-cn');

        await shellLanguage.selectOption('zh-tw');
        await expect(page.locator('html')).toHaveAttribute('lang', 'zh-tw');
        await expect(page.locator('#st-shell-rail [data-shell-route="backgrounds"]')).toContainText('背景');
        await page.locator('#send_form').evaluate(element => element.classList.remove('no-connection'));
        await expect(page.locator('.st-shell-connection-chip')).toHaveAccessibleName('已連線');
        await expect(page.locator('#ui_language_select')).toHaveValue('zh-tw');
        expect(await shellLanguage.locator('option').count()).toBe(await page.locator('#ui_language_select option').count());
    });
});

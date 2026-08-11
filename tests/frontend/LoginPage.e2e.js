import { test, expect } from '@playwright/test';

const PASSWORD_ACCOUNT = {
    handle: 'default-user',
    name: 'User',
    avatar: '/img/user-default.png',
    password: true,
};

/**
 * Mocks the CSRF token and account-list requests made by the login page.
 * @param {import('@playwright/test').Page} page Playwright page
 * @param {object[] | null} users Accounts to return, or null for discreet login
 */
async function mockLoginBootstrap(page, users) {
    await page.route('**/csrf-token', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'test-token' }),
    }));
    await page.route('**/api/users/list', route => {
        expect(route.request().headers()['x-csrf-token']).toBe('test-token');
        return users === null
            ? route.fulfill({ status: 204 })
            : route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(users),
            });
    });
}

test.describe('Login page', () => {
    test('supports credential errors and password recovery', async ({ page }) => {
        let recoveryBody = null;
        let recoveryCompleted = false;
        let recoveryRequests = 0;
        await mockLoginBootstrap(page, [PASSWORD_ACCOUNT]);
        await page.route('**/api/users/login', async route => {
            const error = recoveryCompleted ? 'Test login stopped after recovery' : 'Incorrect credentials';
            await route.fulfill({
                status: 403,
                contentType: 'application/json',
                body: JSON.stringify({ error }),
            });
        });
        await page.route('**/api/users/recover-step1', route => {
            recoveryRequests += 1;
            expect(route.request().headers()['x-csrf-token']).toBe('test-token');
            return recoveryRequests === 1
                ? route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'Recovery is temporarily unavailable' }),
                })
                : route.fulfill({ status: 204 });
        });
        await page.route('**/api/users/recover-step2', async route => {
            recoveryBody = await route.request().postDataJSON();
            expect(route.request().headers()['x-csrf-token']).toBe('test-token');
            recoveryCompleted = true;
            await route.fulfill({ status: 204 });
        });

        await page.goto('/login.html');

        await expect(page.locator('#loginShell')).toHaveAttribute('data-state', 'accounts');
        const accountButton = page.getByRole('button', { name: 'Sign in as User (default-user)' });
        await accountButton.focus();
        await accountButton.press('Enter');
        await expect(page.locator('#loginShell')).toHaveAttribute('data-state', 'credentials');
        await expect(page.getByLabel('Password', { exact: true })).toBeFocused();

        await page.getByLabel('Password', { exact: true }).fill('wrong-password');
        await page.getByLabel('Password', { exact: true }).press('Enter');
        await expect(page.getByRole('alert')).toHaveText('Incorrect credentials');
        await expect(page.getByRole('button', { name: /Login/ })).toBeEnabled();
        await expect(page.getByLabel('Password', { exact: true })).toBeFocused();

        await page.getByRole('button', { name: 'Forgot password?' }).click();
        await expect(page.getByRole('alert')).toHaveText('Recovery is temporarily unavailable');
        await expect(page.getByRole('button', { name: 'Forgot password?' })).toBeFocused();

        await page.getByRole('button', { name: 'Forgot password?' }).click();
        await expect(page.locator('#loginShell')).toHaveAttribute('data-state', 'recovery');
        await expect(page.getByLabel('Recovery code')).toBeFocused();
        await expect(page.locator('#recoveryName')).toHaveText('User');

        await page.getByLabel('Recovery code').fill('123456');
        await page.getByRole('button', { name: /Set new password/ }).click();
        await expect(page.getByRole('alert')).toHaveText('Test login stopped after recovery');
        expect(recoveryBody).toEqual({ handle: 'default-user', code: '123456', newPassword: '' });
        await expect(page.getByRole('button', { name: /Set new password/ })).toBeEnabled();
        await expect(page.getByRole('button', { name: /Set new password/ })).toBeFocused();

        await page.getByRole('button', { name: 'Cancel' }).click();
        await expect(page.locator('#loginShell')).toHaveAttribute('data-state', 'credentials');
        await expect(page.getByRole('button', { name: 'Forgot password?' })).toBeFocused();

        await page.setViewportSize({ width: 390, height: 844 });
        const hasHorizontalOverflow = await page.evaluate('document.documentElement.scrollWidth > window.innerWidth');
        expect(hasHorizontalOverflow).toBe(false);
    });

    test('supports discreet login without exposing an account list', async ({ page }) => {
        let loginBody = null;
        let recoveryHandle = '';
        await mockLoginBootstrap(page, null);
        await page.route('**/api/users/login', async route => {
            loginBody = await route.request().postDataJSON();
            expect(route.request().headers()['x-csrf-token']).toBe('test-token');
            await route.fulfill({
                status: 403,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Incorrect credentials' }),
            });
        });
        await page.route('**/api/users/recover-step1', async route => {
            recoveryHandle = (await route.request().postDataJSON()).handle;
            await route.fulfill({ status: 204 });
        });

        await page.goto('/login.html');

        await expect(page.locator('#loginShell')).toHaveAttribute('data-state', 'credentials');
        await expect(page.locator('#userList')).toBeEmpty();
        await expect(page.getByLabel('User handle')).toBeVisible();

        await page.getByRole('button', { name: 'Forgot password?' }).click();
        await expect(page.getByRole('alert')).toHaveText('Enter your user handle before requesting a recovery code.');

        await page.getByLabel('User handle').fill('private-user');
        await page.getByLabel('Password', { exact: true }).fill('private-password');
        await page.getByRole('button', { name: /Login/ }).click();
        await expect(page.getByRole('alert')).toHaveText('Incorrect credentials');
        expect(loginBody).toEqual({ handle: 'private-user', password: 'private-password' });
        await expect(page.getByRole('button', { name: /Login/ })).toBeFocused();

        await page.getByRole('button', { name: 'Forgot password?' }).click();
        await expect(page.locator('#loginShell')).toHaveAttribute('data-state', 'recovery');
        await expect(page.locator('#recoveryName')).toHaveText('private-user');
        expect(recoveryHandle).toBe('private-user');
    });

    test('preserves passwordless login behavior and the legacy last-account selector', async ({ page }) => {
        let loginBody = null;
        const passwordlessAccount = {
            ...PASSWORD_ACCOUNT,
            handle: 'passwordless-user',
            name: 'Passwordless User',
            password: false,
        };
        await mockLoginBootstrap(page, [PASSWORD_ACCOUNT, passwordlessAccount]);
        await page.route('**/api/users/login', async route => {
            loginBody = await route.request().postDataJSON();
            await route.fulfill({
                status: 403,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Test login stopped before navigation' }),
            });
        });

        await page.goto('/login.html');
        const lastAccount = page.locator('#userList .userSelect:last-child');
        await lastAccount.click();

        await expect(page.getByRole('alert')).toHaveText('Test login stopped before navigation');
        expect(loginBody).toEqual({ handle: 'passwordless-user', password: '' });
        await expect(lastAccount.getByRole('button')).toBeEnabled();
        await expect(lastAccount.getByRole('button')).toBeFocused();
    });

    test('preserves the query string on successful login', async ({ page }) => {
        await mockLoginBootstrap(page, [PASSWORD_ACCOUNT]);
        await page.route('**/api/users/login', async route => {
            expect(route.request().headers()['x-csrf-token']).toBe('test-token');
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ handle: 'default-user' }),
            });
        });
        await page.route('**/?theme=dark', route => route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><title>Home</title>',
        }));

        await page.goto('/login.html?noauto=1&theme=dark');
        await page.getByRole('button', { name: 'Sign in as User (default-user)' }).click();
        await page.getByLabel('Password', { exact: true }).fill('correct-password');
        await page.getByRole('button', { name: /Login/ }).click();
        await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('theme') === 'dark');

        expect(new URL(page.url()).searchParams.has('noauto')).toBe(false);
    });

    test('shows empty and bootstrap-error states', async ({ page }) => {
        await mockLoginBootstrap(page, []);
        await page.goto('/login.html');
        await expect(page.getByText('No accounts available', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Reload accounts' }).click();
        await expect(page.getByRole('button', { name: 'Reload accounts' })).toBeFocused();

        await page.unrouteAll({ behavior: 'wait' });
        await page.route('**/csrf-token', route => route.fulfill({ status: 500, body: 'Server unavailable' }));
        await page.reload();

        await expect(page.getByRole('heading', { name: 'Couldn’t load accounts' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
        await expect(page.getByRole('alert')).not.toBeEmpty();

        await page.unrouteAll({ behavior: 'wait' });
        await mockLoginBootstrap(page, [PASSWORD_ACCOUNT]);
        await page.getByRole('button', { name: 'Try again' }).click();
        await expect(page.getByRole('button', { name: 'Sign in as User (default-user)' })).toBeFocused();
    });
});

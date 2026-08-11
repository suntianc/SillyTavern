const LoginState = Object.freeze({
    LOADING: 'loading',
    ACCOUNTS: 'accounts',
    CREDENTIALS: 'credentials',
    RECOVERY: 'recovery',
});

const DEFAULT_AVATAR = 'img/user-default.png';

let csrfToken = '';
let discreetLogin = false;
let selectedUser = null;
let loadingAccounts = false;

const elements = {
    shell: document.getElementById('loginShell'),
    brandSubtitle: document.getElementById('brandSubtitle'),
    viewEyebrow: document.getElementById('viewEyebrow'),
    viewTitle: document.getElementById('viewTitle'),
    viewDescription: document.getElementById('viewDescription'),
    stageItems: [...document.querySelectorAll('.stage-item')],
    loadingView: document.getElementById('loadingView'),
    loadingIndicator: document.getElementById('loadingIndicator'),
    loadingMessage: document.getElementById('loadingMessage'),
    retryButton: document.getElementById('retryButton'),
    accountsView: document.getElementById('accountsView'),
    userList: document.getElementById('userList'),
    emptyState: document.getElementById('emptyState'),
    reloadAccountsButton: document.getElementById('reloadAccountsButton'),
    credentialsView: document.getElementById('credentialsView'),
    selectedAccount: document.getElementById('selectedAccount'),
    selectedAvatar: document.getElementById('selectedAvatar'),
    selectedName: document.getElementById('selectedName'),
    selectedHandle: document.getElementById('selectedHandle'),
    changeAccountButton: document.getElementById('changeAccountButton'),
    loginForm: document.getElementById('loginForm'),
    handleField: document.getElementById('handleField'),
    userHandle: document.getElementById('userHandle'),
    userPassword: document.getElementById('userPassword'),
    loginButton: document.getElementById('loginButton'),
    recoverPassword: document.getElementById('recoverPassword'),
    recoveryView: document.getElementById('recoveryView'),
    recoveryAvatar: document.getElementById('recoveryAvatar'),
    recoveryName: document.getElementById('recoveryName'),
    recoveryHandle: document.getElementById('recoveryHandle'),
    recoveryForm: document.getElementById('recoveryForm'),
    recoveryCode: document.getElementById('recoveryCode'),
    newPassword: document.getElementById('newPassword'),
    sendRecovery: document.getElementById('sendRecovery'),
    cancelRecovery: document.getElementById('cancelRecovery'),
    errorMessage: document.getElementById('errorMessage'),
    statusMessage: document.getElementById('statusMessage'),
};

const stateViews = new Map([
    [LoginState.LOADING, elements.loadingView],
    [LoginState.ACCOUNTS, elements.accountsView],
    [LoginState.CREDENTIALS, elements.credentialsView],
    [LoginState.RECOVERY, elements.recoveryView],
]);

/**
 * Gets a CSRF token from the server.
 * @returns {Promise<string>} CSRF token
 */
async function getCsrfToken() {
    const response = await fetch('/csrf-token');
    await ensureResponseOk(response);
    const data = await response.json();

    if (!data.token) {
        throw new Error('The server did not provide a CSRF token.');
    }

    return data.token;
}

/**
 * Gets a list of users from the server.
 * @returns {Promise<import('../../src/users.js').UserViewModel[]>} List of users
 */
async function getUserList() {
    const response = await fetch('/api/users/list', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
        },
    });

    if (response.status === 204) {
        discreetLogin = true;
        return [];
    }

    await ensureResponseOk(response);
    discreetLogin = false;
    return response.json();
}

/**
 * Requests a recovery code for a user.
 * @param {string} handle User handle
 * @returns {Promise<void>}
 */
async function sendRecoveryPart1(handle) {
    const response = await postJson('/api/users/recover-step1', { handle });
    await ensureResponseOk(response);
}

/**
 * Sets a new password using a recovery code.
 * @param {string} handle User handle
 * @param {string} code Recovery code
 * @param {string} newPassword New password
 * @returns {Promise<void>}
 */
async function sendRecoveryPart2(handle, code, newPassword) {
    const response = await postJson('/api/users/recover-step2', {
        handle,
        code,
        newPassword,
    });
    await ensureResponseOk(response);
}

/**
 * Attempts to log in a user.
 * @param {string} handle User handle
 * @param {string} password User password
 * @returns {Promise<boolean>} Whether navigation was started
 */
async function performLogin(handle, password) {
    const response = await postJson('/api/users/login', { handle, password });
    await ensureResponseOk(response);
    const data = await response.json();

    if (!data.handle) {
        throw new Error('The server returned an unexpected login response.');
    }

    redirectToHome();
    return true;
}

/**
 * Sends a JSON POST request with the current CSRF token.
 * @param {string} path Request path
 * @param {object} body Request body
 * @returns {Promise<Response>} Fetch response
 */
function postJson(path, body) {
    return fetch(path, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(body),
    });
}

/**
 * Throws a useful error when a response is not successful.
 * @param {Response} response Fetch response
 * @returns {Promise<void>}
 */
async function ensureResponseOk(response) {
    if (response.ok) {
        return;
    }

    let message = '';

    try {
        const data = await response.json();
        message = data?.error ? String(data.error) : '';
    } catch {
        // Some server errors have no JSON response body.
    }

    throw new Error(message || response.statusText || `Request failed (${response.status})`);
}

/**
 * Redirects to the home page while preserving the query string.
 */
function redirectToHome() {
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.delete('noauto');
    currentUrl.pathname = '/';
    window.location.href = currentUrl.toString();
}

/**
 * Updates the visible login view and its supporting copy.
 * @param {string} state LoginState value
 */
function setState(state) {
    elements.shell.dataset.state = state;

    for (const [viewState, view] of stateViews) {
        view.hidden = viewState !== state;
    }

    const activeStage = state === LoginState.RECOVERY
        ? 'recovery'
        : state === LoginState.CREDENTIALS
            ? 'credentials'
            : 'identity';

    for (const stageItem of elements.stageItems) {
        stageItem.classList.toggle('is-active', stageItem.dataset.stage === activeStage);
    }

    const copy = getStateCopy(state);
    elements.viewEyebrow.textContent = copy.eyebrow;
    elements.viewTitle.textContent = copy.title;
    elements.viewDescription.textContent = copy.description;
    elements.brandSubtitle.textContent = copy.brandSubtitle;
}

/**
 * Gets page copy for a login state.
 * @param {string} state LoginState value
 * @returns {{eyebrow: string, title: string, description: string, brandSubtitle: string}} State copy
 */
function getStateCopy(state) {
    if (state === LoginState.ACCOUNTS) {
        return {
            eyebrow: 'Identity',
            title: 'Select an Account',
            description: 'Choose the account you want to enter.',
            brandSubtitle: 'Select an account to continue.',
        };
    }

    if (state === LoginState.CREDENTIALS) {
        const description = discreetLogin
            ? 'Enter your handle and password.'
            : `Sign in to continue as ${selectedUser?.name || selectedUser?.handle || 'this account'}.`;

        return {
            eyebrow: 'Credentials',
            title: 'Enter Login Details',
            description,
            brandSubtitle: discreetLogin ? 'Enter your login details to continue.' : 'Your account is ready.',
        };
    }

    if (state === LoginState.RECOVERY) {
        return {
            eyebrow: 'Recovery',
            title: 'Reset Your Password',
            description: 'Use the code shown in the server console.',
            brandSubtitle: 'Return to your account securely.',
        };
    }

    return {
        eyebrow: 'Welcome',
        title: 'Preparing your accounts',
        description: 'Checking this SillyTavern instance.',
        brandSubtitle: 'Preparing your accounts.',
    };
}

/**
 * Loads the CSRF token and account list.
 * @param {boolean} focusResult Whether to focus the result of a user-initiated reload
 * @returns {Promise<void>}
 */
async function loadAccounts(focusResult = false) {
    if (loadingAccounts) {
        return;
    }

    loadingAccounts = true;
    selectedUser = null;
    displayError('');
    setLoadingView(false);
    setState(LoginState.LOADING);

    if (focusResult) {
        announce('Reloading accounts.');
    }

    try {
        csrfToken = await getCsrfToken();
        const users = await getUserList();

        if (discreetLogin) {
            configureDiscreetLogin();
        } else {
            configureNormalLogin(users);
        }

        if (focusResult) {
            announce(discreetLogin ? 'Login form ready.' : users.length > 0 ? 'Accounts reloaded.' : 'No accounts are available.');
            requestAnimationFrame(() => {
                const target = discreetLogin
                    ? elements.userHandle
                    : elements.userList.querySelector('.account-button') || elements.reloadAccountsButton;
                target.focus();
            });
        }
    } catch (error) {
        console.error('Could not load login accounts:', error);
        setLoadingView(true);
        displayError(getErrorMessage(error));

        if (focusResult) {
            requestAnimationFrame(() => elements.retryButton.focus());
        }
    } finally {
        loadingAccounts = false;
    }
}

/**
 * Configures the loading view for progress or failure.
 * @param {boolean} failed Whether loading failed
 */
function setLoadingView(failed) {
    elements.loadingIndicator.hidden = failed;
    elements.retryButton.hidden = !failed;
    elements.loadingMessage.textContent = failed
        ? 'The account list could not be loaded.'
        : 'Checking available accounts…';

    if (failed) {
        elements.viewEyebrow.textContent = 'Connection';
        elements.viewTitle.textContent = 'Couldn’t load accounts';
        elements.viewDescription.textContent = 'Check the server and try again.';
        elements.brandSubtitle.textContent = 'Check the server and try again.';
    }
}

/**
 * Configures normal account selection.
 * @param {import('../../src/users.js').UserViewModel[]} users User list
 */
function configureNormalLogin(users) {
    discreetLogin = false;
    elements.handleField.hidden = true;
    elements.userHandle.required = false;
    elements.selectedAccount.hidden = true;
    renderUserList(users);
    setState(LoginState.ACCOUNTS);

    if (users.length === 0) {
        elements.brandSubtitle.textContent = 'No enabled accounts are available.';
    }
}

/**
 * Configures login without exposing the account list.
 */
function configureDiscreetLogin() {
    discreetLogin = true;
    elements.handleField.hidden = false;
    elements.userHandle.required = true;
    elements.selectedAccount.hidden = true;
    elements.userList.replaceChildren();
    displayError('');
    setState(LoginState.CREDENTIALS);
}

/**
 * Renders available accounts as semantic buttons.
 * @param {import('../../src/users.js').UserViewModel[]} users User list
 */
function renderUserList(users) {
    elements.userList.replaceChildren();
    const hasUsers = users.length > 0;
    elements.userList.hidden = !hasUsers;
    elements.emptyState.hidden = hasUsers;

    users.forEach((user, index) => {
        const item = document.createElement('li');
        item.className = 'userSelect';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'account-button';
        button.dataset.handle = user.handle;
        button.setAttribute('aria-label', `Sign in as ${user.name || user.handle} (${user.handle})`);

        const avatar = document.createElement('img');
        avatar.src = user.avatar || DEFAULT_AVATAR;
        avatar.alt = '';
        avatar.width = 58;
        avatar.height = 58;
        avatar.decoding = 'async';
        if (index > 3) {
            avatar.loading = 'lazy';
        }
        avatar.addEventListener('error', () => useDefaultAvatar(avatar), { once: true });

        const copy = document.createElement('span');
        copy.className = 'account-copy';

        const name = document.createElement('span');
        name.className = 'account-name';
        name.textContent = user.name || user.handle;

        const handle = document.createElement('span');
        handle.className = 'account-handle';
        handle.textContent = user.handle;

        const arrow = document.createElement('span');
        arrow.className = 'account-arrow';
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = '→';

        copy.append(name, handle);
        button.append(avatar, copy, arrow);
        item.append(button);
        elements.userList.append(item);
        item.addEventListener('click', (event) => {
            if (event.target === item) {
                button.click();
            }
        });
        button.addEventListener('click', () => void onUserSelected(user, button));
    });
}

/**
 * Handles account selection and passwordless login.
 * @param {import('../../src/users.js').UserViewModel} user User account
 * @param {HTMLButtonElement} button Selected account button
 * @returns {Promise<void>}
 */
async function onUserSelected(user, button) {
    selectedUser = user;
    displayError('');

    if (!user.password) {
        setAccountListPending(button, true);
        announce(`Opening ${user.name || user.handle}.`);
        let navigating = false;

        try {
            navigating = await performLogin(user.handle, '');
        } catch (error) {
            displayError(getErrorMessage(error));
        } finally {
            if (!navigating) {
                setAccountListPending(button, false);
                restoreFocus(button);
            }
        }
        return;
    }

    updateSelectedIdentity(user);
    elements.userPassword.value = '';
    elements.selectedAccount.hidden = false;
    setState(LoginState.CREDENTIALS);
    requestAnimationFrame(() => elements.userPassword.focus());
}

/**
 * Shows the selected identity in credential and recovery views.
 * @param {{handle: string, name?: string, avatar?: string}} user Selected user
 * @param {boolean} isDiscreet Whether the account came from discreet login
 */
function updateSelectedIdentity(user, isDiscreet = false) {
    const name = user.name || user.handle;
    const secondary = isDiscreet ? 'Discreet account' : user.handle;
    const avatar = user.avatar || DEFAULT_AVATAR;

    elements.selectedName.textContent = name;
    elements.selectedHandle.textContent = secondary;
    elements.recoveryName.textContent = name;
    elements.recoveryHandle.textContent = secondary;
    setAvatar(elements.selectedAvatar, avatar);
    setAvatar(elements.recoveryAvatar, avatar);
}

/**
 * Updates an avatar with a fallback for missing images.
 * @param {HTMLImageElement} image Avatar image
 * @param {string} source Avatar URL
 */
function setAvatar(image, source) {
    image.src = source || DEFAULT_AVATAR;
    image.onerror = () => useDefaultAvatar(image);
}

/**
 * Replaces a broken avatar with the default account image.
 * @param {HTMLImageElement} image Avatar image
 */
function useDefaultAvatar(image) {
    image.onerror = null;
    image.src = DEFAULT_AVATAR;
}

/**
 * Handles submission of the credential form.
 * @param {SubmitEvent} event Form submission
 * @returns {Promise<void>}
 */
async function onLoginSubmit(event) {
    event.preventDefault();
    displayError('');

    const previousFocus = elements.loginForm.contains(document.activeElement)
        ? document.activeElement
        : elements.userPassword;
    const handle = getActiveHandle();
    if (!handle) {
        displayError('Enter your user handle.');
        elements.userHandle.focus();
        return;
    }

    setLoginPending(true);
    announce('Signing in.');
    let navigating = false;

    try {
        navigating = await performLogin(handle, elements.userPassword.value);
    } catch (error) {
        displayError(getErrorMessage(error));
    } finally {
        if (!navigating) {
            setLoginPending(false);
            restoreFocus(previousFocus);
        }
    }
}

/**
 * Requests a recovery code for the active account.
 * @returns {Promise<void>}
 */
async function onRecoverPassword() {
    displayError('');
    const previousFocus = elements.loginForm.contains(document.activeElement)
        ? document.activeElement
        : elements.recoverPassword;
    const handle = getActiveHandle();

    if (!handle) {
        displayError('Enter your user handle before requesting a recovery code.');
        elements.userHandle.focus();
        return;
    }

    setLoginPending(true, true);
    announce('Requesting a recovery code.');
    let recoveryShown = false;

    try {
        await sendRecoveryPart1(handle);
        const identity = discreetLogin
            ? { handle, name: handle, avatar: DEFAULT_AVATAR }
            : selectedUser;
        updateSelectedIdentity(identity, discreetLogin);
        setState(LoginState.RECOVERY);
        recoveryShown = true;
        announce('Recovery code requested. Check the server console.');
        requestAnimationFrame(() => elements.recoveryCode.focus());
    } catch (error) {
        displayError(getErrorMessage(error));
    } finally {
        setLoginPending(false, true);
        if (!recoveryShown) {
            restoreFocus(previousFocus);
        }
    }
}

/**
 * Submits the recovery code and new password.
 * @param {SubmitEvent} event Form submission
 * @returns {Promise<void>}
 */
async function onRecoverySubmit(event) {
    event.preventDefault();
    displayError('');
    const previousFocus = elements.recoveryForm.contains(document.activeElement)
        ? document.activeElement
        : elements.recoveryCode;
    const handle = getActiveHandle();
    const code = elements.recoveryCode.value.trim();

    if (!code) {
        displayError('Enter the recovery code from the server console.');
        elements.recoveryCode.focus();
        return;
    }

    setRecoveryPending(true);
    announce('Updating your password.');
    let navigating = false;

    try {
        await sendRecoveryPart2(handle, code, elements.newPassword.value);
        navigating = await performLogin(handle, elements.newPassword.value);
    } catch (error) {
        displayError(getErrorMessage(error));
    } finally {
        if (!navigating) {
            setRecoveryPending(false);
            restoreFocus(previousFocus);
        }
    }
}

/**
 * Returns from recovery to the credential form.
 */
function onCancelRecovery() {
    displayError('');
    setState(LoginState.CREDENTIALS);
    requestAnimationFrame(() => elements.recoverPassword.focus());
}

/**
 * Returns from credentials to account selection.
 */
function onChangeAccount() {
    if (discreetLogin) {
        return;
    }

    const previousHandle = selectedUser?.handle;
    selectedUser = null;
    elements.userPassword.value = '';
    elements.selectedAccount.hidden = true;
    displayError('');
    setState(LoginState.ACCOUNTS);

    requestAnimationFrame(() => {
        const previousButton = [...elements.userList.querySelectorAll('.account-button')]
            .find(button => button.dataset.handle === previousHandle);
        previousButton?.focus();
    });
}

/**
 * Gets the account handle for the current login mode.
 * @returns {string} Active user handle
 */
function getActiveHandle() {
    return discreetLogin
        ? elements.userHandle.value.trim()
        : selectedUser?.handle || '';
}

/**
 * Sets credential controls to pending or ready.
 * @param {boolean} pending Whether a request is pending
 * @param {boolean} requestingRecovery Whether the recovery-code request is pending
 */
function setLoginPending(pending, requestingRecovery = false) {
    for (const control of elements.loginForm.elements) {
        control.disabled = pending;
    }
    elements.changeAccountButton.disabled = pending;
    elements.loginButton.toggleAttribute('aria-busy', pending && !requestingRecovery);
    elements.recoverPassword.toggleAttribute('aria-busy', pending && requestingRecovery);
    elements.loginButton.querySelector('.button-label').textContent = pending && !requestingRecovery
        ? 'Signing in…'
        : 'Login';
    elements.recoverPassword.textContent = pending && requestingRecovery
        ? 'Requesting code…'
        : 'Forgot password?';
}

/**
 * Sets recovery controls to pending or ready.
 * @param {boolean} pending Whether a request is pending
 */
function setRecoveryPending(pending) {
    for (const control of elements.recoveryForm.elements) {
        control.disabled = pending;
    }
    elements.sendRecovery.toggleAttribute('aria-busy', pending);
    elements.sendRecovery.querySelector('.button-label').textContent = pending
        ? 'Updating password…'
        : 'Set new password';
}

/**
 * Disables account buttons during passwordless login.
 * @param {HTMLButtonElement} activeButton Active account button
 * @param {boolean} pending Whether login is pending
 */
function setAccountListPending(activeButton, pending) {
    for (const button of elements.userList.querySelectorAll('.account-button')) {
        button.disabled = pending;
        button.toggleAttribute('aria-busy', pending && button === activeButton);
    }
}

/**
 * Displays an error returned by the server or browser.
 * @param {string} message Error message
 */
function displayError(message) {
    elements.errorMessage.textContent = message;
}

/**
 * Announces a non-error status to assistive technology.
 * @param {string} message Status message
 */
function announce(message) {
    elements.statusMessage.textContent = '';
    requestAnimationFrame(() => {
        elements.statusMessage.textContent = message;
    });
}

/**
 * Restores focus after a pending control has been re-enabled.
 * @param {Element} element Control that initiated the request
 */
function restoreFocus(element) {
    requestAnimationFrame(() => element instanceof HTMLElement && element.focus());
}

/**
 * Gets a readable message from an unknown error.
 * @param {unknown} error Error value
 * @returns {string} Error message
 */
function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

elements.loginForm.addEventListener('submit', event => void onLoginSubmit(event));
elements.recoverPassword.addEventListener('click', () => void onRecoverPassword());
elements.recoveryForm.addEventListener('submit', event => void onRecoverySubmit(event));
elements.cancelRecovery.addEventListener('click', onCancelRecovery);
elements.changeAccountButton.addEventListener('click', onChangeAccount);
elements.retryButton.addEventListener('click', () => void loadAccounts(true));
elements.reloadAccountsButton.addEventListener('click', () => void loadAccounts(true));

void loadAccounts();

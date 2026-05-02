'use strict';

(function () {
  const CONFIG = window.APP_CONFIG || {};
  const allowedUsers = Array.isArray(CONFIG.allowedUsers) ? CONFIG.allowedUsers : [];
  const allowedEmailMap = new Map(
    allowedUsers
      .filter(user => user && user.email)
      .map(user => [String(user.email).trim().toLowerCase(), user.name || user.email])
  );

  let supabaseClient = null;
  let initialized = false;

  function hasConfig() {
    return Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
  }

  function ensureClient() {
    if (!hasConfig() || !window.supabase || supabaseClient) return;
    supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function isAllowedEmail(email) {
    if (!allowedEmailMap.size) return false;
    return allowedEmailMap.has(normalizeEmail(email));
  }

  function getAllowedDisplay() {
    return allowedUsers.map(user => user.name || user.email).join(', ');
  }

  function getAllowedName(email) {
    return allowedEmailMap.get(normalizeEmail(email)) || '';
  }

  function getAllowedEmails() {
    return Array.from(allowedEmailMap.keys());
  }

  async function getSession() {
    if (!supabaseClient) return null;
    const { data } = await supabaseClient.auth.getSession();
    return data.session || null;
  }

  async function getUser() {
    if (!supabaseClient) return null;
    const { data } = await supabaseClient.auth.getUser();
    return data.user || null;
  }

  async function signOutIfUnauthorized(session) {
    const email = session && session.user ? normalizeEmail(session.user.email) : '';
    if (!email || isAllowedEmail(email)) return false;
    await supabaseClient.auth.signOut();
    return true;
  }

  function emitAuthState(session, reason) {
    window.dispatchEvent(new CustomEvent('auth-state-changed', {
      detail: {
        session: session || null,
        authorized: Boolean(session && session.user && isAllowedEmail(session.user.email)),
        reason: reason || '',
      },
    }));
  }

  async function init() {
    ensureClient();
    if (!supabaseClient) {
      initialized = true;
      emitAuthState(null, 'missing-config');
      return null;
    }

    if (!initialized) {
      supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (session && await signOutIfUnauthorized(session)) {
          emitAuthState(null, 'unauthorized');
          return;
        }
        emitAuthState(session, event || 'state-change');
      });
      initialized = true;
    }

    const session = await getSession();
    if (session && await signOutIfUnauthorized(session)) {
      emitAuthState(null, 'unauthorized');
      return null;
    }
    emitAuthState(session, 'init');
    return session;
  }

  async function signInWithPassword(email, password) {
    ensureClient();
    const normalizedEmail = normalizeEmail(email);

    if (!isAllowedEmail(normalizedEmail)) {
      return { error: { message: 'This email is not approved for access.' } };
    }

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (!error && data.user && !data.user.email_confirmed_at) {
      await supabaseClient.auth.signOut();
      return { error: { message: 'This email is not verified yet. Please verify it first.' } };
    }

    if (!error && data.session && await signOutIfUnauthorized(data.session)) {
      return { error: { message: 'This account is not approved for access.' } };
    }

    return { data, error };
  }

  async function sendPasswordReset(email) {
    ensureClient();
    const normalizedEmail = normalizeEmail(email);

    if (!isAllowedEmail(normalizedEmail)) {
      return { error: { message: 'This email is not approved for access.' } };
    }

    const redirectTo = window.location.href.split('#')[0];
    return supabaseClient.auth.resetPasswordForEmail(normalizedEmail, { redirectTo });
  }

  async function updatePassword(newPassword) {
    ensureClient();
    return supabaseClient.auth.updateUser({ password: newPassword });
  }

  async function signOut() {
    if (!supabaseClient) return;
    await supabaseClient.auth.signOut();
  }

  async function getAccessToken() {
    const session = await getSession();
    return session ? session.access_token : null;
  }

  function getSupabaseClient() {
    ensureClient();
    return supabaseClient;
  }

  window.authApi = {
    init,
    hasConfig,
    getAllowedDisplay,
    getAllowedName,
    getAllowedEmails,
    isAllowedEmail,
    signInWithPassword,
    sendPasswordReset,
    updatePassword,
    signOut,
    getSession,
    getUser,
    getAccessToken,
    getSupabaseClient,
  };
})();

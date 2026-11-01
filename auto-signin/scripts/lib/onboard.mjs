export function createPlatformDraft({ id, name, startUrl }) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error('id must use lowercase letters, digits, and hyphens');
  }
  if (typeof name !== 'string' || !name.trim()) throw new Error('name is required');
  const url = new URL(startUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('startUrl must use http or https');
  const envPrefix = id.replaceAll('-', '_').toUpperCase();

  return {
    _draft: true,
    schemaVersion: 1,
    id,
    name,
    startUrl: url.href,
    allowedOrigins: [url.origin],
    session: {
      validWhen: [{ kind: 'visible', locator: [{ by: 'css', value: 'TODO_LOGGED_IN_SELECTOR' }] }],
      invalidWhen: [{ kind: 'url', matches: '/login', match: 'includes' }]
    },
    login: {
      fields: [
        { env: `${envPrefix}_USERNAME`, locator: [{ by: 'css', value: 'TODO_USERNAME_SELECTOR' }] },
        { env: `${envPrefix}_PASSWORD`, locator: [{ by: 'css', value: 'TODO_PASSWORD_SELECTOR' }] }
      ],
      submit: [{ by: 'css', value: 'TODO_LOGIN_SUBMIT_SELECTOR' }],
      challenges: []
    },
    signin: {
      action: [{ by: 'css', value: 'TODO_SIGNIN_SELECTOR' }],
      alreadyWhen: [{ kind: 'text', matches: 'TODO_ALREADY_SIGNED_TEXT', match: 'equals', locator: [{ by: 'css', value: 'TODO_STATUS_SELECTOR' }] }],
      successWhen: [{ kind: 'text', matches: 'TODO_SIGNIN_SUCCESS_TEXT', match: 'equals', locator: [{ by: 'css', value: 'TODO_STATUS_SELECTOR' }] }]
    }
  };
}

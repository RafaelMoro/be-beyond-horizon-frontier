import { renderResetPassword } from './reset-password.js';

const url = 'http://localhost:4100/reset-password/raw.one.time';

describe('renderResetPassword', () => {
  it('renders the legacy reset-password mail', async () => {
    const html = await renderResetPassword({
      url,
      firstName: 'A',
      lastName: 'B',
    });
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain('Hola <!-- -->A<!-- --> <!-- -->B');
    expect(html).toContain('Recuperar contraseña');
    expect(html).toContain(
      '<title>Reestablecer contraseña para su cuenta en Budget Master</title>',
    );
    expect(html).toMatchSnapshot();
  });

  it('escapes user-controlled names', async () => {
    const html = await renderResetPassword({
      url,
      firstName: '<b>&',
      lastName: 'B',
    });
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;&amp;');
  });
});

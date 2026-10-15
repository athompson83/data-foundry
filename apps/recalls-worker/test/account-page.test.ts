import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { ACCOUNT_JS } from '../src/account-page.js';

function browser(response: unknown, ok = true) {
  const listeners = new Map<string, (event?: unknown) => Promise<void> | void>();
  const key = { value: 'rcl_live_private_fixture' };
  const result = { textContent: '' };
  const buttons = [{ disabled: false }, { disabled: false }];
  const form = { hidden: true, querySelectorAll: () => buttons, addEventListener: (name: string, callback: () => Promise<void>) => listeners.set(name, callback) };
  const assign = vi.fn();
  const fetch = vi.fn().mockResolvedValue({ ok, json: async () => response });
  runInNewContext(ACCOUNT_JS, {
    document: { getElementById: (id: string) => ({ 'account-form': form, 'account-key': key, 'account-result': result })[id as 'account-form'] },
    window: { addEventListener: (name: string, callback: () => void) => listeners.set(name, callback), location: { assign } },
    fetch, URL,
  });
  return { key, result, buttons, form, assign, fetch, submit: (value: string) => listeners.get('submit')!({ preventDefault() {}, submitter: { value } }), leave: () => listeners.get('pagehide')!() };
}

describe('browser account controls', () => {
  it('shows exhausted usage and sends the key only in a same-origin authorization header', async () => {
    const app = browser({ plan_name: 'Evaluate', month_requests: 100, month_allowance: 100, remaining: 0 });
    await app.submit('usage');
    expect(app.form.hidden).toBe(false);
    expect(app.fetch).toHaveBeenCalledWith('/account/usage', {
      method: 'GET', headers: { authorization: 'Bearer rcl_live_private_fixture' }, cache: 'no-store', credentials: 'omit', redirect: 'error',
    });
    expect(app.result.textContent).toContain('100 of 100');
    expect(app.result.textContent).toContain('Manage billing to upgrade');
    expect(app.result.textContent).not.toContain(app.key.value);
    app.leave();
    expect(app.key.value).toBe('');
  });

  it('opens a Stripe portal without consuming a data request and clears the key before leaving', async () => {
    const app = browser({ url: 'https://billing.stripe.com/p/session/fixture' });
    await app.submit('billing');
    expect(app.fetch.mock.calls[0]?.[0]).toBe('/account/billing-portal');
    expect(app.fetch.mock.calls[0]?.[1].method).toBe('POST');
    expect(app.key.value).toBe('');
    expect(app.assign).toHaveBeenCalledWith('https://billing.stripe.com/p/session/fixture');
  });

  it.each(['https://billing.stripe.com.evil.example/steal', 'http://billing.stripe.com/session', 'https://user:pass@billing.stripe.com/session'])('refuses an unexpected portal destination: %s', async (url) => {
    const app = browser({ url });
    await app.submit('billing');
    expect(app.assign).not.toHaveBeenCalled();
    expect(app.result.textContent).toContain('Unable to open the billing portal');
    expect(app.buttons.every((button) => !button.disabled)).toBe(true);
  });

  it('shows API failures as text and leaves the controls usable', async () => {
    const app = browser({ error: { message: 'Invalid API key.' } }, false);
    await app.submit('usage');
    expect(app.result.textContent).toBe('Invalid API key.');
    expect(app.buttons.every((button) => !button.disabled)).toBe(true);
    expect(app.assign).not.toHaveBeenCalled();
  });
});

/** Browser access to the existing account API. Keys stay in memory, never in URLs or storage. */
import { layout, type PageContext } from './pages.js';

export function accountPage(ctx: PageContext): string {
  return layout(ctx, 'Usage and billing — Data Foundry', 'Check your direct API allowance and manage your subscription.', `
<p class="eyebrow">Your direct API account</p><h1>Usage and billing</h1>
<p class="lede">Check your remaining requests, or open Stripe to change your plan, payment details or cancellation settings.</p>
<form id="account-form" hidden>
<label for="account-key">Data Foundry API key</label><br>
<input id="account-key" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" required style="width:100%;max-width:540px;padding:12px;font:inherit" aria-describedby="key-note">
<p id="key-note" class="small muted">Your key is sent only to Data Foundry. It is kept in this tab and cleared when you leave; it is never saved in browser storage or added to a URL.</p>
<div class="actions"><button type="submit" value="usage">Check usage</button><button type="submit" value="billing" class="secondary">Manage billing</button></div>
</form><p id="account-result" role="status" aria-live="polite"></p>
<noscript><p>Enable JavaScript to use these controls, or use <code>GET /v1/account</code> and <code>POST /v1/account/billing-portal</code> with your key as a Bearer token. <a href="/docs">API instructions</a>.</p></noscript>
<p class="small">Already on Evaluate? Upgrade through Manage billing to keep using your existing key. Checking usage and opening the portal do not consume your request allowance.</p>
<p class="small">RapidAPI subscribers manage their subscription on <a href="https://rapidapi.com/athompson83/api/data-foundry/pricing">RapidAPI</a>. Marketplace keys do not work here.</p>
<p class="small">Lost your direct key? <a href="mailto:${ctx.supportEmail}">Contact support</a> from your billing email. Do not email your API key.</p>
<script src="/assets/account.js" defer></script>`, { path: '/account', noindex: true });
}

export const ACCOUNT_JS = `(() => {
  const form = document.getElementById('account-form');
  const key = document.getElementById('account-key');
  const result = document.getElementById('account-result');
  if (!form || !key || !result) return;
  form.hidden = false;
  let busy = false;
  window.addEventListener('pagehide', () => { key.value = ''; });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const token = key.value.trim();
    if (!token) { result.textContent = 'Enter your Data Foundry API key.'; return; }
    const billing = event.submitter && event.submitter.value === 'billing';
    busy = true;
    const buttons = form.querySelectorAll('button');
    buttons.forEach(button => { button.disabled = true; });
    result.textContent = billing ? 'Opening Stripe…' : 'Checking usage…';
    try {
      const response = await fetch(billing ? '/account/billing-portal' : '/account/usage', {
        method: billing ? 'POST' : 'GET',
        headers: { authorization: 'Bearer ' + token },
        cache: 'no-store', credentials: 'omit', redirect: 'error'
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error && data.error.message || 'Unable to access this account. Check your key or contact support.');
      if (billing) {
        const portal = new URL(data.url);
        if (portal.protocol !== 'https:' || portal.hostname !== 'billing.stripe.com' || portal.username || portal.password) throw new Error('Unable to open the billing portal. Please contact support.');
        key.value = '';
        window.location.assign(portal.href);
      } else {
        result.textContent = data.plan_name + ': ' + data.month_requests.toLocaleString('en-US') + ' of ' + data.month_allowance.toLocaleString('en-US') + ' requests used this UTC month. ' + data.remaining.toLocaleString('en-US') + ' remaining.' + (data.remaining === 0 ? ' Open Manage billing to upgrade and continue with this key.' : '');
      }
    } catch (error) {
      result.textContent = error instanceof Error ? error.message : 'Unable to reach Data Foundry. Please try again.';
    } finally {
      busy = false;
      buttons.forEach(button => { button.disabled = false; });
    }
  });
})();`;

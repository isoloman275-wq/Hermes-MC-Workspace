// Greenlight Approval Gate — frontend module (pure DOM, no three.js)
// Exposes: mountApprovalPanel, refreshApprovals, renderApprovals, resolveApproval

let REFRESH = null;

export function mountApprovalPanel() {
  const container = document.getElementById('hud-approvals-body');
  if (!container) return;

  async function refresh() {
    try {
      const r = await fetch('/api/approvals');
      const j = await r.json();
      renderApprovals(container, j.approvals || []);
    } catch (e) {
      console.error('approvals refresh failed', e);
    }
  }

  REFRESH = refresh;

  refresh();
  setInterval(refresh, 3000);
}

export function refreshApprovals() {
  if (typeof REFRESH === 'function') REFRESH();
}

export function renderApprovals(container, approvals) {
  if (!container) return;

  container.innerHTML = '';

  const pending = (approvals || []).filter(
    (a) => a && a.status === 'pending'
  );

  if (pending.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'appr-empty';
    empty.textContent = '✓ all clear — no pending greenlights';
    container.appendChild(empty);
    return;
  }

  for (const approval of pending) {
    const card = document.createElement('div');
    card.className = 'appr-card';
    card.setAttribute('data-id', approval.id);

    const top = document.createElement('div');
    top.className = 'appr-top';
    top.textContent = `⚠ GREENLIGHT · ${approval.action}`;
    card.appendChild(top);

    if (approval.detail) {
      const detail = document.createElement('div');
      detail.className = 'appr-detail';
      detail.textContent = approval.detail;
      card.appendChild(detail);
    }

    const meta = document.createElement('div');
    meta.className = 'appr-meta';
    meta.textContent = `requested by @${approval.requester} · ${approval.target || ''}`;
    card.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'appr-actions';

    const approveBtn = document.createElement('button');
    approveBtn.className = 'appr-approve';
    approveBtn.textContent = 'Approve';
    approveBtn.addEventListener('click', () => {
      resolveApproval(approval.id, 'approve');
    });

    const denyBtn = document.createElement('button');
    denyBtn.className = 'appr-deny';
    denyBtn.textContent = 'Deny';
    denyBtn.addEventListener('click', () => {
      resolveApproval(approval.id, 'deny');
    });

    actions.appendChild(approveBtn);
    actions.appendChild(denyBtn);
    card.appendChild(actions);

    container.appendChild(card);
  }
}

export async function resolveApproval(id, decision) {
  try {
    const r = await fetch('/api/approvals/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, decision, by: 'operator' }),
    });
    const j = await r.json();
    if (j.ok) {
      refreshApprovals();
    }
  } catch (e) {
    console.error('approve fail', e);
  }
}

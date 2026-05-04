const scanBtn = document.getElementById('scanBtn');
const statusEl = document.getElementById('status');
const accountSelect = document.getElementById('accountSelect');
const foldersEl = document.getElementById('folders');
const refreshFoldersBtn = document.getElementById('refreshFolders');
const selectAllBtn = document.getElementById('selectAll');
const selectNoneBtn = document.getElementById('selectNone');
let accounts = [];
let folders = [];

function setStatus(text, cls='') {
  statusEl.textContent = text;
  statusEl.className = 'status' + (cls ? ' ' + cls : '');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderAccounts() {
  if (!accounts.length) {
    accountSelect.innerHTML = '<option value="">No accounts found</option>';
    return;
  }
  accountSelect.innerHTML = accounts.map(acc => `<option value="${escapeHtml(acc.id)}">${escapeHtml(acc.name || acc.id)}</option>`).join('');
}

function renderFolders() {
  if (!folders.length) {
    foldersEl.textContent = 'No folders with messages found for this account.';
    return;
  }
  foldersEl.innerHTML = folders.map(f => {
    const label = escapeHtml(f.label);
    const value = escapeHtml(f.pathKey);
    const count = typeof f.sampleCount === 'number' ? f.sampleCount : 0;
    return `<label><input type="checkbox" class="folder" value="${value}" checked><span><div class="name">${label}</div><div class="small">Sample messages visible: ${count}</div></span></label>`;
  }).join('');
}

async function loadAccounts() {
  try {
    accounts = await browser.runtime.sendMessage({ type: 'list-accounts' });
    renderAccounts();
    setStatus(`Loaded ${accounts.length} account(s).`);
  } catch (e) {
    setStatus('Failed to load accounts: ' + (e && e.message ? e.message : String(e)), 'err');
  }
}

async function loadFolders() {
  const accountId = accountSelect.value;
  if (!accountId) {
    setStatus('No account selected.', 'err');
    return;
  }
  foldersEl.textContent = 'Loading folders...';
  try {
    folders = await browser.runtime.sendMessage({ type: 'list-folders-with-messages', accountId });
    renderFolders();
    setStatus(`Loaded ${folders.length} folder(s) with messages for the selected account.`);
  } catch (e) {
    foldersEl.textContent = 'Failed to load folders.';
    setStatus('Failed to load folders: ' + (e && e.message ? e.message : String(e)), 'err');
  }
}

refreshFoldersBtn.addEventListener('click', loadFolders);
selectAllBtn.addEventListener('click', () => document.querySelectorAll('.folder').forEach(cb => cb.checked = true));
selectNoneBtn.addEventListener('click', () => document.querySelectorAll('.folder').forEach(cb => cb.checked = false));

scanBtn.addEventListener('click', async () => {
  const accountId = accountSelect.value;
  const selectedFolders = [...document.querySelectorAll('.folder:checked')].map(el => el.value);
  if (!accountId) {
    setStatus('No account selected.', 'err');
    return;
  }
  if (!selectedFolders.length) {
    setStatus('Select at least one folder.', 'err');
    return;
  }
  scanBtn.disabled = true;
  setStatus(`Starting scan for ${selectedFolders.length} selected folder(s)...`);
  try {
    const response = await browser.runtime.sendMessage({ type: 'scan-selected-folders', accountId, folderKeys: selectedFolders });
    if (response?.ok) {
      setStatus(response.message || 'Done.', 'ok');
    } else {
      setStatus(response?.error || 'Unknown error.', 'err');
    }
  } catch (e) {
    setStatus('Extension error: ' + (e && e.message ? e.message : String(e)), 'err');
  } finally {
    scanBtn.disabled = false;
  }
});

loadAccounts();

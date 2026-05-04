const SEPARATORS = [/^--\s*$/, /^—\s*$/, /^__+$/];
const SIGNOFFS = [
  'best regards', 'kind regards', 'regards', 'sincerely', 'thanks', 'thank you',
  'cheers', 'mit freundlichen grüßen', 'mit freundlichen gruessen', 'yours truly',
  'yours sincerely', 'cordialement', 'saludos', 'grazie', 'ευχαριστώ', 'χαιρετισμούς'
];
const TITLE_HINTS = [
  'engineer','developer','manager','director','head','lead','specialist','consultant',
  'analyst','administrator','officer','founder','co-founder','ceo','cto','cfo','coo',
  'president','vice president','vp','owner','partner','associate','professor','doctor',
  'dr.','researcher','sales','marketing','support','customer success','operations',
  'hr','recruiter','attorney','lawyer','security','architect','designer','technician'
];
const SKIP_FOLDER_TYPES = new Set(['trash','junk','archives','drafts','sent','templates','outbox']);

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === 'list-accounts') return listAccounts();
  if (message?.type === 'list-folders-with-messages') return listFoldersWithMessages(message.accountId);
  if (message?.type === 'scan-selected-folders') return handleScanSelectedFolders(message.accountId, message.folderKeys || []);
});

async function listAccounts() {
  const accounts = await browser.accounts.list(false);
  return accounts.map(acc => ({ id: acc.id, name: acc.name || acc.id }));
}

async function listFoldersWithMessages(accountId) {
  const account = await browser.accounts.get(accountId, true);
  if (!account) throw new Error('Account not found.');
  const folders = flattenAccountFolders(account);
  const out = [];
  for (const folder of folders) {
    try {
      const page = await browser.messages.list(folder);
      const count = page && page.messages ? page.messages.length : 0;
      if (count > 0) {
        out.push({
          pathKey: folderKey(folder),
          label: folder.path || folder.name || 'Unnamed folder',
          sampleCount: count
        });
      }
    } catch (e) {
      console.debug('Folder probe failed', folder.name || folder.path, e);
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

async function handleScanSelectedFolders(accountId, folderKeys) {
  try {
    if (!accountId) return { ok: false, error: 'No account selected.' };
    if (!Array.isArray(folderKeys) || !folderKeys.length) return { ok: false, error: 'No folders selected.' };

    const account = await browser.accounts.get(accountId, true);
    if (!account) return { ok: false, error: 'Account not found.' };

    const allFolders = flattenAccountFolders(account);
    const wanted = new Set(folderKeys);
    const folders = allFolders.filter(f => wanted.has(folderKey(f)));
    if (!folders.length) return { ok: false, error: 'Selected folders could not be resolved.' };

    const rows = await scanFolders(folders, account.name || account.id, account.id);
    if (!rows.length) return { ok: true, message: 'Scan completed. No records found in the selected folders.' };

    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await browser.downloads.download({
      url,
      filename: `local-contact-harvester-${safeName(account.name || account.id)}-${stamp}.csv`,
      saveAs: true,
      conflictAction: 'uniquify'
    });

    const companies = new Set(rows.map(r => r.company_name)).size;
    return { ok: true, message: `Exported ${rows.length} rows across ${companies} selected folder-companies.` };
  } catch (err) {
    console.error('Harvest failed', err);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

function flattenAccountFolders(account) {
  const folders = [];
  const walk = (node) => {
    if (!node) return;
    if (!SKIP_FOLDER_TYPES.has(node.type)) folders.push(node);
    if (node.subFolders) node.subFolders.forEach(walk);
  };
  if (account.folders) account.folders.forEach(walk);
  if (account.rootFolder && account.rootFolder.subFolders) account.rootFolder.subFolders.forEach(walk);
  return dedupeFolders(folders);
}

function dedupeFolders(folders) {
  const seen = new Set();
  const out = [];
  for (const f of folders) {
    const key = folderKey(f);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

function folderKey(folder) {
  return `${folder.accountId || ''}::${folder.path || folder.name || ''}`;
}

async function scanFolders(folders, accountName, accountId) {
  const byCompanyEmail = new Map();
  for (const folder of folders) {
    let page;
    try {
      page = await browser.messages.list(folder);
    } catch (e) {
      console.debug('Skipping folder', folder.name || folder.path, e);
      continue;
    }
    while (true) {
      for (const msg of page.messages) {
        await processMessage(msg, folder, byCompanyEmail, accountName, accountId);
      }
      if (!page.id) break;
      page = await browser.messages.continueList(page.id);
    }
  }
  return Array.from(byCompanyEmail.values()).sort((a, b) => {
    return a.account_name.localeCompare(b.account_name) || a.company_name.localeCompare(b.company_name) || a.display_name.localeCompare(b.display_name) || a.email.localeCompare(b.email);
  });
}

async function processMessage(msg, folder, byCompanyEmail, accountName, accountId) {
  const parsed = parseMailbox(msg.author || '');
  if (!parsed.email) return;

  const companyName = inferCompanyName(folder);
  const key = `${accountId}\u0000${companyName}\u0000${parsed.email}`;
  const existing = byCompanyEmail.get(key) || {
    account_name: accountName || '',
    company_name: companyName,
    display_name: parsed.name || '',
    email: parsed.email,
    position: '',
    confidence: 0,
    source_folder: folder.path || folder.name || '',
    messages_seen: 0,
    signature_snippet: ''
  };

  existing.messages_seen += 1;
  if (!existing.display_name && parsed.name) existing.display_name = parsed.name;

  try {
    const full = await browser.messages.getFull(msg.id);
    const body = extractBody(full);
    const guess = inferPosition(body, parsed.name);
    if (guess.confidence > existing.confidence) {
      existing.position = guess.position;
      existing.confidence = guess.confidence;
      existing.signature_snippet = guess.snippet;
    }
  } catch (e) {
    console.debug('Body parse skipped for message', msg.id, e);
  }

  byCompanyEmail.set(key, existing);
}

function inferCompanyName(folder) {
  if (!folder) return 'Unknown';
  return (folder.name || folder.path || 'Unknown').trim();
}

function parseMailbox(input) {
  const m = input.match(/^(.*?)(?:\s*<([^>]+)>)?$/);
  if (!m) return { name: '', email: '' };
  let name = (m[1] || '').trim().replace(/^"|"$/g, '');
  let email = (m[2] || '').trim().toLowerCase();
  if (!email && /@/.test(name)) {
    email = name.toLowerCase();
    name = '';
  }
  return { name, email };
}

function extractBody(part) {
  const chunks = [];
  walkParts(part, chunks);
  return chunks.join('\n').replace(/\r/g, '\n');
}

function walkParts(part, chunks) {
  if (!part) return;
  if (part.parts && part.parts.length) {
    part.parts.forEach(p => walkParts(p, chunks));
    return;
  }
  const ct = (part.contentType || '').toLowerCase();
  if (ct.startsWith('text/plain') && part.body) chunks.push(part.body);
  if (ct.startsWith('text/html') && part.body) chunks.push(htmlToText(part.body));
}

function htmlToText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n');
}

function inferPosition(body, displayName) {
  if (!body) return { position: '', confidence: 0, snippet: '' };
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean).slice(-40);
  let sigStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (SEPARATORS.some(r => r.test(lines[i])) || SIGNOFFS.some(s => lower.includes(s))) sigStart = i;
  }
  const candidateLines = (sigStart >= 0 ? lines.slice(sigStart, sigStart + 8) : lines.slice(-8))
    .filter(l => l.length >= 2 && l.length <= 120)
    .filter(l => !/^https?:\/\//i.test(l))
    .filter(l => !/@/.test(l) || /\b(mail|email|e-mail)\b/i.test(l) === false)
    .filter(l => !/confidential|disclaimer|virus|privacy|gdpr|unsubscribe/i.test(l))
    .filter(l => !/^tel[:\s]|^mob[:\s]|^phone[:\s]|^www\./i.test(l))
    .filter(l => (l.match(/\d/g) || []).length < 6);
  let best = { position: '', confidence: 0, snippet: candidateLines.join(' | ').slice(0, 300) };
  for (const line of candidateLines) {
    const lower = line.toLowerCase();
    let score = 0;
    if (TITLE_HINTS.some(t => lower.includes(t))) score += 65;
    if (/^[A-Z][A-Za-z&\-\.,\/\s]{2,80}$/.test(line)) score += 10;
    if (/,/.test(line)) score += 5;
    if (/\b(at|@)\b/i.test(line)) score -= 20;
    if ((line.match(/[|]/g) || []).length > 2) score -= 10;
    if (displayName && lower === displayName.toLowerCase()) score -= 30;
    if (line.split(/\s+/).length > 8) score -= 20;
    if (score > best.confidence) best = { position: line, confidence: Math.max(0, Math.min(100, score)), snippet: candidateLines.join(' | ').slice(0, 300) };
  }
  return best;
}

function toCsv(rows) {
  const header = ['account_name','company_name','display_name','email','position','confidence','messages_seen','source_folder','signature_snippet'];
  return [header.join(','), ...rows.map(r => header.map(k => csvEscape(r[k] ?? '')).join(','))].join('\n');
}

function csvEscape(value) {
  const s = String(value).replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

function safeName(v) {
  return String(v).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'account';
}

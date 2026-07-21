// Shared GitHub-Contents-API helpers + auth for the serverless admin.
// The admin writes the archive by COMMITTING to this repo (content.json + images/), which the deploy
// then rebuilds — so there is no server holding files, and the storage is the repo itself. A file that
// starts with "_" is not routed as an endpoint by Vercel, so this stays a plain module.

const REPO = process.env.GH_REPO || 'codename-2501/mommy';   // owner/name the admin commits to
const BRANCH = process.env.GH_BRANCH || 'main';
const TOKEN = process.env.GH_TOKEN;                          // fine-grained PAT, Contents: read+write
const API = 'https://api.github.com';

function headers() {
  return {
    Authorization: 'Bearer ' + TOKEN,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'lse-admin',
  };
}

// GET a file's metadata+content (base64). 404 is a normal answer (file absent) — callers check r.status.
async function ghGet(path) {
  return fetch(`${API}/repos/${REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${BRANCH}`, { headers: headers() });
}

// Create or update a file. Pass sha to update (and to hold the optimistic lock — a stale sha 409s).
async function ghPut(path, contentB64, message, sha) {
  const body = { message, content: contentB64, branch: BRANCH };
  if (sha) body.sha = sha;
  return fetch(`${API}/repos/${REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
    method: 'PUT', headers: headers(), body: JSON.stringify(body),
  });
}

// list commits touching a path (newest first), one page of up to 100. Used to date the image library:
// every upload commits "image: <name> 업로드", so the messages carry the filename and the commit its date.
async function ghCommits(pathPrefix, page) {
  return fetch(`${API}/repos/${REPO}/commits?sha=${BRANCH}&path=${encodeURIComponent(pathPrefix)}&per_page=100&page=${page || 1}`, { headers: headers() });
}

async function ghDelete(path, message, sha) {
  return fetch(`${API}/repos/${REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
    method: 'DELETE', headers: headers(), body: JSON.stringify({ message, sha, branch: BRANCH }),
  });
}

// Editing needs the key. It arrives as the X-Admin-Key header; compared to ADMIN_KEY in near-constant
// time so the comparison does not leak how much of a guess was right. No key set = admin is off.
function authed(req) {
  const key = process.env.ADMIN_KEY;
  if (!key) return false;
  const offered = String((req.headers && (req.headers['x-admin-key'] || req.headers['X-Admin-Key'])) || '');
  if (offered.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= offered.charCodeAt(i) ^ key.charCodeAt(i);
  return diff === 0;
}

function need(res) {
  return res.status(403).json({ error: 'read-only' });
}

module.exports = { REPO, BRANCH, API, ghGet, ghPut, ghDelete, ghCommits, authed, need };

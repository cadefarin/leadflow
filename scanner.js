const axios = require('axios');

const TG_TOKEN = '8616974859:AAGhIY-3DFPPk5SSZKAVmx0766-_OyLSzyo';
const TG_CHAT  = '-1003814127256';
const SUPA_URL = 'https://bccipmyungoureqjiuhv.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjY2lwbXl1bmdvdXJlcWppdWh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5NzM2MDMsImV4cCI6MjA5NDU0OTYwM30.NxDa-Yw59h31FhU0U7gEJ0PWCMkojs2x0tols8zLitk';

const seen = new Set();
const tgQueue = [];
let tgRunning = false;

// ── Rate-limited Telegram queue (1.5s between messages) ──
async function sendTelegram(msg) {
  return new Promise((resolve) => {
    tgQueue.push({ msg, resolve });
    if (!tgRunning) processTgQueue();
  });
}

async function processTgQueue() {
  tgRunning = true;
  while (tgQueue.length) {
    const { msg, resolve } = tgQueue.shift();
    let sent = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
          chat_id: TG_CHAT, text: msg, parse_mode: 'HTML'
        });
        console.log('✅ TG sent');
        sent = true;
        break;
      } catch(e) {
        const wait = e.response?.status === 429 ? 5000 : 2000;
        console.error(`TG attempt ${attempt+1} failed (${e.response?.status||e.message}), retrying in ${wait/1000}s`);
        await sleep(wait);
      }
    }
    if (!sent) console.error('TG: gave up after 3 attempts');
    resolve();
    await sleep(1500);
  }
  tgRunning = false;
}

// ── Push lead to Supabase ────────────────────────────────
async function pushLead(lead) {
  try {
    await axios.post(
      `${SUPA_URL}/rest/v1/leads`,
      lead,
      {
        headers: {
          'apikey': SUPA_KEY,
          'Authorization': `Bearer ${SUPA_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        }
      }
    );
    console.log(`📲 Lead saved: ${lead.name}`);
  } catch(e) {
    console.error('Supabase push failed:', e.response?.data || e.message);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function uid() { return Math.random().toString(36).slice(2, 9); }

function scoreRedditPost(title, body, keywords) {
  const text = (title + ' ' + body).toLowerCase();
  let score = 60;
  const matches = keywords.filter(k => text.includes(k)).length;
  score += matches * 8;
  if (text.includes('help') || text.includes('need')) score += 5;
  if (text.includes('asap') || text.includes('urgent')) score += 10;
  if (text.includes('quote') || text.includes('estimate')) score += 10;
  if (text.includes('california') || text.includes('socal') || text.includes('orange county')) score += 8;
  return Math.min(score, 99);
}

// ── PEST CONTROL — Reddit (OC focused) ──────────────────
async function scanPest() {
  console.log('\n🐛 Scanning pest leads...');
  const kw = [
    'pest control','exterminator','roach','cockroach','ant infestation',
    'bed bug','termite','rat problem','mice problem','mouse problem',
    'wasp nest','spider infestation','how to get rid of bugs',
    'pest problem','bug problem','infestation','getting rid of'
  ];
  const sources = [
    'https://www.reddit.com/r/pestcontrol/new.json?limit=25',
    'https://www.reddit.com/r/homeowners/new.json?limit=25',
    'https://www.reddit.com/r/HomeImprovement/new.json?limit=25',
    'https://www.reddit.com/r/orangecounty/new.json?limit=25',
    'https://www.reddit.com/r/socal/new.json?limit=25',
  ];

  for (const url of sources) {
    try {
      const res = await axios.get(url, {
        headers: { 'User-Agent': 'LeadScanner/1.0 (by /u/joltpoker)' },
        timeout: 10000
      });
      const posts = res.data?.data?.children || [];
      for (const post of posts) {
        const d = post.data;
        const id = 'pest_' + d.id;
        if (seen.has(id)) continue;
        const title = d.title || '';
        const body = d.selftext || '';
        const text = (title + ' ' + body).toLowerCase();
        if (!kw.some(k => text.includes(k))) continue;
        // Skip if just asking for advice with no urgency
        const hasUrgency = ['help','need','asap','urgent','bad','terrible','everywhere','taking over'].some(u => text.includes(u));
        if (!hasUrgency && !text.includes('quote') && !text.includes('hire')) continue;
        seen.add(id);
        const score = scoreRedditPost(title, body, kw);
        const age = Math.floor((Date.now() - d.created_utc * 1000) / 60000);
        const snippet = body.slice(0, 120).trim() || title;
        const link = `https://reddit.com${d.permalink}`;

        await sendTelegram(
          `🐛 <b>PEST CONTROL LEAD</b>\n\n` +
          `📍 r/${d.subreddit} · ${age}m ago\n` +
          `📝 <b>${title.slice(0,80)}</b>\n` +
          `👤 u/${d.author}\n` +
          `🔗 ${link}\n\n` +
          `💬 "${snippet}..."\n` +
          `🎯 Score: ${score}/99`
        );

        await pushLead({
          id: uid(), name: `u/${d.author}`, phone: '',
          ind: 'pest', src: `Reddit r/${d.subreddit}`,
          st: 'new', score, quote: `"${snippet}"`, added: Date.now()
        });
        console.log(`🐛 PEST: ${title.slice(0,60)}`);
      }
      await sleep(2000);
    } catch(e) { console.error('Pest scan error:', e.message); }
  }
}

// ── SOLAR — Reddit + Craigslist SoCal ───────────────────
async function scanSolar() {
  console.log('\n☀️  Scanning solar leads...');
  const kw = [
    'want solar','need solar','thinking about solar','considering solar',
    'solar quote','solar estimate','high electric bill','electric bill too high',
    'sce bill','edison bill','sdge bill','is solar worth it','should i get solar',
    'solar panels cost','go solar','solar installation','switch to solar',
    'lower my electric bill','utility bill killing me'
  ];
  const sources = [
    'https://www.reddit.com/r/solar/new.json?limit=25',
    'https://www.reddit.com/r/homeowners/new.json?limit=25',
    'https://www.reddit.com/r/PersonalFinanceCA/new.json?limit=25',
    'https://www.reddit.com/r/LosAngeles/new.json?limit=25',
    'https://www.reddit.com/r/sandiego/new.json?limit=25',
    'https://www.reddit.com/r/orangecounty/new.json?limit=25',
  ];

  for (const url of sources) {
    try {
      const res = await axios.get(url, {
        headers: { 'User-Agent': 'LeadScanner/1.0 (by /u/joltpoker)' },
        timeout: 10000
      });
      const posts = res.data?.data?.children || [];
      for (const post of posts) {
        const d = post.data;
        const id = 'sol_' + d.id;
        if (seen.has(id)) continue;
        const title = d.title || '';
        const body = d.selftext || '';
        const text = (title + ' ' + body).toLowerCase();
        if (!kw.some(k => text.includes(k))) continue;
        seen.add(id);
        const score = scoreRedditPost(title, body, kw);
        const age = Math.floor((Date.now() - d.created_utc * 1000) / 60000);
        const snippet = body.slice(0, 120).trim() || title;
        const link = `https://reddit.com${d.permalink}`;

        await sendTelegram(
          `☀️ <b>SOLAR LEAD</b>\n\n` +
          `📍 r/${d.subreddit} · ${age}m ago\n` +
          `📝 <b>${title.slice(0,80)}</b>\n` +
          `👤 u/${d.author}\n` +
          `🔗 ${link}\n\n` +
          `💬 "${snippet}..."\n` +
          `🎯 Score: ${score}/99`
        );

        await pushLead({
          id: uid(), name: `u/${d.author}`, phone: '',
          ind: 'solar', src: `Reddit r/${d.subreddit}`,
          st: 'new', score, quote: `"${snippet}"`, added: Date.now()
        });
        console.log(`☀️  SOLAR: ${title.slice(0,60)}`);
      }
      await sleep(2000);
    } catch(e) { console.error('Solar scan error:', e.message); }
  }
}

// ── POKER — Reddit ───────────────────────────────────────
async function scanPoker() {
  console.log('\n🃏 Scanning poker leads...');
  const kw = [
    'looking for poker club','join a club','clubgg','real money poker',
    'play from home','home game online','poker from anywhere',
    'online poker app','best poker app','private poker','poker club',
    'real money online poker','mobile poker'
  ];
  const sources = [
    'https://www.reddit.com/r/poker/new.json?limit=25',
    'https://www.reddit.com/r/onlinepoker/new.json?limit=25',
    'https://www.reddit.com/r/gambling/new.json?limit=25',
    'https://www.reddit.com/r/CaliforniaGambling/new.json?limit=10',
  ];

  for (const url of sources) {
    try {
      const res = await axios.get(url, {
        headers: { 'User-Agent': 'LeadScanner/1.0 (by /u/joltpoker)' },
        timeout: 10000
      });
      const posts = res.data?.data?.children || [];
      for (const post of posts) {
        const d = post.data;
        const id = 'poker_' + d.id;
        if (seen.has(id)) continue;
        const title = d.title || '';
        const body = d.selftext || '';
        const text = (title + ' ' + body).toLowerCase();
        if (!kw.some(k => text.includes(k))) continue;
        seen.add(id);
        const score = scoreRedditPost(title, body, kw);
        const age = Math.floor((Date.now() - d.created_utc * 1000) / 60000);
        const snippet = body.slice(0, 120).trim() || title;
        const link = `https://reddit.com${d.permalink}`;

        await sendTelegram(
          `🃏 <b>POKER LEAD</b>\n\n` +
          `📍 r/${d.subreddit} · ${age}m ago\n` +
          `📝 <b>${title.slice(0,80)}</b>\n` +
          `👤 u/${d.author}\n` +
          `🔗 ${link}\n\n` +
          `💬 "${snippet}..."\n` +
          `🎯 Score: ${score}/99`
        );

        await pushLead({
          id: uid(), name: `u/${d.author}`, phone: '',
          ind: 'poker', src: `Reddit r/${d.subreddit}`,
          st: 'new', score, quote: `"${snippet}"`, added: Date.now()
        });
        console.log(`🃏 POKER: ${title.slice(0,60)}`);
      }
      await sleep(2000);
    } catch(e) { console.error('Poker scan error:', e.message); }
  }
}

// ── Main loop ────────────────────────────────────────────
async function scan() {
  console.log(`\n🔍 Scan started ${new Date().toLocaleTimeString()}`);
  await scanPest();
  await scanSolar();
  await scanPoker();
  console.log(`✅ Scan complete ${new Date().toLocaleTimeString()}`);
}

console.log('🚀 LeadFlow Scanner running');
console.log('🐛 Pest (OC) · ☀️ Solar (SoCal) · 🃏 Poker (US)');
console.log('📲 Pushing to Supabase + Telegram\n');
scan();
setInterval(scan, 30 * 60 * 1000);

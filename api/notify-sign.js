// Vercel Serverless Function：業主回簽後寄 Email 通知設計師
// 安全做法：用業主自己的登入憑證去讀取「回簽紀錄」，讀得到才代表回簽是真的
// （Firestore 規則會把關），所以不需要額外的後端密鑰，也不接受前端指定收件人。

const PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID;
const DOC_BASE =
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
  `/databases/(default)/documents/artifacts/a41-design/public/data/projects`;

const SECTION_LABEL = { meetings: '會議記錄', drawings: '設計圖說', logs: '監工日誌' };

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function readDoc(url, idToken) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
  if (!r.ok) return null;
  return r.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  try {
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const { projectId, itemId } = req.body || {};
    const idOk = (s) => typeof s === 'string' && /^[\w-]{1,100}$/.test(s);
    if (!idToken || !idOk(projectId) || !idOk(itemId)) {
      return res.status(400).json({ error: 'bad request' });
    }

    // 1) 以業主身分讀取回簽紀錄（沒有權限或不存在就會失敗）
    const sig = await readDoc(`${DOC_BASE}/${projectId}/signatures/${itemId}`, idToken);
    if (!sig?.fields?.signedAt?.timestampValue) {
      return res.status(403).json({ error: 'signature not found' });
    }
    const signedAt = new Date(sig.fields.signedAt.timestampValue);
    if (Date.now() - signedAt.getTime() > 10 * 60 * 1000) {
      return res.status(400).json({ error: 'signature too old' });
    }

    // 2) 讀取專案名稱與項目標題
    const proj = await readDoc(`${DOC_BASE}/${projectId}`, idToken);
    if (!proj?.fields) return res.status(403).json({ error: 'project not accessible' });

    const projectName = proj.fields.name?.stringValue || '(未命名專案)';
    const clientName = proj.fields.clientName?.stringValue || '';
    let itemTitle = '(未知項目)';
    let section = '';
    for (const key of Object.keys(SECTION_LABEL)) {
      const values = proj.fields[key]?.arrayValue?.values || [];
      const hit = values.find((v) => v.mapValue?.fields?.id?.stringValue === itemId);
      if (hit) {
        itemTitle = hit.mapValue.fields.title?.stringValue || itemTitle;
        section = SECTION_LABEL[key];
        break;
      }
    }

    const signedBy = sig.fields.signedByName?.stringValue || sig.fields.signedByEmail?.stringValue || clientName;
    const signedEmail = sig.fields.signedByEmail?.stringValue || '';
    const when = signedAt.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
    const siteUrl = process.env.SITE_URL || 'https://a41-app.vercel.app';

    // 3) 寄信給設計師（收件人只來自伺服器環境變數）
    const apiKey = process.env.RESEND_API_KEY;
    const to = process.env.NOTIFY_EMAIL;
    if (!apiKey || !to) return res.status(500).json({ error: 'email not configured' });

    const mail = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        // 同一個項目重複呼叫只會寄一封
        'Idempotency-Key': `sign-${projectId}-${itemId}`,
      },
      body: JSON.stringify({
        from: process.env.NOTIFY_FROM || 'A41 回簽通知 <onboarding@resend.dev>',
        to: [to],
        subject: `【A41】${projectName}｜業主已回簽：${itemTitle}`,
        html: `
          <div style="font-family:Arial,'Microsoft JhengHei',sans-serif;max-width:520px;margin:auto;color:#333">
            <div style="background:#004A60;color:#F8BB72;padding:16px 20px;border-radius:12px 12px 0 0;font-weight:bold;font-size:18px">A41 肆合設計｜業主回簽通知</div>
            <div style="border:1px solid #eee;border-top:none;padding:20px;border-radius:0 0 12px 12px">
              <p><b>專案：</b>${esc(projectName)}</p>
              <p><b>項目：</b>${esc(itemTitle)}${section ? `（${esc(section)}）` : ''}</p>
              <p><b>回簽人：</b>${esc(signedBy)}${signedEmail ? `（${esc(signedEmail)}）` : ''}</p>
              <p><b>回簽時間：</b>${esc(when)}</p>
              <p style="margin-top:24px"><a href="${esc(siteUrl)}" style="background:#F8BB72;color:#004A60;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">前往後台查看</a></p>
            </div>
          </div>`,
      }),
    });

    if (!mail.ok) {
      console.error('resend error:', mail.status, await mail.text());
      return res.status(502).json({ error: 'email failed' });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
}

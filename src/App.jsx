import React, { useState, useEffect } from 'react';
import {
  Lock, User, Phone, Mail, FileText, Calendar, Camera, Map,
  CheckCircle, LogOut, Plus, Link as LinkIcon, FolderLock, FolderOpen,
  PenTool, AlertCircle, X, Check, Paperclip, Pencil, Menu
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from 'firebase/auth';
import {
  getFirestore, collection, query, where, orderBy, onSnapshot,
  doc, setDoc, updateDoc, deleteDoc, getDocs, serverTimestamp
} from 'firebase/firestore';
import {
  getStorage, ref as sRef, uploadBytesResumable, getDownloadURL,
  deleteObject, listAll
} from 'firebase/storage';

// ============================================================
// 1. Firebase 設定（請在 .env 與 Vercel 環境變數中設定）
// ============================================================
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const PROJECTS_PATH = ['artifacts', 'a41-design', 'public', 'data', 'projects'];
const projectsCol = () => collection(db, ...PROJECTS_PATH);
const projectRef = (id) => doc(db, ...PROJECTS_PATH, id);
const sigCol = (id) => collection(db, ...PROJECTS_PATH, id, 'signatures');

const MAX_FILE_MB = 50;

// ============================================================
// 2. 共用小工具
// ============================================================
const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const fmtTs = (ts) => {
  if (!ts) return '處理中...';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((b || 0) / 1024))} KB`);
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const isSafeUrl = (s) => /^https?:\/\//i.test(s);
// 舊資料沒有 kind 欄位，視為連結
const itemKind = (item) => item.kind || (item.filePath ? 'file' : 'link');

// 開啟 Storage 檔案：先同步開空白分頁（避免被手機瀏覽器擋彈窗），取得網址後再導向
async function openStoredFile(path, showToast) {
  const w = window.open('', '_blank');
  try {
    const url = await getDownloadURL(sRef(storage, path));
    if (w) w.location.href = url; else window.location.href = url;
  } catch (err) {
    console.error(err);
    if (w) w.close();
    showToast('無法開啟檔案，請稍後再試。');
  }
}

async function removeStoredFile(path) {
  try { await deleteObject(sRef(storage, path)); }
  catch (err) { console.warn('delete file failed:', err); }
}

function uploadFile(projectId, itemId, file, onProgress) {
  return new Promise((resolve, reject) => {
    const safe = file.name.replace(/[^\w.\-\u4e00-\u9fff]+/g, '_');
    const path = `projects/${projectId}/${itemId}_${safe}`;
    const task = uploadBytesResumable(sRef(storage, path), file);
    task.on(
      'state_changed',
      (s) => onProgress(Math.round((s.bytesTransferred / s.totalBytes) * 100)),
      reject,
      () => resolve({ filePath: path, fileName: file.name, fileSize: file.size })
    );
  });
}

function useSignatures(projectId) {
  const [sigs, setSigs] = useState({});
  useEffect(() => {
    setSigs({});
    if (!projectId) return;
    const unsub = onSnapshot(
      sigCol(projectId),
      (snap) => {
        const map = {};
        snap.docs.forEach(d => { map[d.id] = d.data(); });
        setSigs(map);
      },
      (err) => console.error('signatures listen error:', err)
    );
    return () => unsub();
  }, [projectId]);
  return sigs;
}

// ============================================================
// 3. 共用 UI 元件（定義在 App 外部，避免輸入框每打一字就失焦）
// ============================================================
const inputCls = 'w-full p-3 border rounded-lg focus:ring-2 focus:ring-[#004A60] outline-none';
const primaryBtn = 'bg-[#004A60] text-[#F8BB72]';

function ModalShell({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden max-h-[92vh] overflow-y-auto">
        <div className="p-4 border-b flex justify-between items-center bg-[#004A60]">
          <h3 className="font-bold text-lg text-[#F8BB72]">{title}</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="p-6 bg-gray-50">{children}</div>
      </div>
    </div>
  );
}

function ConfirmModal({ message, danger, onConfirm, onClose }) {
  return (
    <ModalShell title="系統確認" onClose={onClose}>
      <div className="text-center py-4">
        <p className="text-lg text-gray-700 mb-6">{message}</p>
        <div className="flex gap-4">
          <button onClick={onClose} className="flex-1 py-3 bg-gray-200 text-gray-800 rounded-lg font-bold hover:bg-gray-300">取消</button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-3 text-white rounded-lg font-bold ${danger ? 'bg-red-500 hover:bg-red-600' : 'bg-[#004A60]'}`}
          >確認執行</button>
        </div>
      </div>
    </ModalShell>
  );
}

// 新增 / 編輯專案資料
function ProjectFormModal({ initial, onSubmit, onClose }) {
  const [name, setName] = useState(initial?.name || '');
  const [clientName, setClientName] = useState(initial?.clientName || '');
  const [clientEmail, setClientEmail] = useState(initial?.clientEmail || '');
  const [clientPhone, setClientPhone] = useState(initial?.clientPhone || '');
  const [err, setErr] = useState('');

  const submit = () => {
    if (!name.trim() || !clientName.trim()) return setErr('請填寫專案名稱與業主姓名');
    if (!isEmail(clientEmail.trim())) return setErr('請輸入正確的業主 Google 帳號 Email');
    onSubmit({
      name: name.trim(),
      clientName: clientName.trim(),
      clientEmail: clientEmail.trim().toLowerCase(),
      clientPhone: clientPhone.trim(),
    });
  };

  return (
    <ModalShell title={initial ? '✏️ 編輯專案資料' : '✨ 新增專案'} onClose={onClose}>
      <div className="space-y-4">
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1">專案名稱</label>
          <input className={inputCls} placeholder="例如：信義區王公館" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1">業主姓名</label>
          <input className={inputCls} value={clientName} onChange={e => setClientName(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1">業主 Google 帳號 (Email)</label>
          <input type="email" className={inputCls} placeholder="xxx@gmail.com" value={clientEmail} onChange={e => setClientEmail(e.target.value)} />
          <p className="text-xs text-gray-400 mt-1">業主需使用此 Google 帳號登入才能看到專案{initial ? '；修改後舊帳號將無法再檢視' : ''}</p>
        </div>
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1">聯絡電話（選填，僅供設計師備註）</label>
          <input type="tel" className={inputCls} value={clientPhone} onChange={e => setClientPhone(e.target.value)} />
        </div>
        <button onClick={submit} className={`w-full py-3 rounded-lg font-bold mt-2 shadow-md ${primaryBtn}`}>
          {initial ? '儲存變更' : '建立專案'}
        </button>
      </div>
    </ModalShell>
  );
}

// 新增 / 編輯檔案項目：NAS 連結 或 上傳檔案
function ItemFormModal({ initial, onSubmit, onClose }) {
  const hadFile = !!initial && itemKind(initial) === 'file';
  const [title, setTitle] = useState(initial?.title || '');
  const [kind, setKind] = useState(initial ? itemKind(initial) : 'link');
  const [link, setLink] = useState(initial?.nasLink || '');
  const [file, setFile] = useState(null);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);

  const submit = async () => {
    if (!title.trim()) return setErr('請輸入標題');
    if (kind === 'link' && !isSafeUrl(link.trim())) return setErr('連結必須以 http:// 或 https:// 開頭');
    if (kind === 'file') {
      if (!file && !hadFile) return setErr('請選擇要上傳的檔案');
      if (file && file.size > MAX_FILE_MB * 1024 * 1024) return setErr(`檔案不可超過 ${MAX_FILE_MB} MB`);
    }
    setErr(''); setSaving(true);
    try {
      await onSubmit({ title: title.trim(), kind, nasLink: link.trim(), file }, setProgress);
    } catch (e) {
      console.error(e);
      setErr(e?.code?.startsWith('storage/')
        ? '上傳失敗：尚未啟用 Storage，或沒有上傳權限。'
        : '儲存失敗，請稍後再試。');
      setSaving(false);
    }
  };

  const tabCls = (active) =>
    `flex-1 py-2 rounded-lg text-sm font-bold transition-all ${active ? 'bg-[#004A60] text-[#F8BB72] shadow' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`;

  return (
    <ModalShell title={initial ? '✏️ 編輯項目' : '📄 新增檔案'} onClose={saving ? () => {} : onClose}>
      <div className="space-y-4">
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1">標題</label>
          <input className={inputCls} placeholder="例如：平面配置圖 V2" value={title} onChange={e => setTitle(e.target.value)} disabled={saving} />
        </div>

        <div className="flex gap-2">
          <button type="button" className={tabCls(kind === 'link')} onClick={() => setKind('link')} disabled={saving}>NAS 分享連結</button>
          <button type="button" className={tabCls(kind === 'file')} onClick={() => setKind('file')} disabled={saving}>上傳檔案</button>
        </div>

        {kind === 'link' ? (
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">NAS 分享連結 (URL)</label>
            <input className={inputCls} placeholder="https://..." value={link} onChange={e => setLink(e.target.value)} disabled={saving} />
          </div>
        ) : (
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">選擇檔案（上限 {MAX_FILE_MB} MB）</label>
            <input type="file" className="w-full text-sm" onChange={e => setFile(e.target.files?.[0] || null)} disabled={saving} />
            {hadFile && !file && (
              <p className="text-xs text-gray-500 mt-2">目前檔案：{initial.fileName}（不選擇新檔案則保留）</p>
            )}
          </div>
        )}

        {saving && kind === 'file' && file && (
          <div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-[#F8BB72] transition-all" style={{ width: `${progress}%` }}></div>
            </div>
            <p className="text-xs text-gray-500 mt-1 text-center">上傳中 {progress}%，請勿關閉視窗</p>
          </div>
        )}

        <button onClick={submit} disabled={saving} className={`w-full py-3 rounded-lg font-bold mt-2 shadow-md ${primaryBtn} disabled:opacity-50`}>
          {saving ? '處理中...' : initial ? '儲存變更' : '確認新增'}
        </button>
      </div>
    </ModalShell>
  );
}

// 依項目類型顯示「開啟連結」或「開啟檔案」
function ItemOpenButton({ item, showToast, className, label }) {
  if (itemKind(item) === 'file') {
    return (
      <button type="button" onClick={() => openStoredFile(item.filePath, showToast)} className={className}>
        <Paperclip className="w-4 h-4 mr-2 flex-shrink-0" /> {label}
      </button>
    );
  }
  if (!isSafeUrl(item.nasLink)) return null;
  return (
    <a href={item.nasLink} target="_blank" rel="noopener noreferrer" className={className}>
      <LinkIcon className="w-4 h-4 mr-2 flex-shrink-0" /> {label}
    </a>
  );
}

function AppLayout({ sidebar, footerLabel, onLogout, toast, children, mobileTitle, drawer, drawerOpen, setDrawerOpen, bottomNav }) {
  const logo = (
    <div>
      <h2 className="font-black text-2xl tracking-wider text-[#F8BB72] leading-none">A41</h2>
      <p className="text-xs text-white/60 tracking-widest mt-1">肆合設計</p>
    </div>
  );
  const footer = (
    <div className="p-4 border-t border-white/10 bg-black/20 text-xs text-gray-300 flex items-center justify-between gap-2">
      <span className="truncate">{footerLabel}</span>
      <span className="flex items-center flex-shrink-0"><span className="w-2 h-2 rounded-full bg-green-400 mr-2"></span>連線中</span>
    </div>
  );
  return (
    <div className="min-h-screen bg-gray-100 md:flex font-sans">
      {/* 桌機：左側固定側邊欄 */}
      <aside className="hidden md:flex md:w-72 md:flex-shrink-0 bg-[#004A60] text-white flex-col shadow-2xl z-10 md:h-screen md:sticky md:top-0">
        <div className="p-6 flex items-center justify-between border-b border-white/10">
          {logo}
          <button onClick={onLogout} className="p-2 bg-white/5 hover:bg-red-500 transition-colors rounded-lg group" title="登出">
            <LogOut className="w-5 h-5 text-white/70 group-hover:text-white" />
          </button>
        </div>
        <div className="p-4 flex-1 overflow-y-auto space-y-2">{sidebar}</div>
        {footer}
      </aside>

      {/* 手機：頂部列 */}
      <header
        className="md:hidden sticky top-0 z-30 bg-[#004A60] text-white flex items-center gap-3 px-3 pb-2.5 shadow-lg"
        style={{ paddingTop: 'max(0.625rem, env(safe-area-inset-top, 0px))' }}
      >
        {drawer && (
          <button onClick={() => setDrawerOpen(true)} className="p-2.5 rounded-lg bg-white/10 active:bg-white/20" aria-label="開啟專案選單">
            <Menu className="w-5 h-5" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[#F8BB72] font-black tracking-wider text-sm leading-none">A41 肆合設計</p>
          <p className="text-sm font-bold truncate mt-1">{mobileTitle}</p>
        </div>
        <button onClick={onLogout} className="p-2.5 rounded-lg bg-white/10 active:bg-red-500" aria-label="登出">
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      {/* 手機：設計師專案抽屜 */}
      {drawer && drawerOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)}></div>
          <aside className="absolute left-0 top-0 bottom-0 w-[85%] max-w-xs bg-[#004A60] text-white flex flex-col shadow-2xl">
            <div className="p-4 flex items-center justify-between border-b border-white/10">
              {logo}
              <button onClick={() => setDrawerOpen(false)} className="p-2.5 rounded-lg bg-white/10" aria-label="關閉選單">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 flex-1 overflow-y-auto">{sidebar}</div>
            {footer}
          </aside>
        </div>
      )}

      <main className="flex-1 min-w-0 p-3 sm:p-5 md:p-8 md:h-screen md:overflow-y-auto relative pb-24 md:pb-8">
        {children}
      </main>

      {bottomNav}

      {toast && (
        <div className="fixed bottom-24 md:bottom-6 left-4 right-4 md:left-auto md:right-6 bg-gray-800 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center justify-center md:justify-start z-50">
          <CheckCircle className="w-5 h-5 text-green-400 mr-3 flex-shrink-0" />
          <span className="font-bold">{toast}</span>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 4. 登入畫面
// ============================================================
function LoginScreen({ onGoogle, onDesigner, error, busy }) {
  const [tab, setTab] = useState('client');
  const [email, setEmail] = useState('');
  const [pwd, setPwd] = useState('');

  return (
    <div className="min-h-screen bg-[#004A60] flex items-center justify-center p-4 font-sans">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="bg-[#004A60] p-6 sm:p-8 text-center">
          <h1 className="text-3xl font-black text-[#F8BB72] tracking-widest drop-shadow-md">A41</h1>
          <h2 className="text-xl font-bold text-white tracking-wider mt-1">DESIGN STUDIO</h2>
          <p className="text-gray-300 text-sm mt-3 border-t border-white/20 inline-block pt-2">肆合設計專案管理系統</p>
        </div>

        <div className="flex border-b bg-gray-50">
          {[['client', '業主登入'], ['designer', '設計師登入']].map(([key, label]) => (
            <button
              key={key}
              className={`flex-1 py-4 font-bold transition-all ${tab === key ? 'text-[#004A60] bg-white border-b-4 border-[#F8BB72]' : 'text-gray-400 hover:text-gray-600'}`}
              onClick={() => setTab(key)}
            >{label}</button>
          ))}
        </div>

        <div className="p-6 sm:p-8 space-y-5 bg-white">
          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-center border border-red-100">
              <AlertCircle className="w-5 h-5 mr-2 flex-shrink-0" />{error}
            </div>
          )}

          {tab === 'client' ? (
            <>
              <p className="text-sm text-gray-500 text-center">
                請使用設計師登記的 Google 帳號登入，即可查看您的專案進度。
              </p>
              <button
                onClick={onGoogle} disabled={busy}
                className="w-full flex items-center justify-center gap-3 border-2 border-gray-200 py-3.5 rounded-xl font-bold text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all disabled:opacity-50"
              >
                <svg className="w-5 h-5" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"/>
                  <path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z"/>
                  <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/>
                </svg>
                使用 Google 帳號登入
              </button>
            </>
          ) : (
            <form
              onSubmit={(e) => { e.preventDefault(); onDesigner(email.trim(), pwd); }}
              className="space-y-5"
            >
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">管理員 Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                  <input type="email" required className="pl-10 w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#004A60] outline-none"
                    value={email} onChange={e => setEmail(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">密碼</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                  <input type="password" required className="pl-10 w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#004A60] outline-none"
                    value={pwd} onChange={e => setPwd(e.target.value)} />
                </div>
              </div>
              <button type="submit" disabled={busy}
                className={`w-full ${primaryBtn} font-bold py-3.5 rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50`}>
                進入系統
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 5. 業主視角
// ============================================================
const TAB_META = {
  overview: { label: '專案總覽', Icon: FileText },
  meetings: { label: '會議記錄', Icon: Calendar },
  drawings: { label: '設計圖說', Icon: Map },
  logs: { label: '監工日誌', Icon: Camera },
};

function ClientView({ authUser, projects, error, onLogout, toast, showToast }) {
  const [selectedId, setSelectedId] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [confirm, setConfirm] = useState(null);

  const project = projects.find(p => p.id === selectedId) || projects[0] || null;
  const sigs = useSignatures(project?.id);

  const changeTab = (key) => { setActiveTab(key); window.scrollTo({ top: 0 }); };

  const doSign = async () => {
    const { itemId } = confirm;
    setConfirm(null);
    try {
      await setDoc(doc(sigCol(project.id), itemId), {
        signedAt: serverTimestamp(),
        signedByEmail: authUser.email.toLowerCase(),
        signedByName: authUser.displayName || '',
      });
      showToast('數位回簽成功！');
    } catch (err) {
      console.error(err);
      showToast('回簽失敗，請稍後再試。');
      return;
    }
    // 通知設計師（失敗不影響回簽本身）
    try {
      const token = await authUser.getIdToken();
      await fetch('/api/notify-sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ projectId: project.id, itemId }),
      });
    } catch (err) {
      console.warn('notify failed:', err);
    }
  };

  // 桌機側邊欄
  const sidebar = (
    <div className="space-y-3 mt-4">
      {projects.length > 1 && (
        <select
          className="w-full p-3 rounded-xl bg-white/10 text-white font-bold outline-none"
          value={project?.id || ''}
          onChange={e => { setSelectedId(e.target.value); setActiveTab('overview'); }}
        >
          {projects.map(p => <option key={p.id} value={p.id} className="text-gray-800">{p.name}</option>)}
        </select>
      )}
      {project && Object.entries(TAB_META).map(([key, { label, Icon }]) => (
        <button key={key} onClick={() => changeTab(key)}
          className={`w-full flex items-center p-4 rounded-xl font-bold transition-all ${activeTab === key ? 'bg-white text-[#004A60] shadow-lg scale-105' : 'text-white/70 hover:bg-white/10'}`}>
          <Icon className={`w-5 h-5 mr-3 ${activeTab === key ? 'text-[#F8BB72]' : ''}`} /> {label}
        </button>
      ))}
    </div>
  );

  // 手機底部分頁列
  const bottomNav = project && (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-gray-200 grid grid-cols-4 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {Object.entries(TAB_META).map(([key, { label, Icon }]) => (
        <button key={key} onClick={() => changeTab(key)}
          className={`relative flex flex-col items-center justify-center gap-1 py-2.5 text-xs font-bold ${activeTab === key ? 'text-[#004A60]' : 'text-gray-400'}`}>
          {activeTab === key && <span className="absolute top-0 inset-x-6 h-1 rounded-b bg-[#F8BB72]"></span>}
          <Icon className="w-5 h-5" /> {label}
        </button>
      ))}
    </nav>
  );

  return (
    <AppLayout
      sidebar={sidebar} footerLabel={`👤 ${authUser.displayName || authUser.email}`}
      onLogout={onLogout} toast={toast} bottomNav={bottomNav}
      mobileTitle={project?.name || '業主專區'}
    >
      {!project ? (
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="bg-white p-8 sm:p-10 rounded-3xl shadow-xl text-center max-w-md">
            <FolderLock className="w-12 h-12 mx-auto text-gray-400 mb-4" />
            <h2 className="text-xl font-black text-gray-800 mb-2">目前沒有可檢視的專案</h2>
            <p className="text-gray-500 text-sm leading-relaxed break-words">
              {error || `Google 帳號 ${authUser.email} 尚未綁定任何進行中的專案，或專案已結案。如有疑問請聯繫肆合設計。`}
            </p>
          </div>
        </div>
      ) : (
        <div className="max-w-4xl mx-auto space-y-4 md:space-y-6">
          {projects.length > 1 && (
            <select
              className="md:hidden w-full p-3 rounded-xl bg-white border border-gray-200 font-bold text-[#004A60] outline-none"
              value={project.id}
              onChange={e => { setSelectedId(e.target.value); setActiveTab('overview'); }}
            >
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}

          <div className="bg-white rounded-2xl shadow-sm p-5 lg:p-8 relative overflow-hidden">
            <div className="absolute left-0 top-0 w-2 h-full bg-[#F8BB72]"></div>
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-black text-gray-800 break-words pl-1">{project.name}</h1>
            <span className={`inline-block mt-3 px-4 py-1.5 rounded-full text-sm font-bold shadow-sm ${project.phase === 'design' ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-700'}`}>
              {project.phase === 'design' ? '📐 階段：設計規劃' : '🔨 階段：工程施工'}
            </span>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-4 sm:p-6 lg:p-8 min-h-[320px] md:min-h-[500px]">
            {activeTab === 'overview' ? (
              <>
                <h3 className="text-lg sm:text-xl font-black text-[#004A60] mb-4 sm:mb-6 flex items-center border-b pb-4">
                  <FileText className="w-6 h-6 mr-3 text-[#F8BB72]" /> 專案基本資訊
                </h3>
                <div className="bg-gray-50 p-4 sm:p-6 rounded-xl border border-gray-100">
                  <p className="text-gray-700 whitespace-pre-line leading-loose text-base sm:text-lg break-words">{project.overview}</p>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg sm:text-xl font-black text-[#004A60] mb-4 sm:mb-6 flex items-center border-b pb-4">
                  {React.createElement(TAB_META[activeTab].Icon, { className: 'w-6 h-6 mr-3 text-[#F8BB72] flex-shrink-0' })}
                  {TAB_META[activeTab].label}
                </h3>
                {(project[activeTab] || []).length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                    <FolderOpen className="w-16 h-16 mb-4 opacity-50" />
                    <p className="text-base sm:text-lg text-center">設計師尚未上傳此類別的檔案</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {project[activeTab].map(item => {
                      const sig = sigs[item.id];
                      return (
                        <div key={item.id} className="border border-gray-200 rounded-xl p-4 sm:p-5 flex flex-col justify-between bg-white">
                          <div className="mb-5">
                            <h4 className="font-bold text-gray-800 text-base sm:text-lg mb-2 break-words">{item.title}</h4>
                            <p className="text-xs font-medium text-gray-500 mb-3 bg-gray-100 inline-block px-2 py-1 rounded">建檔日：{item.date}</p>
                            <ItemOpenButton
                              item={item} showToast={showToast} label="檢視 / 下載檔案"
                              className="flex items-center justify-center p-3.5 rounded-lg bg-[#004A60] text-white active:bg-[#003647] font-bold shadow-sm w-full"
                            />
                            {itemKind(item) === 'file' && (
                              <p className="text-xs text-gray-400 mt-2 break-all">{item.fileName}（{fmtSize(item.fileSize)}）</p>
                            )}
                          </div>
                          <div className="pt-4 border-t border-gray-100">
                            {sig ? (
                              <div className="flex flex-wrap justify-between items-center gap-1 text-sm">
                                <span className="font-bold text-green-600 flex items-center"><CheckCircle className="w-5 h-5 mr-1.5" /> 已回簽</span>
                                <span className="text-xs text-gray-400">{fmtTs(sig.signedAt)}</span>
                              </div>
                            ) : (
                              <button
                                onClick={() => setConfirm({ itemId: item.id })}
                                className="w-full py-3.5 rounded-lg font-bold shadow-sm flex justify-center items-center bg-[#F8BB72] text-[#004A60] active:brightness-95">
                                <PenTool className="w-4 h-4 mr-2" /> 點擊進行數位回簽
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmModal
          message="確認要數位回簽此份文件嗎？回簽後代表您已確認內容無誤，且無法撤銷。"
          onConfirm={doSign} onClose={() => setConfirm(null)}
        />
      )}
    </AppLayout>
  );
}

// ============================================================
// 6. 設計師視角
// ============================================================
const SECTION_META = {
  meetings: { label: '會議記錄區', Icon: Calendar },
  drawings: { label: '設計圖說區', Icon: Map },
  logs: { label: '監工日誌區', Icon: Camera },
};

// 設計師的單一項目列：手機直向堆疊、桌機橫向排列（取代原本需左右捲動的表格）
function DesignerItemRow({ item, sig, showToast, onEdit, onDelete }) {
  return (
    <div className="py-4 flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
      <div className="md:flex-1 min-w-0">
        <p className="font-bold text-gray-800 break-words">{item.title}</p>
        <p className="text-xs text-gray-400 mt-1">
          {item.date}
          {itemKind(item) === 'file' && <span className="break-all"> · {item.fileName}（{fmtSize(item.fileSize)}）</span>}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <ItemOpenButton
          item={item} showToast={showToast} label="開啟"
          className="inline-flex items-center justify-center text-blue-600 hover:text-blue-800 bg-blue-50 px-3 py-2 rounded-lg text-sm font-bold min-h-[40px]"
        />
        {sig ? (
          <span className="inline-flex items-center text-xs font-bold text-green-700 bg-green-100 px-2.5 py-1.5 rounded-full border border-green-200">
            <Check className="w-3 h-3 mr-1" strokeWidth={3} /> 已簽名 · {fmtTs(sig.signedAt)}
          </span>
        ) : (
          <span className="inline-block text-xs font-bold text-gray-500 bg-gray-100 px-2.5 py-1.5 rounded-full">等待中</span>
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={onEdit} disabled={!!sig}
          title={sig ? '已回簽的項目無法修改，如需更新請新增新版本' : '編輯'}
          className="flex-1 md:flex-none min-h-[40px] text-[#004A60] hover:bg-gray-100 text-sm font-bold bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200 disabled:opacity-30 disabled:cursor-not-allowed">
          編輯
        </button>
        <button
          onClick={onDelete}
          className="flex-1 md:flex-none min-h-[40px] text-red-500 hover:text-red-600 text-sm font-bold bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200">
          刪除
        </button>
      </div>
    </div>
  );
}

function DesignerView({ authUser, projects, error, onLogout, toast, showToast }) {
  const [activeId, setActiveId] = useState(null);
  const [modal, setModal] = useState(null); // { type, payload }
  const [draft, setDraft] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const project = projects.find(p => p.id === activeId) || null;
  const sigs = useSignatures(project?.id);

  useEffect(() => { setDraft(project?.overview || ''); }, [project?.id, project?.overview]);

  const selectProject = (id) => { setActiveId(id); setDrawerOpen(false); window.scrollTo({ top: 0 }); };

  const patchProject = async (data) => {
    try { await updateDoc(projectRef(project.id), data); return true; }
    catch (err) { console.error(err); showToast('儲存失敗，請檢查網路或權限。'); return false; }
  };

  const createProject = async (data) => {
    const id = 'p_' + crypto.randomUUID();
    try {
      await setDoc(projectRef(id), {
        ...data, createdAt: Date.now(), status: 'active', phase: 'design',
        overview: '歡迎來到肆合設計！這裡是您的專案總覽專區...',
        meetings: [], drawings: [], logs: [],
      });
      setActiveId(id); setModal(null); showToast('專案建立成功');
    } catch (err) { console.error(err); showToast('建立失敗，請檢查權限。'); }
  };

  const editProject = async (data) => {
    if (await patchProject(data)) { setModal(null); showToast('專案資料已更新'); }
  };

  // 新增或編輯項目（連結 / 上傳檔案）
  const saveItem = async (type, existing, v, onProgress) => {
    if (existing && sigs[existing.id]) throw new Error('signed');
    const id = existing?.id || 'doc_' + crypto.randomUUID();
    let item = existing
      ? { ...existing }
      : { id, date: todayStr() };
    item.title = v.title;
    let newUpload = null;
    let oldPathToDelete = null;

    if (v.kind === 'link') {
      if (existing?.filePath) oldPathToDelete = existing.filePath;
      delete item.filePath; delete item.fileName; delete item.fileSize;
      item = { ...item, kind: 'link', nasLink: v.nasLink };
    } else if (v.file) {
      newUpload = await uploadFile(project.id, id, v.file, onProgress);
      if (existing?.filePath) oldPathToDelete = existing.filePath;
      delete item.nasLink;
      item = { ...item, kind: 'file', ...newUpload };
    }

    const list = project[type] || [];
    const next = existing ? list.map(i => (i.id === id ? item : i)) : [item, ...list];
    const ok = await patchProject({ [type]: next });
    if (!ok) {
      if (newUpload) await removeStoredFile(newUpload.filePath); // 寫入失敗，清掉剛上傳的檔案
      throw new Error('save failed');
    }
    if (oldPathToDelete) await removeStoredFile(oldPathToDelete);
    setModal(null);
    showToast(existing ? '項目已更新' : '項目新增成功');
  };

  const deleteItem = async () => {
    const { type, item } = modal.payload;
    const ok = await patchProject({ [type]: (project[type] || []).filter(i => i.id !== item.id) });
    if (ok) {
      if (item.filePath) await removeStoredFile(item.filePath);
      showToast('項目已刪除');
    }
    setModal(null);
  };

  const deleteProject = async () => {
    const ans = window.prompt(`請輸入 "${project.name}" 來確認刪除整個專案`);
    if (ans !== project.name) return;
    try {
      const sigSnap = await getDocs(sigCol(project.id));
      await Promise.all(sigSnap.docs.map(d => deleteDoc(d.ref)));
      try {
        const files = await listAll(sRef(storage, `projects/${project.id}`));
        await Promise.all(files.items.map(f => deleteObject(f)));
      } catch (e) { console.warn('storage cleanup skipped:', e); }
      await deleteDoc(projectRef(project.id));
      setActiveId(null); showToast('專案已永久刪除');
    } catch (err) { console.error(err); showToast('刪除失敗'); }
  };

  const active = projects.filter(p => p.status === 'active');
  const closed = projects.filter(p => p.status === 'closed');

  const sidebar = (
    <div className="space-y-6 mt-2 md:mt-4">
      <button onClick={() => { setDrawerOpen(false); setModal({ type: 'ADD_PROJECT' }); }}
        className="w-full flex items-center justify-center p-3.5 rounded-xl font-bold shadow-lg transition-all md:hover:scale-105 bg-[#F8BB72] text-[#004A60]">
        <Plus className="w-5 h-5 mr-2" /> 新增設計專案
      </button>

      <div className="space-y-2">
        <h3 className="text-xs text-white/50 font-black uppercase tracking-widest mb-3 px-2 flex items-center">
          <span className="w-1.5 h-1.5 bg-green-400 rounded-full mr-2"></span> 進行中專案
        </h3>
        {active.length === 0 && <p className="text-sm px-2 text-white/40">無進行中專案</p>}
        {active.map(p => (
          <button key={p.id} onClick={() => selectProject(p.id)}
            className={`w-full text-left p-3.5 rounded-lg transition-all truncate font-medium border ${activeId === p.id ? 'bg-white/10 text-[#F8BB72] border-white/20 shadow-inner' : 'border-transparent hover:bg-white/5 text-white/80'}`}>
            {p.name}
          </button>
        ))}
      </div>

      <div className="space-y-2 pt-4 border-t border-white/10">
        <h3 className="text-xs text-white/50 font-black uppercase tracking-widest mb-3 px-2 flex items-center">
          <span className="w-1.5 h-1.5 bg-gray-400 rounded-full mr-2"></span> 歷史歸檔
        </h3>
        {closed.map(p => (
          <button key={p.id} onClick={() => selectProject(p.id)}
            className={`w-full text-left p-3.5 rounded-lg transition-all truncate font-medium text-sm ${activeId === p.id ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/5'}`}>
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <AppLayout
      sidebar={sidebar} footerLabel={`🛡️ 管理員：${authUser.email}`} onLogout={onLogout} toast={toast}
      mobileTitle={project?.name || 'A41 控制台'}
      drawer drawerOpen={drawerOpen} setDrawerOpen={setDrawerOpen}
    >
      {error && <div className="mb-4 bg-red-50 text-red-600 p-3 rounded-lg text-sm border border-red-100">{error}</div>}

      {!project ? (
        <div className="min-h-[60vh] flex flex-col items-center justify-center">
          <div className="bg-white p-8 sm:p-10 rounded-3xl shadow-xl text-center max-w-sm w-full">
            <div className="w-20 h-20 mx-auto rounded-full bg-[#004A60] flex items-center justify-center mb-6 shadow-inner">
              <FolderOpen className="w-10 h-10 text-[#F8BB72]" />
            </div>
            <h2 className="text-2xl font-black text-gray-800 mb-2">A41 控制台</h2>
            <p className="text-gray-500">
              <span className="hidden md:inline">請從左側選擇專案進行管理，或建立新專案。</span>
              <span className="md:hidden">請開啟選單選擇專案進行管理，或建立新專案。</span>
            </p>
            <button onClick={() => setDrawerOpen(true)}
              className="md:hidden mt-6 w-full py-3.5 rounded-xl font-bold bg-[#004A60] text-[#F8BB72] flex items-center justify-center">
              <Menu className="w-5 h-5 mr-2" /> 開啟專案選單
            </button>
          </div>
        </div>
      ) : (
        <div className="max-w-6xl mx-auto space-y-4 md:space-y-6 pb-10">
          {/* 專案標題列 */}
          <div className="bg-white rounded-2xl shadow-sm p-5 lg:p-8 flex flex-col lg:flex-row justify-between lg:items-center gap-5 relative overflow-hidden">
            <div className={`absolute left-0 top-0 w-2 h-full ${project.status === 'closed' ? 'bg-gray-400' : 'bg-[#004A60]'}`}></div>
            <div className="min-w-0 pl-1">
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-black text-gray-800 flex items-start gap-2 break-words">
                {project.status === 'closed' && <FolderLock className="w-6 h-6 mt-1 text-gray-500 flex-shrink-0" />}
                <span className="min-w-0 break-words">{project.name}</span>
                <button onClick={() => setModal({ type: 'EDIT_PROJECT' })} title="編輯專案資料" aria-label="編輯專案資料"
                  className="p-2 -mt-0.5 rounded-lg text-gray-400 hover:text-[#004A60] hover:bg-gray-100 transition-colors flex-shrink-0">
                  <Pencil className="w-5 h-5" />
                </button>
              </h1>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 bg-gray-50 p-3 rounded-lg border border-gray-100">
                <span className="text-sm font-bold text-gray-600 flex items-center"><User className="w-4 h-4 mr-1 text-gray-400 flex-shrink-0" /> {project.clientName}</span>
                <span className="text-sm font-bold text-gray-600 flex items-center min-w-0"><Mail className="w-4 h-4 mr-1 text-gray-400 flex-shrink-0" /> <span className="break-all">{project.clientEmail}</span></span>
                {project.clientPhone && <span className="text-sm font-bold text-gray-600 flex items-center"><Phone className="w-4 h-4 mr-1 text-gray-400 flex-shrink-0" /> {project.clientPhone}</span>}
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
              <select
                className={`border-2 p-3 rounded-xl font-bold outline-none w-full sm:w-auto ${project.phase === 'design' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}
                value={project.phase} onChange={e => patchProject({ phase: e.target.value })}>
                <option value="design">📐 階段：設計規劃中</option>
                <option value="construction">🔨 階段：工程施工中</option>
              </select>
              <button
                onClick={() => patchProject({ status: project.status === 'active' ? 'closed' : 'active' })}
                className={`px-5 py-3 rounded-xl font-bold shadow-sm text-white w-full sm:w-auto ${project.status === 'active' ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}>
                {project.status === 'active' ? '關閉專案（撤銷業主權限）' : '重啟專案'}
              </button>
            </div>
          </div>

          {/* 總覽文字 */}
          <div className="bg-white rounded-2xl shadow-sm p-5 lg:p-8">
            <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
              <h3 className="text-base sm:text-lg font-black text-[#004A60] flex items-center">
                <FileText className="w-5 h-5 mr-2 text-[#F8BB72]" /> 專案總覽文字（業主首頁顯示）
              </h3>
              <span className="text-xs text-gray-400 font-bold bg-gray-100 px-2 py-1 rounded">離開輸入框後自動儲存</span>
            </div>
            <textarea
              className="w-full h-36 sm:h-32 p-4 border-2 rounded-xl focus:border-[#004A60] outline-none resize-none bg-gray-50 text-gray-700 leading-relaxed font-medium"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={() => { if (draft !== project.overview) patchProject({ overview: draft }); }}
              placeholder="輸入給業主看的專案描述、設計理念或提醒事項..."
            />
          </div>

          {/* 三大區塊 */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6">
            {Object.entries(SECTION_META).map(([type, { label, Icon }]) => {
              const items = project[type] || [];
              const dim = (project.phase === 'design' && type === 'logs') || (project.phase === 'construction' && type === 'drawings');
              const focus = (project.phase === 'design' && type === 'drawings') || (project.phase === 'construction' && type === 'logs');
              return (
                <div key={type} className={`bg-white rounded-2xl shadow-sm p-4 sm:p-6 flex flex-col ${type === 'meetings' ? 'xl:col-span-2' : ''} ${dim ? 'opacity-60 hover:opacity-100 transition-opacity' : ''}`}>
                  <div className="flex flex-wrap justify-between items-center gap-3 border-b pb-4 mb-2">
                    <h3 className="text-base sm:text-lg font-black text-[#004A60] flex flex-wrap items-center gap-y-1">
                      <Icon className="w-5 h-5 mr-2 text-[#F8BB72]" /> {label}
                      {focus && <span className={`ml-3 px-2 py-1 text-xs rounded-md font-bold ${type === 'drawings' ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-700'}`}>當前重點</span>}
                    </h3>
                    <button onClick={() => setModal({ type: 'ITEM', payload: { type, item: null } })}
                      className="px-4 py-2.5 rounded-lg text-sm font-bold flex items-center shadow-sm bg-[#F8BB72] text-[#004A60] active:brightness-95">
                      <Plus className="w-4 h-4 mr-1" /> 新增檔案
                    </button>
                  </div>

                  {items.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center py-10 mt-2 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                      <p className="text-gray-400 font-medium">尚未新增資料</p>
                    </div>
                  ) : (
                    <div className="divide-y">
                      {items.map(item => (
                        <DesignerItemRow
                          key={item.id} item={item} sig={sigs[item.id]} showToast={showToast}
                          onEdit={() => setModal({ type: 'ITEM', payload: { type, item } })}
                          onDelete={() => setModal({ type: 'DELETE_ITEM', payload: { type, item, signed: !!sigs[item.id] } })}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="pt-6 border-t border-gray-200 flex justify-end">
            <button onClick={deleteProject} className="text-gray-400 hover:text-red-500 text-sm font-bold underline transition-colors py-2">
              永久刪除此專案
            </button>
          </div>
        </div>
      )}

      {modal?.type === 'ADD_PROJECT' && <ProjectFormModal onSubmit={createProject} onClose={() => setModal(null)} />}
      {modal?.type === 'EDIT_PROJECT' && project && <ProjectFormModal initial={project} onSubmit={editProject} onClose={() => setModal(null)} />}
      {modal?.type === 'ITEM' && (
        <ItemFormModal
          initial={modal.payload.item}
          onSubmit={(v, onProgress) => saveItem(modal.payload.type, modal.payload.item, v, onProgress)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'DELETE_ITEM' && (
        <ConfirmModal
          danger
          message={modal.payload.signed
            ? '此項目業主已回簽。刪除後業主與你都將看不到此項目（回簽紀錄仍保留在資料庫中）。確定要刪除嗎？'
            : '確定要刪除此項目嗎？刪除後業主將無法看見，已上傳的檔案也會一併刪除。'}
          onConfirm={deleteItem} onClose={() => setModal(null)}
        />
      )}
    </AppLayout>
  );
}

// ============================================================
// 7. 主程式：驗證狀態與資料監聽
// ============================================================
export default function App() {
  const [authUser, setAuthUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [projects, setProjects] = useState([]);
  const [dbError, setDbError] = useState('');
  const [loginError, setLoginError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const isAdmin = !!authUser?.email && ADMIN_EMAILS.includes(authUser.email.toLowerCase());

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => { setAuthUser(u); setAuthReady(true); });
  }, []);

  useEffect(() => {
    setDbError('');
    if (!authUser?.email) { setProjects([]); return; }

    const q = isAdmin
      ? query(projectsCol(), orderBy('createdAt', 'desc'))
      : query(
          projectsCol(),
          where('clientEmail', '==', authUser.email.toLowerCase()),
          where('status', '==', 'active')
        );

    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => b.createdAt - a.createdAt);
        setProjects(list);
      },
      (err) => {
        console.error('Firestore listen error:', err);
        setDbError('無法讀取資料，請確認登入帳號或聯繫設計師。');
      }
    );
  }, [authUser, isAdmin]);

  const loginWithGoogle = async () => {
    setLoginError(''); setBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        console.error(err);
        setLoginError(err.code === 'auth/popup-blocked'
          ? '瀏覽器阻擋了登入視窗，請允許彈出視窗後重試。'
          : 'Google 登入失敗，請稍後再試。');
      }
    } finally { setBusy(false); }
  };

  const loginDesigner = async (email, pwd) => {
    setLoginError(''); setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email, pwd);
    } catch (err) {
      console.error(err);
      setLoginError('帳號或密碼錯誤。');
    } finally { setBusy(false); }
  };

  const logout = () => signOut(auth);

  if (!authReady) {
    return <div className="min-h-screen bg-[#004A60] flex items-center justify-center text-white/70 animate-pulse">載入中...</div>;
  }
  if (!authUser) {
    return <LoginScreen onGoogle={loginWithGoogle} onDesigner={loginDesigner} error={loginError} busy={busy} />;
  }
  const common = { authUser, projects, error: dbError, onLogout: logout, toast, showToast };
  return isAdmin ? <DesignerView {...common} /> : <ClientView {...common} />;
}

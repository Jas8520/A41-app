import React, { useState, useEffect } from 'react';
import { 
  Lock, User, Phone, FileText, Calendar, Camera, Map, 
  CheckCircle, LogOut, Plus, Link as LinkIcon, Edit, 
  FolderLock, FolderOpen, PenTool, AlertCircle, Eye, X, Check
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';

// --- 1. Firebase 連線設定 (使用您專屬的資料庫) ---
const firebaseConfig = {
  apiKey: "AIzaSyCtoCVGicWiJCsRs_MWQKIu3rZOSopU380",
  authDomain: "a41-design.firebaseapp.com",
  databaseURL: "https://a41-design-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "a41-design",
  storageBucket: "a41-design.firebasestorage.app",
  messagingSenderId: "715263206104",
  appId: "1:715263206104:web:853874224bd6d955feadad",
  measurementId: "G-LLLGSF6FMR"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 定義系統的專屬 ID，確保資料路徑正確
const systemAppId = 'a41-design'; 

export default function App() {
  // --- Firebase 雲端資料狀態 ---
  const [fbUser, setFbUser] = useState(null);
  const [projects, setProjects] = useState([]);
  
  // --- 登入與業務邏輯狀態 ---
  const [user, setUser] = useState(null); // { role: 'designer' } 或 { role: 'client', project: {...} }
  const [loginTab, setLoginTab] = useState('client');
  const [designerId, setDesignerId] = useState('');
  const [designerPwd, setDesignerPwd] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [loginError, setLoginError] = useState('');

  const [activeProject, setActiveProject] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');

  // --- UI 狀態 (彈跳視窗與提示) ---
  const [modal, setModal] = useState({ isOpen: false, type: '', payload: null });
  const [toast, setToast] = useState('');

  // 主題配色
  const ThemeStyles = {
    primaryBg: 'bg-[#004A60]',
    primaryText: 'text-[#004A60]',
    secondaryBg: 'bg-[#F8BB72]',
    secondaryText: 'text-[#F8BB72]',
    borderPrimary: 'border-[#004A60]',
    borderSecondary: 'border-[#F8BB72]',
  };

  // --- 2. 初始化 Firebase 匿名登入 (確保業主無需註冊即可讀取) ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        // 為了相容多種環境，優先檢查自定義 token，若無則一律使用匿名登入
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          try {
            await signInWithCustomToken(auth, __initial_auth_token);
          } catch (customTokenError) {
            console.warn("自定義 token 驗證失敗，自動改用匿名登入:", customTokenError);
            await signInAnonymously(auth);
          }
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth error:", err);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setFbUser(u);
    });
    return () => unsubscribe();
  }, []);

  // --- 3. 即時監聽 Firestore 資料庫 ---
  useEffect(() => {
    if (!fbUser) return;

    // 規定使用的儲存路徑
    const projectsRef = collection(db, 'artifacts', systemAppId, 'public', 'data', 'projects');
    
    const unsubscribe = onSnapshot(projectsRef, (snapshot) => {
      const fetchedProjects = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      // 依照建立時間排序 (最新的在最上面)
      fetchedProjects.sort((a, b) => b.createdAt - a.createdAt);
      setProjects(fetchedProjects);
    }, (error) => {
      console.error("Firestore listen error:", error);
      setLoginError("無法連線至資料庫，請檢查您的 Firebase 安全性規則是否設定為測試模式。");
    });

    return () => unsubscribe();
  }, [fbUser]);

  // --- 確保資料更新時，畫面狀態同步 ---
  useEffect(() => {
    if (activeProject) {
      const updated = projects.find(p => p.id === activeProject.id);
      if (updated) setActiveProject(updated);
    }
    if (user?.role === 'client') {
      const updated = projects.find(p => p.id === user.project.id);
      if (updated) {
        // 若設計師關閉專案，自動將業主登出
        if(updated.status === 'closed') {
           setUser(null);
           setLoginError('此專案已被設計師標示為結案，權限已關閉。');
        } else {
           setUser({ ...user, project: updated });
        }
      }
    }
  }, [projects]);

  // --- 提示訊息小幫手 ---
  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  // --- 資料寫入與刪除邏輯 ---
  const saveProjectToDB = async (projectData) => {
    if (!fbUser) return;
    try {
      const docRef = doc(db, 'artifacts', systemAppId, 'public', 'data', 'projects', projectData.id);
      await setDoc(docRef, projectData);
    } catch (err) {
      console.error('Error saving:', err);
      showToast("儲存失敗，請檢查網路連線。");
    }
  };

  const deleteProjectFromDB = async (projectId) => {
    if (!fbUser) return;
    try {
      const docRef = doc(db, 'artifacts', systemAppId, 'public', 'data', 'projects', projectId);
      await deleteDoc(docRef);
      setActiveProject(null);
      showToast('專案已永久刪除');
    } catch (err) {
      console.error('Error deleting:', err);
    }
  };

  // --- 登入控制 ---
  const handleLogin = (e) => {
    e.preventDefault();
    setLoginError('');

    if (loginTab === 'designer') {
      if (designerId === 'admin' && designerPwd === 'admin') {
        setUser({ role: 'designer', name: '設計總監' });
      } else {
        setLoginError('管理員帳號或密碼錯誤 (測試帳密: admin/admin)');
      }
    } else {
      const project = projects.find(p => p.clientName === clientName && p.clientPhone === clientPhone);
      if (project) {
        if (project.status === 'closed') {
          setLoginError('此專案已結案，您目前無法讀取資料。如有疑問請聯繫肆合設計。');
        } else {
          setUser({ role: 'client', project });
          setActiveTab('overview');
        }
      } else {
        setLoginError('找不到符合的姓名與電話，請確認後再試。');
      }
    }
  };

  const handleLogout = () => {
    setUser(null);
    setActiveProject(null);
    setClientName('');
    setClientPhone('');
  };

  // --- 建立測試資料 ---
  const loadDemoData = async () => {
    const demo1 = {
      id: 'p_demo1_' + Date.now(),
      createdAt: Date.now(),
      name: '信義區王公館 現代極簡風', clientName: '王大明', clientPhone: '0912345678',
      status: 'active', phase: 'design',
      overview: '本案位於信義區，坪數45坪。主要訴求為現代極簡風格，增加收納空間並保留採光。',
      meetings: [{ id: 'm1', title: '初步需求訪談與風格確認', date: '2026-04-20', nasLink: 'https://example.com/nas/m1', signed: true, signDate: '2026-04-21 10:30' }],
      drawings: [
        { id: 'd1', title: '原始現況圖 & 拆除圖', date: '2026-04-25', nasLink: 'https://example.com/nas/d1', signed: false, signDate: null },
        { id: 'd2', title: '平面配置圖 V1', date: '2026-04-28', nasLink: 'https://example.com/nas/d2', signed: false, signDate: null }
      ],
      logs: []
    };
    await saveProjectToDB(demo1);
    showToast('已載入測試範例資料！');
  };

  // --- 彈跳視窗 (Modals) 元件 ---
  const closeModal = () => setModal({ isOpen: false, type: '', payload: null });

  const ModalWrapper = ({ title, children }) => (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className={`p-4 border-b flex justify-between items-center ${ThemeStyles.primaryBg}`}>
          <h3 className={`font-bold text-lg ${ThemeStyles.secondaryText}`}>{title}</h3>
          <button onClick={closeModal} className="text-white/70 hover:text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="p-6 bg-gray-50">
          {children}
        </div>
      </div>
    </div>
  );

  const [formProjName, setFormProjName] = useState('');
  const [formClientName, setFormClientName] = useState('');
  const [formClientPhone, setFormClientPhone] = useState('');
  
  const [formItemTitle, setFormItemTitle] = useState('');
  const [formItemLink, setFormItemLink] = useState('');

  const submitAddProject = () => {
    if(!formProjName || !formClientName || !formClientPhone) return;
    const newProject = {
      id: 'p_' + Date.now(),
      createdAt: Date.now(),
      name: formProjName, clientName: formClientName, clientPhone: formClientPhone,
      status: 'active', phase: 'design',
      overview: '歡迎來到肆合設計！這裡是您的專案總覽專區...',
      meetings: [], drawings: [], logs: []
    };
    saveProjectToDB(newProject);
    setActiveProject(newProject);
    showToast('專案建立成功');
    closeModal();
  };

  const submitAddItem = () => {
    if(!formItemTitle || !formItemLink) return;
    const { type } = modal.payload;
    const now = new Date();
    const dateString = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    
    const newItem = { id: 'doc_' + Date.now(), title: formItemTitle, date: dateString, nasLink: formItemLink, signed: false, signDate: null };
    const updatedProject = { ...activeProject };
    updatedProject[type] = [newItem, ...updatedProject[type]];
    
    saveProjectToDB(updatedProject);
    showToast('項目新增成功');
    closeModal();
  };

  const confirmAction = () => {
    const { actionType, type, itemId } = modal.payload;
    if (actionType === 'SIGN') {
      const now = new Date();
      const dateString = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      
      const p = user.project;
      const updatedProject = { ...p };
      const itemIndex = updatedProject[type].findIndex(i => i.id === itemId);
      updatedProject[type][itemIndex] = { ...updatedProject[type][itemIndex], signed: true, signDate: dateString };
      
      saveProjectToDB(updatedProject);
      showToast('數位回簽成功！');
    } else if (actionType === 'DELETE_ITEM') {
      const updatedProject = { ...activeProject };
      updatedProject[type] = updatedProject[type].filter(item => item.id !== itemId);
      saveProjectToDB(updatedProject);
      showToast('項目已刪除');
    }
    closeModal();
  };

  // --- 登入畫面 UI ---
  if (!user) {
    return (
      <div className={`min-h-screen ${ThemeStyles.primaryBg} flex items-center justify-center p-4 font-sans`}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden relative">
          
          <div className={`${ThemeStyles.primaryBg} p-8 text-center relative overflow-hidden`}>
            <div className="absolute top-0 left-0 w-full h-full opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
            <h1 className={`text-3xl font-black ${ThemeStyles.secondaryText} tracking-widest relative z-10 drop-shadow-md`}>A41</h1>
            <h2 className="text-xl font-bold text-white tracking-wider mt-1 relative z-10">DESIGN STUDIO</h2>
            <p className="text-gray-300 text-sm mt-3 relative z-10 border-t border-white/20 inline-block pt-2">肆合設計專案管理系統</p>
          </div>
          
          <div className="flex border-b bg-gray-50">
            <button 
              className={`flex-1 py-4 font-bold transition-all ${loginTab === 'client' ? `${ThemeStyles.primaryText} bg-white border-b-4 ${ThemeStyles.borderSecondary}` : 'text-gray-400 hover:text-gray-600'}`}
              onClick={() => { setLoginTab('client'); setLoginError(''); }}
            >
              業主登入
            </button>
            <button 
              className={`flex-1 py-4 font-bold transition-all ${loginTab === 'designer' ? `${ThemeStyles.primaryText} bg-white border-b-4 ${ThemeStyles.borderSecondary}` : 'text-gray-400 hover:text-gray-600'}`}
              onClick={() => { setLoginTab('designer'); setLoginError(''); }}
            >
              設計師登入
            </button>
          </div>

          <form onSubmit={handleLogin} className="p-8 space-y-5 bg-white">
            {!fbUser && <div className="text-xs text-center text-blue-500 animate-pulse mb-2">正在連線至 A41 雲端資料庫...</div>}
            
            {loginError && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-center border border-red-100">
                <AlertCircle className="w-5 h-5 mr-2 flex-shrink-0" />
                {loginError}
              </div>
            )}

            {loginTab === 'client' ? (
              <>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">業主姓名</label>
                  <div className="relative">
                    <User className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                    <input 
                      type="text" required
                      className={`pl-10 w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[${ThemeStyles.primaryBg}] outline-none transition-all`}
                      value={clientName} onChange={e => setClientName(e.target.value)}
                      placeholder="例如：王大明"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">聯絡電話</label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                    <input 
                      type="tel" required
                      className={`pl-10 w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[${ThemeStyles.primaryBg}] outline-none transition-all`}
                      value={clientPhone} onChange={e => setClientPhone(e.target.value)}
                      placeholder="例如：0912345678"
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">管理員帳號</label>
                  <div className="relative">
                    <User className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                    <input 
                      type="text" required
                      className={`pl-10 w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[${ThemeStyles.primaryBg}] outline-none transition-all`}
                      value={designerId} onChange={e => setDesignerId(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">專屬密碼</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                    <input 
                      type="password" required
                      className={`pl-10 w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[${ThemeStyles.primaryBg}] outline-none transition-all`}
                      value={designerPwd} onChange={e => setDesignerPwd(e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}
            
            <button 
              type="submit" disabled={!fbUser}
              className={`w-full ${ThemeStyles.primaryBg} ${ThemeStyles.secondaryText} font-bold py-3.5 rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all mt-4 disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              進入系統
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- 共用排版 Layout ---
  const Layout = ({ children, sidebar }) => (
    <div className="min-h-screen bg-gray-100 flex flex-col md:flex-row font-sans">
      <div className={`w-full md:w-72 ${ThemeStyles.primaryBg} text-white flex flex-col shadow-2xl z-10`}>
        <div className="p-6 flex items-center justify-between border-b border-white/10">
          <div>
            <h2 className={`font-black text-2xl tracking-wider ${ThemeStyles.secondaryText}`}>A41</h2>
            <p className="text-xs text-white/60 tracking-widest mt-1">肆合設計</p>
          </div>
          <button onClick={handleLogout} className="p-2 bg-white/5 hover:bg-red-500 hover:text-white transition-colors rounded-lg group" title="登出">
            <LogOut className="w-5 h-5 text-white/70 group-hover:text-white" />
          </button>
        </div>
        
        <div className="p-4 flex-1 overflow-y-auto space-y-2">
          {sidebar}
        </div>
        
        <div className="p-4 border-t border-white/10 bg-black/20 text-xs text-gray-300 flex items-center justify-between">
          <span>{user.role === 'designer' ? '🛡️ 管理員模式' : `👤 ${user.project.clientName}`}</span>
          <span className="flex items-center"><div className="w-2 h-2 rounded-full bg-green-400 mr-2"></div>連線中</span>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 md:p-8 relative">
        {children}
        
        {toast && (
          <div className="fixed bottom-6 right-6 bg-gray-800 text-white px-6 py-3 rounded-xl shadow-2xl flex items-center animate-in slide-in-from-bottom-5 z-50">
            <CheckCircle className="w-5 h-5 text-green-400 mr-3" />
            <span className="font-bold">{toast}</span>
          </div>
        )}
      </div>

      {modal.isOpen && modal.type === 'ADD_PROJECT' && (
        <ModalWrapper title="✨ 新增專案">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">專案名稱</label>
              <input type="text" className="w-full p-3 border rounded-lg focus:ring-2 outline-none" placeholder="例如：信義區王公館" value={formProjName} onChange={e=>setFormProjName(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">業主姓名</label>
              <input type="text" className="w-full p-3 border rounded-lg focus:ring-2 outline-none" placeholder="登入用姓名" value={formClientName} onChange={e=>setFormClientName(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">聯絡電話</label>
              <input type="tel" className="w-full p-3 border rounded-lg focus:ring-2 outline-none" placeholder="登入用電話" value={formClientPhone} onChange={e=>setFormClientPhone(e.target.value)} />
            </div>
            <button onClick={submitAddProject} className={`w-full py-3 rounded-lg font-bold mt-4 shadow-md ${ThemeStyles.primaryBg} ${ThemeStyles.secondaryText}`}>建立專案</button>
          </div>
        </ModalWrapper>
      )}

      {modal.isOpen && modal.type === 'ADD_ITEM' && (
        <ModalWrapper title="📄 新增檔案連結">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">標題</label>
              <input type="text" className="w-full p-3 border rounded-lg focus:ring-2 outline-none" placeholder="例如：平面配置圖 V2" value={formItemTitle} onChange={e=>setFormItemTitle(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">NAS 分享連結 (URL)</label>
              <input type="url" className="w-full p-3 border rounded-lg focus:ring-2 outline-none" placeholder="https://..." value={formItemLink} onChange={e=>setFormItemLink(e.target.value)} />
            </div>
            <button onClick={submitAddItem} className={`w-full py-3 rounded-lg font-bold mt-4 shadow-md ${ThemeStyles.primaryBg} ${ThemeStyles.secondaryText}`}>確認新增</button>
          </div>
        </ModalWrapper>
      )}

      {modal.isOpen && modal.type === 'CONFIRM' && (
        <ModalWrapper title="系統確認">
          <div className="text-center py-4">
            <p className="text-lg text-gray-700 mb-6">{modal.payload.message}</p>
            <div className="flex gap-4">
              <button onClick={closeModal} className="flex-1 py-3 bg-gray-200 text-gray-800 rounded-lg font-bold hover:bg-gray-300 transition-colors">取消</button>
              <button onClick={confirmAction} className={`flex-1 py-3 text-white rounded-lg font-bold transition-colors ${modal.payload.actionType === 'DELETE_ITEM' ? 'bg-red-500 hover:bg-red-600' : ThemeStyles.primaryBg}`}>確認執行</button>
            </div>
          </div>
        </ModalWrapper>
      )}
    </div>
  );

  // --- 業主視角 UI ---
  if (user.role === 'client') {
    const p = user.project;
    
    const triggerSign = (type, itemId) => {
      setModal({ isOpen: true, type: 'CONFIRM', payload: { actionType: 'SIGN', type, itemId, message: '確認要數位回簽此份文件嗎？回簽後代表您已確認內容無誤。' } });
    };

    return (
      <Layout sidebar={
        <nav className="space-y-3 mt-4">
          <button onClick={() => setActiveTab('overview')} className={`w-full flex items-center p-4 rounded-xl font-bold transition-all ${activeTab === 'overview' ? 'bg-white text-[#004A60] shadow-lg scale-105' : 'text-white/70 hover:bg-white/10'}`}>
            <FileText className={`w-5 h-5 mr-3 ${activeTab === 'overview' ? 'text-[#F8BB72]' : ''}`} /> 專案總覽
          </button>
          <button onClick={() => setActiveTab('meetings')} className={`w-full flex items-center p-4 rounded-xl font-bold transition-all ${activeTab === 'meetings' ? 'bg-white text-[#004A60] shadow-lg scale-105' : 'text-white/70 hover:bg-white/10'}`}>
            <Calendar className={`w-5 h-5 mr-3 ${activeTab === 'meetings' ? 'text-[#F8BB72]' : ''}`} /> 會議記錄
          </button>
          <button onClick={() => setActiveTab('drawings')} className={`w-full flex items-center p-4 rounded-xl font-bold transition-all ${activeTab === 'drawings' ? 'bg-white text-[#004A60] shadow-lg scale-105' : 'text-white/70 hover:bg-white/10'}`}>
            <Map className={`w-5 h-5 mr-3 ${activeTab === 'drawings' ? 'text-[#F8BB72]' : ''}`} /> 設計圖說
          </button>
          <button onClick={() => setActiveTab('logs')} className={`w-full flex items-center p-4 rounded-xl font-bold transition-all ${activeTab === 'logs' ? 'bg-white text-[#004A60] shadow-lg scale-105' : 'text-white/70 hover:bg-white/10'}`}>
            <Camera className={`w-5 h-5 mr-3 ${activeTab === 'logs' ? 'text-[#F8BB72]' : ''}`} /> 監工日誌
          </button>
        </nav>
      }>
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="bg-white rounded-2xl shadow-sm p-6 lg:p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 relative overflow-hidden">
            <div className={`absolute left-0 top-0 w-2 h-full ${ThemeStyles.secondaryBg}`}></div>
            <div>
              <h1 className="text-2xl lg:text-3xl font-black text-gray-800">{p.name}</h1>
              <div className="flex flex-wrap items-center gap-3 mt-3">
                <span className={`px-4 py-1.5 rounded-full text-sm font-bold shadow-sm ${p.phase === 'design' ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-700'}`}>
                  {p.phase === 'design' ? '📐 階段：設計規劃' : '🔨 階段：工程施工'}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-6 lg:p-8 min-h-[500px]">
            {activeTab === 'overview' && (
              <div className="animate-in fade-in duration-300">
                <h3 className={`text-xl font-black ${ThemeStyles.primaryText} mb-6 flex items-center border-b pb-4`}>
                  <FileText className="w-6 h-6 mr-3 text-[#F8BB72]" /> 專案基本資訊
                </h3>
                <div className="bg-gray-50 p-6 rounded-xl border border-gray-100">
                  <p className="text-gray-700 whitespace-pre-line leading-loose text-lg">{p.overview}</p>
                </div>
              </div>
            )}

            {['meetings', 'drawings', 'logs'].includes(activeTab) && (
              <div className="animate-in fade-in duration-300">
                <h3 className={`text-xl font-black ${ThemeStyles.primaryText} mb-6 flex items-center border-b pb-4`}>
                  {activeTab === 'meetings' && <><Calendar className="w-6 h-6 mr-3 text-[#F8BB72]" /> 會議記錄</>}
                  {activeTab === 'drawings' && <><Map className="w-6 h-6 mr-3 text-[#F8BB72]" /> 設計圖說 (圖紙/簡報)</>}
                  {activeTab === 'logs' && <><Camera className="w-6 h-6 mr-3 text-[#F8BB72]" /> 監工日誌 (現場照片/進度)</>}
                </h3>
                
                {p[activeTab].length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                    <FolderOpen className="w-16 h-16 mb-4 opacity-50" />
                    <p className="text-lg">設計師尚未上傳此類別的檔案</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {p[activeTab].map(item => (
                      <div key={item.id} className="border border-gray-200 rounded-xl p-5 flex flex-col justify-between hover:shadow-md transition-shadow bg-white relative overflow-hidden group">
                        {item.signed && <div className="absolute top-0 right-0 w-16 h-16 bg-green-50 rounded-bl-full z-0 transition-transform group-hover:scale-110"></div>}
                        
                        <div className="relative z-10 mb-6">
                          <h4 className="font-bold text-gray-800 text-lg mb-2 line-clamp-2">{item.title}</h4>
                          <p className="text-xs font-medium text-gray-500 mb-3 bg-gray-100 inline-block px-2 py-1 rounded">建檔日：{item.date}</p>
                          <a 
                            href={item.nasLink} target="_blank" rel="noreferrer"
                            className={`flex items-center justify-center p-3 rounded-lg ${ThemeStyles.primaryBg} text-white hover:bg-opacity-90 font-bold transition-all shadow-sm`}
                          >
                            <LinkIcon className="w-4 h-4 mr-2" /> 檢視 / 下載檔案
                          </a>
                        </div>
                        
                        <div className="relative z-10 pt-4 border-t border-gray-100">
                          {item.signed ? (
                            <div className="flex justify-between items-center text-sm">
                              <span className="font-bold text-green-600 flex items-center">
                                <CheckCircle className="w-5 h-5 mr-1.5" /> 已回簽
                              </span>
                              <span className="text-xs text-gray-400">{item.signDate}</span>
                            </div>
                          ) : (
                            <button 
                              onClick={() => triggerSign(activeTab, item.id)}
                              className={`w-full py-2.5 rounded-lg font-bold shadow-sm transition-all flex justify-center items-center ${ThemeStyles.secondaryBg} ${ThemeStyles.primaryText} hover:brightness-105`}
                            >
                              <PenTool className="w-4 h-4 mr-2" /> 點擊進行數位回簽
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </Layout>
    );
  }

  // --- 設計師視角 UI ---
  const triggerAddProject = () => {
    setFormProjName(''); setFormClientName(''); setFormClientPhone('');
    setModal({ isOpen: true, type: 'ADD_PROJECT', payload: null });
  };

  const DesignerSidebar = () => (
    <div className="space-y-6 mt-4">
      <button 
        onClick={triggerAddProject}
        className={`w-full flex items-center justify-center p-3.5 rounded-xl font-bold shadow-lg transition-all hover:scale-105 ${ThemeStyles.secondaryBg} ${ThemeStyles.primaryText}`}
      >
        <Plus className="w-5 h-5 mr-2" /> 新增設計專案
      </button>

      <div className="space-y-2">
        <h3 className="text-xs text-white/50 font-black uppercase tracking-widest mb-3 px-2 flex items-center">
          <div className="w-1.5 h-1.5 bg-green-400 rounded-full mr-2"></div> 進行中專案
        </h3>
        {projects.filter(p => p.status === 'active').length === 0 && <p className="text-sm px-2 text-white/40">無進行中專案</p>}
        {projects.filter(p => p.status === 'active').map(p => (
          <button 
            key={p.id}
            onClick={() => setActiveProject(p)}
            className={`w-full text-left p-3 rounded-lg transition-all truncate font-medium border border-transparent ${activeProject?.id === p.id ? `bg-white/10 text-[${ThemeStyles.secondaryText}] border-white/20 shadow-inner` : 'hover:bg-white/5 text-white/80'}`}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="space-y-2 pt-4 border-t border-white/10">
        <h3 className="text-xs text-white/50 font-black uppercase tracking-widest mb-3 px-2 flex items-center">
          <div className="w-1.5 h-1.5 bg-gray-400 rounded-full mr-2"></div> 歷史歸檔
        </h3>
        {projects.filter(p => p.status === 'closed').map(p => (
          <button 
            key={p.id}
            onClick={() => setActiveProject(p)}
            className={`w-full text-left p-3 rounded-lg transition-all truncate font-medium text-sm ${activeProject?.id === p.id ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/5'}`}
          >
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );

  const triggerAddItem = (type) => {
    setFormItemTitle(''); setFormItemLink('');
    setModal({ isOpen: true, type: 'ADD_ITEM', payload: { type } });
  };

  const triggerDelete = (type, itemId) => {
    setModal({ isOpen: true, type: 'CONFIRM', payload: { actionType: 'DELETE_ITEM', type, itemId, message: '確定要刪除此檔案項目嗎？刪除後業主將無法看見。' } });
  };

  if (user.role === 'designer') {
    return (
      <Layout sidebar={<DesignerSidebar />}>
        {!activeProject ? (
          <div className="h-full flex flex-col items-center justify-center animate-in fade-in">
            <div className="bg-white p-10 rounded-3xl shadow-xl text-center max-w-sm">
              <div className={`w-20 h-20 mx-auto rounded-full ${ThemeStyles.primaryBg} flex items-center justify-center mb-6 shadow-inner`}>
                <FolderOpen className={`w-10 h-10 ${ThemeStyles.secondaryText}`} />
              </div>
              <h2 className="text-2xl font-black text-gray-800 mb-2">A41 控制台</h2>
              <p className="text-gray-500 mb-8">請從左側選擇專案進行管理，或建立新專案。</p>
              
              {projects.length === 0 && (
                <button onClick={loadDemoData} className="px-6 py-2 bg-indigo-50 text-indigo-600 rounded-full font-bold text-sm hover:bg-indigo-100 transition-colors border border-indigo-100">
                  載入測試範例資料
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="max-w-6xl mx-auto space-y-6 pb-20 animate-in slide-in-from-bottom-4 duration-300">
            <div className="bg-white rounded-2xl shadow-sm p-6 lg:p-8 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 relative overflow-hidden">
              <div className={`absolute left-0 top-0 w-2 h-full ${activeProject.status === 'closed' ? 'bg-gray-400' : ThemeStyles.primaryBg}`}></div>
              
              <div>
                <h1 className="text-2xl lg:text-3xl font-black text-gray-800 flex items-center gap-3">
                  {activeProject.status === 'closed' && <FolderLock className="w-7 h-7 text-gray-500" />}
                  {activeProject.name}
                </h1>
                <div className="flex items-center gap-4 mt-3 bg-gray-50 inline-flex p-2 rounded-lg border border-gray-100">
                  <span className="text-sm font-bold text-gray-600 flex items-center"><User className="w-4 h-4 mr-1 text-gray-400"/> {activeProject.clientName}</span>
                  <span className="text-gray-300">|</span>
                  <span className="text-sm font-bold text-gray-600 flex items-center"><Phone className="w-4 h-4 mr-1 text-gray-400"/> {activeProject.clientPhone}</span>
                </div>
              </div>
              
              <div className="flex flex-wrap gap-3 w-full lg:w-auto p-4 lg:p-0 bg-gray-50 lg:bg-transparent rounded-xl">
                <select 
                  className={`border-2 p-2.5 rounded-xl font-bold outline-none transition-colors ${activeProject.phase === 'design' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}
                  value={activeProject.phase}
                  onChange={(e) => saveProjectToDB({...activeProject, phase: e.target.value})}
                >
                  <option value="design">📐 階段切換：設計規劃中</option>
                  <option value="construction">🔨 階段切換：工程施工中</option>
                </select>

                <button 
                  onClick={() => saveProjectToDB({...activeProject, status: activeProject.status === 'active' ? 'closed' : 'active'})}
                  className={`px-5 py-2.5 rounded-xl font-bold transition-all shadow-sm ${activeProject.status === 'active' ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-green-500 text-white hover:bg-green-600'}`}
                >
                  {activeProject.status === 'active' ? '關閉專案 (撤銷業主權限)' : '重啟專案'}
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm p-6 lg:p-8">
              <div className="flex justify-between items-center mb-4">
                <h3 className={`text-lg font-black ${ThemeStyles.primaryText} flex items-center`}>
                  <FileText className="w-5 h-5 mr-2 text-[#F8BB72]" /> 專案總覽文字 (業主首頁顯示)
                </h3>
                <span className="text-xs text-gray-400 font-bold bg-gray-100 px-2 py-1 rounded">自動儲存</span>
              </div>
              <textarea 
                className={`w-full h-32 p-4 border-2 rounded-xl focus:ring-0 focus:border-[${ThemeStyles.primaryBg}] outline-none resize-none bg-gray-50 text-gray-700 leading-relaxed font-medium transition-colors`}
                value={activeProject.overview}
                onChange={(e) => {
                  const updated = {...activeProject, overview: e.target.value};
                  setActiveProject(updated); 
                }}
                onBlur={() => saveProjectToDB(activeProject)} 
                placeholder="輸入給業主看的專案描述、設計理念或提醒事項..."
              />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {['meetings', 'drawings', 'logs'].map((type) => (
                <div key={type} className={`bg-white rounded-2xl shadow-sm p-6 flex flex-col ${type==='meetings' ? 'xl:col-span-2' : ''} ${activeProject.phase === 'design' && type === 'logs' ? 'opacity-50 grayscale hover:grayscale-0 transition-all' : ''} ${activeProject.phase === 'construction' && type === 'drawings' ? 'opacity-50 grayscale hover:grayscale-0 transition-all' : ''}`}>
                  <div className="flex justify-between items-center border-b pb-4 mb-4">
                    <h3 className={`text-lg font-black ${ThemeStyles.primaryText} flex items-center`}>
                      {type === 'meetings' && <><Calendar className="w-5 h-5 mr-2 text-[#F8BB72]" /> 會議記錄區</>}
                      {type === 'drawings' && <><Map className="w-5 h-5 mr-2 text-[#F8BB72]" /> 設計圖說區</>}
                      {type === 'logs' && <><Camera className="w-5 h-5 mr-2 text-[#F8BB72]" /> 監工日誌區</>}
                      
                      {activeProject.phase === 'design' && type === 'drawings' && <span className="ml-3 px-2 py-1 bg-indigo-100 text-indigo-700 text-xs rounded-md font-bold">當前重點</span>}
                      {activeProject.phase === 'construction' && type === 'logs' && <span className="ml-3 px-2 py-1 bg-amber-100 text-amber-700 text-xs rounded-md font-bold">當前重點</span>}
                    </h3>
                    <button 
                      onClick={() => triggerAddItem(type)}
                      className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center shadow-sm ${ThemeStyles.secondaryBg} ${ThemeStyles.primaryText} hover:brightness-105 transition-all`}
                    >
                      <Plus className="w-4 h-4 mr-1" /> 新增檔案
                    </button>
                  </div>
                  
                  {activeProject[type].length === 0 ? (
                    <div className="flex-1 flex items-center justify-center py-10 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                      <p className="text-gray-400 font-medium">尚未新增資料</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto flex-1">
                      <table className="w-full text-left border-collapse min-w-[500px]">
                        <thead>
                          <tr className="text-gray-400 text-sm border-b">
                            <th className="pb-3 font-bold w-1/3">標題</th>
                            <th className="pb-3 font-bold">NAS 連結</th>
                            <th className="pb-3 font-bold text-center">回簽狀態</th>
                            <th className="pb-3 font-bold text-right">管理</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {activeProject[type].map(item => (
                            <tr key={item.id} className="hover:bg-gray-50 transition-colors group">
                              <td className="py-4 pr-2">
                                <p className="font-bold text-gray-800 line-clamp-1">{item.title}</p>
                                <p className="text-xs text-gray-400 mt-1">{item.date}</p>
                              </td>
                              <td className="py-4 pr-2">
                                <a href={item.nasLink} target="_blank" rel="noreferrer" className="inline-flex items-center text-blue-600 hover:text-blue-800 bg-blue-50 px-2 py-1 rounded text-sm max-w-[150px] truncate transition-colors">
                                  <LinkIcon className="w-3 h-3 mr-1 flex-shrink-0" /> 開啟
                                </a>
                              </td>
                              <td className="py-4 text-center">
                                {item.signed ? (
                                  <div className="inline-flex flex-col items-center">
                                    <span className="inline-flex items-center text-xs font-bold text-green-700 bg-green-100 px-2.5 py-1 rounded-full border border-green-200">
                                      <Check className="w-3 h-3 mr-1" strokeWidth={3} /> 已簽名
                                    </span>
                                    <span className="text-[10px] text-gray-400 mt-1">{item.signDate.split(' ')[0]}</span>
                                  </div>
                                ) : (
                                  <span className="inline-block text-xs font-bold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">等待中</span>
                                )}
                              </td>
                              <td className="py-4 text-right">
                                <button onClick={() => triggerDelete(type, item.id)} className="text-red-400 hover:text-red-600 text-sm font-bold bg-white px-3 py-1 rounded shadow-sm border border-gray-100 opacity-0 group-hover:opacity-100 transition-opacity">
                                  刪除
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
            
            <div className="mt-8 pt-8 border-t border-gray-200 flex justify-end">
                <button 
                  onClick={() => {
                    const ans = window.prompt(`請輸入 "${activeProject.name}" 來確認刪除整個專案`);
                    if(ans === activeProject.name) {
                      deleteProjectFromDB(activeProject.id);
                    }
                  }}
                  className="text-gray-400 hover:text-red-500 text-sm font-bold underline transition-colors"
                >
                  永久刪除此專案
                </button>
            </div>
          </div>
        )}
      </Layout>
    );
  }

  return null;
}
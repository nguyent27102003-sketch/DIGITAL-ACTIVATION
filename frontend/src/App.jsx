import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  Upload, 
  Play, 
  Pause, 
  Square, 
  RotateCcw, 
  FileSpreadsheet, 
  Settings, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Eye, 
  Download, 
  Image as ImageIcon,
  Key,
  ShieldCheck,
  RefreshCw,
  UserCheck,
  UserPlus,
  Users,
  LogOut,
  Lock,
  Mail,
  User
} from 'lucide-react';

export default function App() {
  const [configStatus, setConfigStatus] = useState({ configured: false, maskedKey: '', isFacebookConnected: false });
  const [step, setStep] = useState(1); // 1: Setup, 2: Mapping, 3: Running & Review
  
  // Auth & Admin State
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem('fbeval_user');
      return saved ? JSON.parse(saved) : null;
    } catch (_) { return null; }
  });
  const [authError, setAuthError] = useState('');
  const [authSuccess, setAuthSuccess] = useState('');
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);

  // Admin Management Modal State
  const [showAdminUsers, setShowAdminUsers] = useState(false);
  const [adminTab, setAdminTab] = useState('pending'); // 'pending' | 'active' | 'rejected' | 'suspended' | 'all'
  const [userList, setUserList] = useState([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  
  // Modal action states for Admin
  const [actionModal, setActionModal] = useState(null); // { type: 'approve'|'reject'|'suspend'|'revoke', user: Object }
  const [actionRole, setActionRole] = useState('OPERATOR');
  const [actionReason, setActionReason] = useState('');

  // Campaign & Job State
  const [ruleConfirmed, setRuleConfirmed] = useState(true);
  const [posterFile, setPosterFile] = useState(null);
  const [isExtractingPoster, setIsExtractingPoster] = useState(false);
  const [campaignName, setCampaignName] = useState('Chiến Dịch Activation Mới');
  const [rules, setRules] = useState({
    minVideoDurationSeconds: 30,
    minLivestreamDurationSeconds: 900,
    requiredHashtags: ['#Activation', '#FBEval'],
    requiredTags: ['@FanpageOfficial'],
    hashtags: ['#Activation', '#FBEval'],
    fanpageTags: ['@FanpageOfficial'],
    productNames: ['Sản Phẩm A'],
    allowPhotosForLivestream: false
  });
  const [excelFile, setExcelFile] = useState(null);
  const [excelFileId, setExcelFileId] = useState(null);
  const [isInspectingExcel, setIsInspectingExcel] = useState(false);
  const [inspectionSheets, setInspectionSheets] = useState([]);
  const [selectedSheetIndex, setSelectedSheetIndex] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  
  // AI Config State
  const [aiProvider, setAiProvider] = useState('gemini');
  const [geminiApiKeyInput, setGeminiApiKeyInput] = useState('');
  const [openaiApiKeyInput, setOpenaiApiKeyInput] = useState('');
  const [nineRouterApiKeyInput, setNineRouterApiKeyInput] = useState('');
  const [nineRouterBaseUrlInput, setNineRouterBaseUrlInput] = useState('https://api.9router.com/v1');
  const [aiTestStatus, setAiTestStatus] = useState(null);
  const [isTestingAi, setIsTestingAi] = useState(false);
  const [isSavingAiConfig, setIsSavingAiConfig] = useState(false);
  const [configSuccessMsg, setConfigSuccessMsg] = useState('');

  // Running Job & Review State
  const [activeJobId, setActiveJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState('IDLE');
  const [jobProgress, setJobProgress] = useState({ current: 0, total: 0 });
  const [jobItems, setJobItems] = useState([]);
  const [selectedReviewItem, setSelectedReviewItem] = useState(null);
  const [overrideResult, setOverrideResult] = useState('PASSED');
  const [overrideReason, setOverrideReason] = useState('');

  // Fetch session & config status on startup
  useEffect(() => {
    fetchConfigStatus();
    checkCurrentUserSession();
  }, []);

  useEffect(() => {
    if (showAdminUsers && currentUser?.role === 'SUPER_ADMIN') {
      fetchUserList(adminTab);
    }
  }, [showAdminUsers, adminTab]);

  const checkCurrentUserSession = async () => {
    if (window.location.search.includes('logged_out=1')) {
      setCurrentUser(null);
      localStorage.removeItem('fbeval_user');
      return;
    }
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (data.success) {
        setCurrentUser(data.user);
        localStorage.setItem('fbeval_user', JSON.stringify(data.user));
      } else {
        setCurrentUser(null);
        localStorage.removeItem('fbeval_user');
      }
    } catch (_) {}
  };

  const fetchConfigStatus = async () => {
    try {
      const res = await fetch('/api/config-status');
      const data = await res.json();
      setConfigStatus(data);
      if (data.provider) setAiProvider(data.provider);
      if (data.nineRouterBaseUrl) setNineRouterBaseUrlInput(data.nineRouterBaseUrl);
    } catch (e) {
      console.error('Failed to fetch config status', e);
    }
  };

  const switchProvider = async (newProvider) => {
    setAiProvider(newProvider);
    try {
      await fetch('/api/save-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: newProvider })
      });
      fetchConfigStatus();
    } catch (e) {
      console.error('Failed to switch provider:', e);
    }
  };

  const handleSaveAiConfig = async () => {
    setIsSavingAiConfig(true);
    setConfigSuccessMsg('');
    try {
      const res = await fetch('/api/save-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: aiProvider,
          geminiApiKey: geminiApiKeyInput,
          openaiApiKey: openaiApiKeyInput,
          nineRouterApiKey: nineRouterApiKeyInput,
          nineRouterBaseUrl: nineRouterBaseUrlInput
        })
      });
      const data = await res.json();
      if (data.success) {
        setConfigSuccessMsg('Đã lưu cấu hình AI Provider thành công!');
        fetchConfigStatus();
      } else {
        alert(`Lỗi: ${data.error}`);
      }
    } catch (err) {
      alert(`Lỗi lưu cấu hình: ${err.message}`);
    } finally {
      setIsSavingAiConfig(false);
    }
  };

  const handleTestAiConfig = async () => {
    setIsTestingAi(true);
    setAiTestStatus(null);
    try {
      const res = await fetch('/api/test-ai-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: aiProvider,
          geminiApiKey: geminiApiKeyInput || undefined,
          openaiApiKey: openaiApiKeyInput || undefined,
          nineRouterApiKey: nineRouterApiKeyInput || undefined,
          nineRouterBaseUrl: nineRouterBaseUrlInput
        })
      });
      const data = await res.json();
      setAiTestStatus(data);
    } catch (err) {
      setAiTestStatus({ status: 'OFFLINE', reason: err.message });
    } finally {
      setIsTestingAi(false);
    }
  };

  const handleGoogleSignIn = (mockEmail = null) => {
    setAuthError('');
    if (configStatus?.googleConfigured && !mockEmail) {
      window.location.href = '/api/auth/google';
      return;
    }
    let targetEmail = mockEmail;
    if (!targetEmail) {
      targetEmail = window.prompt('Nhập Gmail đăng nhập (Ví dụ: nq.thien27@gmail.com để chọn Super Admin, hoặc gmail khác để thử nghiệm Phê Duyệt):', 'nq.thien27@gmail.com');
      if (!targetEmail) return;
    }
    fetch('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: targetEmail })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        setCurrentUser(data.user);
        localStorage.setItem('fbeval_user', JSON.stringify(data.user));
        window.location.href = '/';
      } else {
        setAuthError(data.error);
      }
    })
    .catch(err => setAuthError(err.message));
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (_) {}
    setCurrentUser(null);
    localStorage.removeItem('fbeval_user');
    window.location.href = '/?logged_out=1';
  };

  const fetchUserList = async (tab = 'pending') => {
    setIsLoadingUsers(true);
    try {
      const res = await fetch(`/api/admin/users?status=${tab}`);
      const data = await res.json();
      if (data.success) {
        setUserList(data.users);
      }
    } catch (e) {
      console.error('Failed to fetch users', e);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const handleExecuteAdminAction = async () => {
    if (!actionModal) return;
    const { type, user } = actionModal;

    try {
      let endpoint = '';
      let bodyData = {};

      if (type === 'approve') {
        endpoint = `/api/admin/users/${user.id}/approve`;
        bodyData = { role: actionRole };
      } else if (type === 'reject') {
        if (!actionReason.trim()) return alert('Vui lòng nhập lý do từ chối.');
        endpoint = `/api/admin/users/${user.id}/reject`;
        bodyData = { reason: actionReason };
      } else if (type === 'suspend') {
        if (!actionReason.trim()) return alert('Vui lòng nhập lý do tạm khóa.');
        endpoint = `/api/admin/users/${user.id}/suspend`;
        bodyData = { reason: actionReason };
      } else if (type === 'revoke') {
        if (!actionReason.trim()) return alert('Vui lòng nhập lý do thu hồi quyền.');
        endpoint = `/api/admin/users/${user.id}/revoke`;
        bodyData = { reason: actionReason };
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData)
      });
      const data = await res.json();

      if (data.success) {
        alert(data.message);
        setActionModal(null);
        setActionReason('');
        fetchUserList(adminTab);
      } else {
        alert('Lỗi: ' + data.error);
      }
    } catch (err) {
      alert('Lỗi kết nối: ' + err.message);
    }
  };

  const pendingCount = userList.filter(u => u.status === 'PENDING').length;

  const handleExtractPosterRules = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPosterFile(file);
    setIsExtractingPoster(true);

    const formData = new FormData();
    formData.append('poster', file);

    try {
      const res = await fetch('/api/campaigns/extract-rules', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        setRules(data.rules);
        setCampaignName(data.rules.campaignName || campaignName);
        alert('AI đã trích xuất thành công thể lệ từ Poster. Vui lòng kiểm tra và xác nhận lại bộ luật.');
      } else {
        alert('Lỗi: ' + data.error);
        if (data.error && data.error.includes('Chưa cấu hình API Key')) {
          setShowSettings(true);
        }
      }
    } catch (err) {
      alert('Không thể bóc tách Poster: ' + err.message);
    } finally {
      setIsExtractingPoster(false);
    }
  };

  const handleUploadExcel = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setExcelFile(file);
    setIsInspectingExcel(true);

    const formData = new FormData();
    formData.append('excel', file);

    try {
      const res = await fetch('/api/excel/inspect', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        setExcelFileId(data.excelFileId);
        setInspectionSheets(data.sheets);
        setStep(2);
      } else {
        alert('Lỗi inspect Excel: ' + data.error);
      }
    } catch (err) {
      alert('Lỗi upload Excel: ' + err.message);
    } finally {
      setIsInspectingExcel(false);
    }
  };

  const handleConfirmMappingAndCreateJob = async () => {
    if (!excelFileId || inspectionSheets.length === 0) return;

    // 1. Create Campaign
    const campRes = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: campaignName, rules })
    });
    const campData = await campRes.json();
    if (!campData.success) return alert(campData.error);

    // 2. Confirm Mapping
    const mappingConfig = { sheets: inspectionSheets };
    const mapRes = await fetch('/api/excel/confirm-mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ excelFileId, mappingConfig })
    });
    const mapData = await mapRes.json();
    if (!mapData.success) return alert(mapData.error);

    // 3. Create Job
    const jobRes = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaignId: campData.campaignId,
        excelFileId,
        mappingId: mapData.mappingId,
        mappingConfig
      })
    });
    const jobData = await jobRes.json();
    if (jobData.success) {
      setActiveJobId(jobData.jobId);
      setJobProgress({ current: 0, total: jobData.totalItems });
      setStep(3);
      fetchJobDetails(jobData.jobId);
    } else {
      alert('Lỗi tạo Job: ' + jobData.error);
    }
  };

  const handleStartJob = async () => {
    if (!activeJobId) return;
    const res = await fetch(`/api/jobs/${activeJobId}/start`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      setJobStatus('RUNNING');
    }
  };

  const handlePauseJob = async () => {
    if (!activeJobId) return;
    await fetch(`/api/jobs/${activeJobId}/pause`, { method: 'POST' });
    setJobStatus('PAUSED');
  };

  const handleResumeJob = async () => {
    if (!activeJobId) return;
    await fetch(`/api/jobs/${activeJobId}/resume`, { method: 'POST' });
    setJobStatus('RUNNING');
  };

  const handleCancelJob = async () => {
    if (!activeJobId) return;
    await fetch(`/api/jobs/${activeJobId}/cancel`, { method: 'POST' });
    setJobStatus('CANCELLED');
  };

  const fetchJobDetails = async (jobId) => {
    try {
      const jobRes = await fetch(`/api/jobs/${jobId}`);
      const jobData = await jobRes.json();
      setJobStatus(jobData.status);
      setJobProgress({ current: jobData.processed_items, total: jobData.total_items });

      const itemsRes = await fetch(`/api/jobs/${jobId}/items`);
      const itemsData = await itemsRes.json();
      setJobItems(itemsData);
    } catch (e) {
      console.error('Failed to fetch job details', e);
    }
  };

  const handleSaveManualReview = async () => {
    if (!selectedReviewItem || !overrideReason) return alert('Vui lòng nhập lý do điều chỉnh.');

    const res = await fetch(`/api/job-items/${selectedReviewItem.id}/review`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newResult: overrideResult, reason: overrideReason })
    });
    const data = await res.json();
    if (data.success) {
      setSelectedReviewItem(null);
      setOverrideReason('');
      fetchJobDetails(activeJobId);
    } else {
      alert('Lỗi: ' + data.error);
    }
  };

  const handleExportZip = async () => {
    if (!activeJobId) return;
    const res = await fetch(`/api/jobs/${activeJobId}/export`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      window.open(data.downloadUrl, '_blank');
    } else {
      alert('Lỗi xuất file package: ' + data.error);
    }
  };

  const currentSheet = inspectionSheets[selectedSheetIndex] || {};
  const pendingUsersCount = (userList || []).filter(u => u.approval_status === 'PENDING' || u.approvalStatus === 'PENDING').length;

  const isUserPending = currentUser && (
    currentUser.approvalStatus === 'PENDING' || 
    currentUser.approval_status === 'PENDING' || 
    currentUser.accountStatus === 'PENDING_APPROVAL' || 
    currentUser.account_status === 'PENDING_APPROVAL'
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* 1. AUTH SCREEN IF NOT LOGGED IN */}
      {!currentUser && (
        <div className="fixed inset-0 z-50 bg-slate-950 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-8 space-y-6 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/10 rounded-full blur-3xl" />
            
            <div className="text-center space-y-2">
              <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center font-bold text-white text-xl mx-auto shadow-xl shadow-blue-600/30">
                DA
              </div>
              <h2 className="text-xl font-bold text-white tracking-wide">FBEVAL ACTIVATION V2.1</h2>
              <p className="text-xs text-slate-400">Hệ thống phân quyền & Phê duyệt Google Auth</p>
            </div>

            <div className="bg-blue-950/40 border border-blue-800/50 rounded-2xl p-4 text-xs text-blue-300 flex items-start space-x-3">
              <ShieldCheck className="w-6 h-6 text-blue-400 shrink-0 mt-0.5" />
              <div>
                <strong className="block text-white text-sm">Chủ sở hữu & Phê duyệt duy nhất:</strong>
                <span className="text-slate-300">Nguyễn Quang Thiện (<span className="text-blue-300 font-mono underline font-bold">nq.thien27@gmail.com</span>). Mọi tài khoản mới qua Google bắt buộc phải được phê duyệt trước khi truy cập.</span>
              </div>
            </div>

            {authError && (
              <div className="bg-rose-950/60 border border-rose-800 text-rose-300 text-xs p-3 rounded-xl flex items-start space-x-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{authError}</span>
              </div>
            )}

            {/* Google Sign-In Button */}
            <div className="space-y-3 pt-2">
              <button
                onClick={() => handleGoogleSignIn()}
                className="w-full bg-white hover:bg-slate-100 text-slate-900 font-bold py-3 px-4 rounded-xl shadow-lg transition flex items-center justify-center space-x-3 border border-slate-300"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                </svg>
                <span>Đăng Nhập bằng Google</span>
              </button>

              {/* Quick Dev/Test Login Options */}
              <div className="pt-4 border-t border-slate-800 text-center">
                <p className="text-[11px] text-slate-500 mb-2">Simulate Sign-In (Dev & Testing):</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleGoogleSignIn('nq.thien27@gmail.com')}
                    className="flex-1 py-1.5 px-2 bg-purple-950/60 hover:bg-purple-900/60 border border-purple-800 text-purple-300 text-[11px] rounded-lg transition"
                  >
                    👑 Login Owner (Super Admin)
                  </button>
                  <button
                    onClick={() => handleGoogleSignIn(`user_${Date.now()}@gmail.com`)}
                    className="flex-1 py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] rounded-lg transition"
                  >
                    👤 Login New User (Pending)
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. PENDING APPROVAL OVERLAY IF USER IS PENDING */}
      {isUserPending && (
        <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-amber-800/60 rounded-3xl max-w-md w-full p-8 text-center space-y-5 shadow-2xl relative overflow-hidden">
            <div className="w-16 h-16 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center justify-center mx-auto text-amber-400">
              <Lock className="w-8 h-8 animate-pulse" />
            </div>
            
            <div className="space-y-2">
              <h3 className="text-lg font-bold text-white">Yêu cầu sử dụng FBEval đã được gửi.</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Tài khoản <strong className="text-blue-400">{currentUser.email}</strong> đang chờ quản trị viên hệ thống (<span className="text-amber-300 font-mono">nq.thien27@gmail.com</span>) phê duyệt.
              </p>
              <p className="text-xs text-slate-400">
                Bạn sẽ có thể truy cập toàn bộ tính năng FBEval ngay sau khi được cấp quyền.
              </p>
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1">
              <div>Trạng thái phê duyệt: <span className="text-amber-400 font-bold">⏳ PENDING_APPROVAL</span></div>
              <div>Vai trò dự kiến: <span className="text-slate-200 font-bold">{currentUser.role || 'VIEWER'}</span></div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={checkCurrentUserSession}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow transition"
              >
                Kiểm Tra Lại Trạng Thái
              </button>
              <button
                onClick={handleLogout}
                className="py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl transition"
              >
                Đăng Xuất
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. SETTINGS & AI PROVIDER MODAL */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 space-y-6 shadow-2xl relative overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-800 pb-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <Settings className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Cấu Hình AI Provider & API Keys</h3>
                  <p className="text-xs text-slate-400">Hỗ trợ Gemini, ChatGPT (OpenAI) & 9Router Gateway</p>
                </div>
              </div>
              <button 
                onClick={() => setShowSettings(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
              >
                ✕
              </button>
            </div>

            {/* AI Provider Selection */}
            <div className="space-y-3">
              <label className="text-xs font-bold text-slate-300 block">Chọn Provider AI Đánh Giá Bài Viết:</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setAiProvider('gemini')}
                  className={`p-3 rounded-xl border text-left flex flex-col justify-between transition ${
                    aiProvider === 'gemini' 
                      ? 'bg-blue-950/60 border-blue-500 text-blue-300 shadow-md' 
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <span className="font-bold text-xs">Google Gemini</span>
                  <span className="text-[10px] opacity-75">Gemini 1.5 Flash</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAiProvider('openai')}
                  className={`p-3 rounded-xl border text-left flex flex-col justify-between transition ${
                    aiProvider === 'openai' 
                      ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300 shadow-md' 
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <span className="font-bold text-xs">ChatGPT / OpenAI</span>
                  <span className="text-[10px] opacity-75">GPT-4o Vision</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAiProvider('9router')}
                  className={`p-3 rounded-xl border text-left flex flex-col justify-between transition ${
                    aiProvider === '9router' 
                      ? 'bg-purple-950/60 border-purple-500 text-purple-300 shadow-md' 
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <span className="font-bold text-xs">9Router Gateway</span>
                  <span className="text-[10px] opacity-75">Multi-Model Proxy</span>
                </button>
              </div>
            </div>

            {/* API Key Inputs */}
            <div className="space-y-4 pt-2 border-t border-slate-800">
              {/* Gemini Key Input */}
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="text-xs text-slate-300 font-medium">Google Gemini API Key:</label>
                  {configStatus.maskedGeminiKey && (
                    <span className="text-[10px] text-emerald-400 font-mono">Đã lưu: {configStatus.maskedGeminiKey}</span>
                  )}
                </div>
                <input
                  type="password"
                  value={geminiApiKeyInput}
                  onChange={(e) => setGeminiApiKeyInput(e.target.value)}
                  placeholder={configStatus.maskedGeminiKey ? "Để trống nếu không đổi API Key..." : "Dán Gemini API Key từ Google AI Studio..."}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* OpenAI Key Input */}
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="text-xs text-slate-300 font-medium">ChatGPT / OpenAI API Key:</label>
                  {configStatus.maskedOpenAIKey && (
                    <span className="text-[10px] text-emerald-400 font-mono">Đã lưu: {configStatus.maskedOpenAIKey}</span>
                  )}
                </div>
                <input
                  type="password"
                  value={openaiApiKeyInput}
                  onChange={(e) => setOpenaiApiKeyInput(e.target.value)}
                  placeholder={configStatus.maskedOpenAIKey ? "Để trống nếu không đổi API Key..." : "Dán OpenAI API Key (sk-...)"}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* 9Router Key Input & Base URL */}
              <div className="space-y-3 p-3 bg-purple-950/20 border border-purple-800/40 rounded-2xl">
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-xs text-purple-300 font-medium">9Router API Key:</label>
                    {configStatus.masked9RouterKey && (
                      <span className="text-[10px] text-purple-400 font-mono">Đã lưu: {configStatus.masked9RouterKey}</span>
                    )}
                  </div>
                  <input
                    type="password"
                    value={nineRouterApiKeyInput}
                    onChange={(e) => setNineRouterApiKeyInput(e.target.value)}
                    placeholder={configStatus.masked9RouterKey ? "Để trống nếu không đổi API Key..." : "Dán 9Router Gateway API Key..."}
                    className="w-full bg-slate-950 border border-purple-900/60 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-purple-300 font-medium">9Router Base URL Endpoint:</label>
                  <input
                    type="text"
                    value={nineRouterBaseUrlInput}
                    onChange={(e) => setNineRouterBaseUrlInput(e.target.value)}
                    placeholder="https://api.9router.com/v1"
                    className="w-full bg-slate-950 border border-purple-900/60 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Test Status Output */}
            {aiTestStatus && (
              <div className={`p-3 rounded-xl border text-xs flex items-center space-x-2 ${
                aiTestStatus.status === 'ONLINE' 
                  ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300' 
                  : 'bg-rose-950/60 border-rose-800 text-rose-300'
              }`}>
                <Sparkles className="w-4 h-4 shrink-0" />
                <span>{aiTestStatus.message || aiTestStatus.reason}</span>
              </div>
            )}

            {configSuccessMsg && (
              <div className="p-3 bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs rounded-xl flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{configSuccessMsg}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handleTestAiConfig}
                disabled={isTestingAi}
                className="flex-1 py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl border border-slate-700 transition flex items-center justify-center space-x-2"
              >
                <RefreshCw className={`w-4 h-4 ${isTestingAi ? 'animate-spin' : ''}`} />
                <span>{isTestingAi ? 'Đang kiểm tra...' : '🧪 Test Kết Nối AI'}</span>
              </button>

              <button
                type="button"
                onClick={handleSaveAiConfig}
                disabled={isSavingAiConfig}
                className="flex-1 py-2.5 px-3 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-blue-600/30 transition flex items-center justify-center space-x-2"
              >
                <span>{isSavingAiConfig ? 'Đang lưu...' : '💾 Lưu Cấu Hình AI'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header Bar */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur px-6 py-4 flex justify-between items-center sticky top-0 z-40">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-600/30">
            DA
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-wide text-white">FBEVAL ACTIVATION</h1>
            <p className="text-xs text-slate-400">UNIVERSAL CAMPAIGN EVALUATOR V2.1</p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          {(currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'ADMIN') && (
            <button
              onClick={() => { setShowAdminUsers(true); fetchUserList(); }}
              className="relative flex items-center space-x-2 text-xs bg-indigo-950/80 text-indigo-300 hover:bg-indigo-900/80 px-3 py-1.5 rounded-lg border border-indigo-800 transition"
            >
              <Users className="w-4 h-4 text-indigo-400" />
              <span>Duyệt Người Dùng</span>
              {pendingUsersCount > 0 && (
                <span className="bg-amber-500 text-slate-950 font-bold px-1.5 py-0.5 rounded-full text-[10px] animate-pulse">
                  {pendingUsersCount}
                </span>
              )}
            </button>
          )}

          {/* Quick AI Provider Switcher Bar */}
          <div className="hidden md:flex items-center space-x-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800 text-xs">
            <span className="text-[11px] text-slate-400 font-semibold px-2">AI Engine:</span>
            
            <button
              onClick={() => switchProvider('gemini')}
              className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition flex items-center space-x-1.5 ${
                aiProvider === 'gemini' 
                  ? 'bg-blue-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
              title="Chuyển sang Google Gemini"
            >
              <span>🔵 Gemini</span>
              {configStatus?.geminiConfigured && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>}
            </button>

            <button
              onClick={() => switchProvider('openai')}
              className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition flex items-center space-x-1.5 ${
                aiProvider === 'openai' 
                  ? 'bg-emerald-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
              title="Chuyển sang ChatGPT / OpenAI"
            >
              <span>🟢 ChatGPT</span>
              {configStatus?.openaiConfigured && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>}
            </button>

            <button
              onClick={() => switchProvider('9router')}
              className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition flex items-center space-x-1.5 ${
                aiProvider === '9router' 
                  ? 'bg-purple-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
              title="Chuyển sang 9Router Gateway"
            >
              <span>🟣 9Router</span>
              {configStatus?.nineRouterConfigured && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>}
            </button>
          </div>

          <div className="flex items-center space-x-2 text-xs bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700">
            <User className="w-4 h-4 text-blue-400" />
            <span><strong className="text-slate-200">{currentUser?.fullName || currentUser?.email}</strong> ({currentUser?.role})</span>
          </div>

          <button
            onClick={handleLogout}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800 text-xs transition font-medium"
            title="Đăng xuất khỏi hệ thống"
          >
            <LogOut className="w-4 h-4" />
            <span>Đăng Xuất</span>
          </button>

          <button 
            onClick={() => setShowSettings(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-md transition"
            title="Cài đặt Cấu hình AI API Keys"
          >
            <Settings className="w-4 h-4 text-white" />
            <span>⚙️ Cài Đặt AI</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full space-y-6">

        {/* STEP 1: Campaign Rules & Excel File Upload */}
        {step === 1 && (
          <div className="space-y-6 animate-fade-in">
            {/* Poster Rule Banner */}
            <div className="bg-gradient-to-r from-blue-900/40 via-indigo-900/30 to-purple-900/40 border border-blue-800/50 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl">
              <div className="space-y-2">
                <div className="flex items-center space-x-2 text-blue-400 text-sm font-semibold">
                  <Sparkles className="w-5 h-5" />
                  <span>AI POSTER RULE EXTRACTOR</span>
                </div>
                <h2 className="text-xl font-bold text-white">Tải Ảnh Poster Thể Lệ Hàng Tháng</h2>
                <p className="text-sm text-slate-300 max-w-2xl">
                  AI sẽ tự động đọc thể lệ chương trình, trích xuất điều kiện ĐK1 (Thời lượng Livestream/Video) và ĐK2 (Hashtag & Tag Fanpage bắt buộc).
                </p>
              </div>

              <div className="flex items-center space-x-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowSettings(true)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium px-4 py-3 rounded-xl flex items-center space-x-2 border border-slate-700 text-xs transition"
                >
                  <Settings className="w-4 h-4 text-indigo-400" />
                  <span>Cấu Hình AI Key</span>
                </button>

                <label className="cursor-pointer bg-blue-600 hover:bg-blue-500 text-white font-medium px-5 py-3 rounded-xl flex items-center space-x-2 shadow-lg shadow-blue-600/30 transition">
                  <Upload className="w-5 h-5" />
                  <span>{isExtractingPoster ? 'Đang đọc Poster...' : 'Chọn ảnh Poster'}</span>
                  <input type="file" accept="image/*" onChange={handleExtractPosterRules} className="hidden" />
                </label>
              </div>
            </div>

            {/* Campaign Rule Confirmation Box */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
              <div className="flex justify-between items-center border-b border-slate-800 pb-4">
                <h3 className="font-bold text-lg text-white">1. Bộ Luật & Tiêu Chí Đánh Giá Cho Chiến Dịch</h3>
                <label className="flex items-center space-x-2 text-sm text-emerald-400 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={ruleConfirmed} 
                    onChange={(e) => setRuleConfirmed(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-600"
                  />
                  <span>Xác nhận bộ luật này</span>
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Tên Chương Trình / Chiến Dịch</label>
                  <input 
                    type="text" 
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Dòng Sản Phẩm Được Duyệt</label>
                  <input 
                    type="text" 
                    value={(rules?.productNames || []).join(', ')}
                    onChange={(e) => setRules({ ...rules, productNames: e.target.value.split(',').map(s => s.trim()) })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Hashtag Bắt Buộc (ĐK2)</label>
                  <input 
                    type="text" 
                    value={(rules?.requiredHashtags || rules?.hashtags || []).join(', ')}
                    onChange={(e) => setRules({ ...rules, requiredHashtags: e.target.value.split(',').map(s => s.trim()), hashtags: e.target.value.split(',').map(s => s.trim()) })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Tag Fanpage Bắt Buộc (ĐK2)</label>
                  <input 
                    type="text" 
                    value={(rules?.requiredTags || rules?.fanpageTags || []).map(t => typeof t === 'string' ? t : (t?.displayName || t?.name || '')).join(', ')}
                    onChange={(e) => setRules({ ...rules, requiredTags: e.target.value.split(',').map(s => s.trim()), fanpageTags: e.target.value.split(',').map(s => s.trim()) })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Upload Excel Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-4 shadow-xl">
              <div className="w-16 h-16 rounded-2xl bg-emerald-950/60 border border-emerald-800/50 flex items-center justify-center mx-auto text-emerald-400">
                <FileSpreadsheet className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-lg text-white">2. Tải Nạp File Excel Danh Sách Bài Viết</h3>
                <p className="text-sm text-slate-400">
                  Hệ thống tự động lọc danh sách link bài viết và duy trì nguyên vẹn công thức, định dạng của file Excel gốc.
                </p>
              </div>

              <label className="cursor-pointer inline-flex bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-6 py-3 rounded-xl items-center space-x-2 shadow-lg shadow-emerald-600/30 transition">
                <Upload className="w-5 h-5" />
                <span>{isInspectingExcel ? 'Đang kiểm tra file Excel...' : 'Tải lên File Excel Tracking'}</span>
                <input type="file" accept=".xlsx,.xls" onChange={handleUploadExcel} className="hidden" />
              </label>
            </div>
          </div>
        )}

        {/* STEP 2: Interactive Excel Column Mapping Inspection */}
        {step === 2 && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 animate-fade-in shadow-xl">
            <div className="flex justify-between items-center border-b border-slate-800 pb-4">
              <div>
                <h2 className="font-bold text-lg text-white">Xác Nhận Cấu Trúc File Excel & Mapping Cột</h2>
                <p className="text-xs text-slate-400">Kiểm tra thông tin các Sheet và vị trí cột nhận diện trước khi khởi tạo Job.</p>
              </div>
              <button 
                onClick={() => setStep(1)} 
                className="text-xs text-slate-400 hover:text-white px-3 py-1.5 bg-slate-800 rounded-lg"
              >
                Quay lại
              </button>
            </div>

            <div className="flex space-x-2 border-b border-slate-800 pb-2">
              {inspectionSheets.map((sh, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelectedSheetIndex(idx)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
                    selectedSheetIndex === idx ? 'bg-blue-600 text-white shadow-lg' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {sh.sheetName} ({sh.mappingType})
                </button>
              ))}
            </div>

            <div className="space-y-4 bg-slate-950 p-4 rounded-xl border border-slate-800">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                <div><span className="text-slate-400">Header Row:</span> <strong className="text-white">Dòng {currentSheet.headerRow}</strong></div>
                <div><span className="text-slate-400">Dữ liệu bắt đầu:</span> <strong className="text-white">Dòng {currentSheet.dataStartRow}</strong></div>
                <div><span className="text-slate-400">Loại cấu trúc:</span> <strong className="text-white">{currentSheet.mappingType}</strong></div>
                <div><span className="text-slate-400">Số dòng detected:</span> <strong className="text-white">{currentSheet.rowCount}</strong></div>
              </div>

              <div className="border-t border-slate-800 pt-4">
                <h4 className="font-semibold text-sm text-slate-300 mb-2">Các Cột Nhận Diện Từ Tiêu Đề File Excel Gốc:</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                  {Object.entries(currentSheet.columnsMapping || {}).map(([key, col]) => {
                    const excelHeaderText = currentSheet.rawHeaders?.[col] || key;
                    return (
                      <div key={key} className="bg-slate-900 p-3 rounded-xl border border-slate-800 flex justify-between items-center gap-2">
                        <div className="overflow-hidden truncate">
                          <span className="text-slate-200 font-medium block truncate" title={excelHeaderText}>"{excelHeaderText}"</span>
                          <span className="text-slate-500 font-mono text-[10px]">({key})</span>
                        </div>
                        <strong className="text-blue-400 font-mono bg-blue-950/80 px-2 py-1 rounded border border-blue-800/60 shrink-0">Cột {col}</strong>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <button
              onClick={handleConfirmMappingAndCreateJob}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-blue-600/30 transition flex justify-center items-center space-x-2"
            >
              <CheckCircle2 className="w-5 h-5" />
              <span>Xác Nhận Mapping & Tạo Tiến Trình Đánh Giá</span>
            </button>
          </div>
        )}

        {/* STEP 3: Realtime Dashboard & Manual Review Console */}
        {step === 3 && (
          <div className="space-y-6 animate-fade-in">
            {/* Execution Control Panel */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col md:flex-row justify-between items-center gap-4 shadow-xl">
              <div>
                <div className="flex items-center space-x-3">
                  <span className={`w-3 h-3 rounded-full ${
                    jobStatus === 'RUNNING' ? 'bg-emerald-400 animate-ping' : (jobStatus === 'PAUSED' ? 'bg-amber-400' : 'bg-slate-500')
                  }`} />
                  <h2 className="font-bold text-lg text-white">Trạng Thái Job: <span className="text-blue-400">{jobStatus}</span></h2>
                </div>
                <p className="text-xs text-slate-400 mt-1">Đã xử lý {jobProgress.current} / {jobProgress.total} bài viết</p>
              </div>

              <div className="flex items-center space-x-3">
                {jobStatus === 'READY' && (
                  <button onClick={handleStartJob} className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-4 py-2.5 rounded-xl flex items-center space-x-2 shadow-lg shadow-emerald-600/30">
                    <Play className="w-4 h-4" /> <span>Bắt đầu</span>
                  </button>
                )}
                {jobStatus === 'RUNNING' && (
                  <button onClick={handlePauseJob} className="bg-amber-600 hover:bg-amber-500 text-white font-medium px-4 py-2.5 rounded-xl flex items-center space-x-2">
                    <Pause className="w-4 h-4" /> <span>Tạm dừng</span>
                  </button>
                )}
                {jobStatus === 'PAUSED' && (
                  <button onClick={handleResumeJob} className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-4 py-2.5 rounded-xl flex items-center space-x-2">
                    <Play className="w-4 h-4" /> <span>Tiếp tục</span>
                  </button>
                )}
                {(jobStatus === 'RUNNING' || jobStatus === 'PAUSED') && (
                  <button onClick={handleCancelJob} className="bg-rose-600 hover:bg-rose-500 text-white font-medium px-4 py-2.5 rounded-xl flex items-center space-x-2">
                    <Square className="w-4 h-4" /> <span>Hủy Job</span>
                  </button>
                )}

                <button onClick={handleExportZip} className="bg-blue-600 hover:bg-blue-500 text-white font-medium px-4 py-2.5 rounded-xl flex items-center space-x-2 shadow-lg shadow-blue-600/30">
                  <Download className="w-4 h-4" /> <span>Xuất Gói ZIP Excel & Ảnh</span>
                </button>
              </div>
            </div>

            {/* Realtime Results Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
              <div className="p-4 border-b border-slate-800 font-semibold text-slate-200">
                Bảng Kết Quả Đánh Giá Bài Viết Realtime
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="p-3">Dòng/Sheet</th>
                      <th className="p-3">Link Bài Viết</th>
                      <th className="p-3">Nền Tảng</th>
                      <th className="p-3">ĐK1 (Thời Lượng)</th>
                      <th className="p-3">ĐK2 (Nội Dung)</th>
                      <th className="p-3">Tương Tác</th>
                      <th className="p-3">Kết Quả chung</th>
                      <th className="p-3">Thao Tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {jobItems.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-800/40 transition">
                        <td className="p-3 font-mono">
                          Dòng {item.source_row} <br/>
                          <span className="text-slate-500">{item.sheet_name}</span>
                        </td>
                        <td className="p-3 max-w-xs truncate">
                          <a href={item.source_url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
                            {item.source_url}
                          </a>
                        </td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded font-bold ${item.platform === 'TIKTOK' ? 'bg-black text-cyan-400' : 'bg-blue-950 text-blue-400'}`}>
                            {item.platform}
                          </span>
                        </td>
                        <td className="p-3">
                          {item.dk1_passed === 1 ? (
                            <span className="text-emerald-400 font-semibold">✓ Đạt</span>
                          ) : (item.dk1_passed === 0 ? (
                            <span className="text-rose-400 font-semibold">✗ Không đạt</span>
                          ) : <span className="text-slate-500">Chờ...</span>)}
                        </td>
                        <td className="p-3">
                          {item.dk2_passed === 1 ? (
                            <span className="text-emerald-400 font-semibold">✓ Đạt</span>
                          ) : (item.dk2_passed === 0 ? (
                            <span className="text-rose-400 font-semibold">✗ Không đạt</span>
                          ) : <span className="text-slate-500">Chờ...</span>)}
                        </td>
                        <td className="p-3 font-mono space-x-2">
                          <span>👍 {item.likes || 0}</span>
                          <span>👁️ {item.views || 0}</span>
                        </td>
                        <td className="p-3">
                          <span className={`px-2 py-1 rounded font-bold ${
                            item.business_result === 'PASSED' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : (
                              item.business_result === 'FAILED' ? 'bg-rose-950 text-rose-400 border border-rose-800' : 'bg-amber-950 text-amber-400 border border-amber-800'
                            )
                          }`}>
                            {item.business_result || 'PENDING'}
                          </span>
                        </td>
                        <td className="p-3">
                          <button
                            onClick={() => setSelectedReviewItem(item)}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300"
                            title="Xem chi tiết & Kiểm tra thủ công"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer Bar */}
      <footer className="border-t border-slate-800/80 bg-slate-900/60 py-4 px-6 text-center text-xs text-slate-400 mt-auto">
        <div className="flex flex-col sm:flex-row items-center justify-between max-w-7xl mx-auto gap-2">
          <div>
            <span className="font-bold text-slate-200">FBEVAL ACTIVATION V2.1</span> — Universal Campaign Evaluator
          </div>
          <div className="font-medium text-slate-300">
            Design by <strong className="text-blue-400">Nguyễn Quang Thiện</strong>
          </div>
        </div>
      </footer>

      {/* Manual Review Modal */}
      {selectedReviewItem && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-lg">Kiểm Tra Thủ Công (Manual Review)</h3>
              <button onClick={() => setSelectedReviewItem(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div className="space-y-3 text-xs">
              <div><span className="text-slate-400">URL:</span> <a href={selectedReviewItem.source_url} target="_blank" rel="noreferrer" className="text-blue-400 underline">{selectedReviewItem.source_url}</a></div>
              <div><span className="text-slate-400">Lý do đánh giá hiện tại:</span> <p className="text-slate-200 mt-0.5">{selectedReviewItem.feedback || selectedReviewItem.error_message}</p></div>

              <div className="grid grid-cols-2 gap-4 border-t border-slate-800 pt-3">
                <div>
                  <label className="text-slate-400 block mb-1">Kết Quả Điều Chỉnh</label>
                  <select 
                    value={overrideResult} 
                    onChange={(e) => setOverrideResult(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                  >
                    <option value="PASSED">ĐẠT (PASSED)</option>
                    <option value="FAILED">KHÔNG ĐẠT (FAILED)</option>
                    <option value="NEEDS_REVIEW">CHỜ KIỂM TRA (NEEDS_REVIEW)</option>
                  </select>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Lý Do Điều Chỉnh (Audit Log)</label>
                  <input 
                    type="text" 
                    placeholder="Nhập lý do override..." 
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-3 border-t border-slate-800">
              <button onClick={() => setSelectedReviewItem(null)} className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300">Hủy</button>
              <button onClick={handleSaveManualReview} className="px-4 py-2 rounded-xl bg-blue-600 text-white font-bold">Lưu Thay Đổi</button>
            </div>
          </div>
        </div>
      )}

      {/* Admin User Approval & Role Management Modal */}
      {showAdminUsers && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-4xl w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-white text-lg flex items-center space-x-2">
                  <Users className="w-5 h-5 text-indigo-400" />
                  <span>Quản Lý Người Dùng & Phân Quyền FBEval</span>
                </h3>
                <p className="text-xs text-slate-400">Chủ sở hữu & Người duyệt duy nhất: <strong className="text-blue-300">nq.thien27@gmail.com (SUPER_ADMIN)</strong></p>
              </div>
              <button onClick={() => setShowAdminUsers(false)} className="text-slate-400 hover:text-white text-lg font-bold">✕</button>
            </div>

            {/* Admin Tabs */}
            <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs gap-1">
              {[
                { key: 'pending', label: '⏳ Chờ Duyệt' },
                { key: 'active', label: '✓ Đang Hoạt Động' },
                { key: 'rejected', label: '✕ Bị Từ Chối' },
                { key: 'suspended', label: '🚫 Bị Khóa/Thu Hồi' },
                { key: 'all', label: '📋 Tất Cả' }
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setAdminTab(tab.key)}
                  className={`flex-1 py-2 rounded-lg font-semibold transition ${adminTab === tab.key ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Users Table */}
            <div className="overflow-x-auto max-h-[55vh]">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="p-3">Họ Tên / Email</th>
                    <th className="p-3">Vai Trò</th>
                    <th className="p-3">Trạng Thái Duyệt</th>
                    <th className="p-3">Trạng Thái Tài Khoản</th>
                    <th className="p-3">Ngày Tạo</th>
                    <th className="p-3 text-right">Thao Tác Quản Trị</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {isLoadingUsers ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-500">Đang tải danh sách người dùng...</td>
                    </tr>
                  ) : userList.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-500">Không có người dùng nào trong mục này.</td>
                    </tr>
                  ) : (
                    userList.map((usr) => (
                      <tr key={usr.id} className="hover:bg-slate-800/40 transition">
                        <td className="p-3">
                          <div className="font-semibold text-white">{usr.display_name || usr.full_name || 'Người dùng'}</div>
                          <div className="font-mono text-[11px] text-blue-400">{usr.email}</div>
                        </td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                            usr.role === 'SUPER_ADMIN' ? 'bg-purple-950 text-purple-300 border border-purple-800' : (
                              usr.role === 'OPERATOR' ? 'bg-blue-950 text-blue-300 border border-blue-800' : 'bg-slate-800 text-slate-400'
                            )
                          }`}>
                            {usr.role}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                            usr.approval_status === 'APPROVED' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : (
                              usr.approval_status === 'PENDING' ? 'bg-amber-950 text-amber-300 border border-amber-800 animate-pulse' : 'bg-rose-950 text-rose-400 border border-rose-800'
                            )
                          }`}>
                            {usr.approval_status}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded font-mono text-[10px] ${
                            usr.account_status === 'ACTIVE' ? 'bg-emerald-950/60 text-emerald-300' : 'bg-rose-950/60 text-rose-300'
                          }`}>
                            {usr.account_status}
                          </span>
                        </td>
                        <td className="p-3 text-slate-400 text-[11px]">
                          {usr.created_at ? new Date(usr.created_at).toLocaleDateString('vi-VN') : 'N/A'}
                        </td>
                        <td className="p-3 text-right space-x-1.5">
                          {usr.email !== 'nq.thien27@gmail.com' ? (
                            <>
                              {usr.approval_status !== 'APPROVED' && (
                                <button
                                  onClick={() => setActionModal({ type: 'approve', user: usr })}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg text-[11px] transition shadow"
                                >
                                  Phê Duyệt
                                </button>
                              )}
                              {usr.approval_status === 'PENDING' && (
                                <button
                                  onClick={() => setActionModal({ type: 'reject', user: usr })}
                                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-lg text-[11px] transition shadow"
                                >
                                  Từ Chối
                                </button>
                              )}
                              {usr.account_status === 'ACTIVE' && (
                                <button
                                  onClick={() => setActionModal({ type: 'suspend', user: usr })}
                                  className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg text-[11px] transition shadow"
                                >
                                  Tạm Khóa
                                </button>
                              )}
                              {usr.account_status === 'SUSPENDED' && (
                                <button
                                  onClick={async () => {
                                    await fetch(`/api/admin/users/${usr.id}/reactivate`, { method: 'POST' });
                                    fetchUserList(adminTab);
                                  }}
                                  className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg text-[11px] transition shadow"
                                >
                                  Mở Khóa
                                </button>
                              )}
                              {usr.approval_status === 'APPROVED' && (
                                <button
                                  onClick={() => setActionModal({ type: 'revoke', user: usr })}
                                  className="px-2.5 py-1 bg-rose-950 hover:bg-rose-900 border border-rose-800 text-rose-300 font-semibold rounded-lg text-[11px] transition"
                                >
                                  Thu Hồi
                                </button>
                              )}
                            </>
                          ) : (
                            <span className="text-[11px] text-purple-400 font-bold">👑 System Owner</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-slate-800 text-xs">
              <span className="text-slate-400">Hiển thị: <strong>{userList.length}</strong> người dùng trong mục chọn.</span>
              <button onClick={() => setShowAdminUsers(false)} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300">Đóng</button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Action Confirmation Dialog Modal */}
      {actionModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="font-bold text-white text-base">
              {actionModal.type === 'approve' && `Phê Duyệt Tài Khoản: ${actionModal.user.email}`}
              {actionModal.type === 'reject' && `Từ Chối Yêu Cầu: ${actionModal.user.email}`}
              {actionModal.type === 'suspend' && `Tạm Khóa Tài Khoản: ${actionModal.user.email}`}
              {actionModal.type === 'revoke' && `Thu Hồi Quyền Truy Cập: ${actionModal.user.email}`}
            </h3>

            {actionModal.type === 'approve' && (
              <div className="space-y-2 text-xs">
                <label className="text-slate-300 block">Chọn vai trò phân quyền:</label>
                <select
                  value={actionRole}
                  onChange={(e) => setActionRole(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white"
                >
                  <option value="OPERATOR">OPERATOR (Tạo chiến dịch, chạy job, duyệt Excel)</option>
                  <option value="VIEWER">VIEWER (Chỉ xem kết quả và báo cáo)</option>
                </select>
              </div>
            )}

            {(actionModal.type === 'reject' || actionModal.type === 'suspend' || actionModal.type === 'revoke') && (
              <div className="space-y-2 text-xs">
                <label className="text-slate-300 block">Nhập lý do thực hiện (Bắt buộc):</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Chưa đăng ký danh sách dự án..."
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-rose-500"
                />
              </div>
            )}

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => { setActionModal(null); setActionReason(''); }}
                className="px-4 py-2 bg-slate-800 text-slate-300 text-xs rounded-xl hover:bg-slate-700"
              >
                Hủy Bỏ
              </button>
              <button
                onClick={handleExecuteAdminAction}
                className={`px-4 py-2 text-white font-bold text-xs rounded-xl shadow transition ${
                  actionModal.type === 'approve' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'
                }`}
              >
                Xác Nhận Thực Hiện
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

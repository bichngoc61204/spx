import { useState, useEffect, useRef } from 'react'; 
import Quagga from '@ericblade/quagga2'; 
import jsQR from 'jsqr'; 
import { useGoogleLogin, GoogleOAuthProvider } from '@react-oauth/google'; 
import { Video, RefreshCw, Edit3, Check, Trash2, PackageCheck, Zap, QrCode, Barcode, Sun, Moon, AlertCircle, Loader2, Layers, UserCheck, LogOut } from 'lucide-react'; 
import './App.css'; 

// 🔴 1. ID Folder lưu GOOGLE SHEET BÁO CÁO
const GOOGLE_SHEET_FOLDER_ID = "1_j5EtKLeoITwqVHzjqjNe9IUpfFeoZSu"; 

// 🔴 2. ID Folder gốc lưu VIDEO MINH CHỨNG
const GOOGLE_VIDEO_FOLDER_ID = "1BZWDrfH6flQkph2yOwSvPSgBoQvHW78q"; 

// 🔴 3. GOOGLE OAUTH CLIENT ID 
const GOOGLE_CLIENT_ID = "797998913200-utrs7cvhg0f2lkt2inq9n5fntipphjg6.apps.googleusercontent.com"; 

const REASON_OPTIONS = [ 
  "Bể vỡ , hư hỏng sản phẩm", 
  "Không đếm được số lượng", 
  "Thiếu số lượng", 
  "GTC rách ", 
  "GTC móp méo", 
  "Rỗng ruột", 
  "Động vật cắn", 
  "Thấm ướt bao bì" 
]; 

const DEFAULT_PREFIX = "SPXVN"; 

type ScanMode = 'barcode' | 'qrcode'; 
type ThemeMode = 'dark' | 'light'; 

interface QueueItem { 
  id: string; 
  trackingCode: string; 
  reason: string; 
  description: string; 
  videoBlob?: Blob; 
  status: 'pending' | 'uploading' | 'success' | 'error'; 
  errorMessage?: string; 
} 

function MainApp() { 
  const [theme, setTheme] = useState<ThemeMode>('light'); 
  const [accessToken, setAccessToken] = useState<string>(() => localStorage.getItem('spx_access_token') || ''); 
  const [userEmail, setUserEmail] = useState<string>(() => localStorage.getItem('spx_user_email') || ''); 
  const [trackingCode, setTrackingCode] = useState(''); 
  const [isManualInput, setIsManualInput] = useState(false); 
  const [manualCode, setManualCode] = useState(DEFAULT_PREFIX); 
  const [isScanning, setIsScanning] = useState(true); 
  const [scanMode, setScanMode] = useState<ScanMode>('barcode'); 
  const [reason, setReason] = useState(REASON_OPTIONS[0]); 
  const [description, setDescription] = useState(''); 
  const [recording, setRecording] = useState(false); 
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null); 
  const [uploadQueue, setUploadQueue] = useState<QueueItem[]>([]); 
  const [showQueueDetails, setShowQueueDetails] = useState(false); 

  const refs = { 
    mediaRecorder: useRef<MediaRecorder | null>(null), 
    videoChunks: useRef<Blob[]>([]), 
    videoPreview: useRef<HTMLVideoElement | null>(null), 
    stream: useRef<MediaStream | null>(null), 
    isProcessingQueue: useRef(false), 
    quaggaContainer: useRef<HTMLDivElement | null>(null), 
    qrVideo: useRef<HTMLVideoElement | null>(null), 
    qrCanvas: useRef<HTMLCanvasElement | null>(null), 
    qrStream: useRef<MediaStream | null>(null), 
    animFrameId: useRef<number | null>(null) 
  }; 

  const isDark = theme === 'dark'; 

  // Đăng nhập Google
  const loginWithGoogle = useGoogleLogin({ 
    onSuccess: async (tokenResponse) => { 
      const token = tokenResponse.access_token; 
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { 
        headers: { Authorization: `Bearer ${token}` }, 
      }); 
      const profile = await res.json(); 
      if (!profile.email.endsWith('@spxexpress.com')) { 
        alert("Chỉ tài khoản Google có đuôi @spxexpress.com mới được truy cập!"); 
        return; 
      } 
      setAccessToken(token); 
      setUserEmail(profile.email); 
      localStorage.setItem('spx_access_token', token); 
      localStorage.setItem('spx_user_email', profile.email); 
    }, 
    onError: () => alert("Đăng nhập bằng Google thất bại!"), 
    scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email" 
  }); 

  const handleLogout = () => { 
    localStorage.removeItem('spx_access_token'); 
    localStorage.removeItem('spx_user_email'); 
    setAccessToken(''); 
    setUserEmail(''); 
  }; 

  const playBeepSound = () => { 
    try { 
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)(); 
      const osc = ctx.createOscillator(); 
      const gain = ctx.createGain(); 
      osc.connect(gain); 
      gain.connect(ctx.destination); 
      osc.frequency.setValueAtTime(880, ctx.currentTime); 
      gain.gain.setValueAtTime(0.1, ctx.currentTime); 
      osc.start(); 
      osc.stop(ctx.currentTime + 0.1); 
    } catch (e) {} 
  }; 

  const stopAllScanners = () => { 
    try { 
      Quagga.offDetected(() => {}); 
      Quagga.stop(); 
    } catch (e) {} 
    if (refs.animFrameId.current) cancelAnimationFrame(refs.animFrameId.current); 
    refs.qrStream.current?.getTracks().forEach(t => t.stop()); 
    refs.qrStream.current = null; 
  }; 

  const handleScanSuccess = (code: string) => { 
    playBeepSound(); 
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]); 
    setTrackingCode(code); 
    setIsScanning(false); 
    stopAllScanners(); 
  }; 

  const startBarcodeScanner = () => { 
    if (!refs.quaggaContainer.current) return; 
    Quagga.init({ 
      inputStream: { 
        type: "LiveStream", 
        constraints: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, 
        target: refs.quaggaContainer.current 
      }, 
      locator: { patchSize: "medium", halfSample: true }, 
      numOfWorkers: navigator.hardwareConcurrency || 4, 
      decoder: { readers: ["code_128_reader", "code_39_reader", "ean_reader"] }, 
      locate: true 
    }, err => !err && Quagga.start()); 

    Quagga.onDetected(res => { 
      const code = res?.codeResult?.code?.trim().toUpperCase(); 
      if (code && code.length >= 6) handleScanSuccess(code); 
    }); 
  }; 

  const scanQrFrame = () => { 
    const { qrVideo: v, qrCanvas: c } = refs; 
    if (v.current && c.current && v.current.readyState === v.current.HAVE_ENOUGH_DATA) { 
      const ctx = c.current.getContext('2d', { willReadFrequently: true }); 
      if (ctx) { 
        c.current.height = v.current.videoHeight; 
        c.current.width = v.current.videoWidth; 
        ctx.drawImage(v.current, 0, 0, c.current.width, c.current.height); 
        const code = jsQR(ctx.getImageData(0, 0, c.current.width, c.current.height).data, c.current.width, c.current.height); 
        if (code?.data?.trim()) return handleScanSuccess(code.data.trim().toUpperCase()); 
      } 
    } 
    refs.animFrameId.current = requestAnimationFrame(scanQrFrame); 
  }; 

  const startQrScanner = async () => { 
    try { 
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } } 
      }); 
      refs.qrStream.current = stream; 
      if (refs.qrVideo.current) { 
        refs.qrVideo.current.srcObject = stream; 
        refs.qrVideo.current.setAttribute("playsinline", "true"); 
        await refs.qrVideo.current.play(); 
        refs.animFrameId.current = requestAnimationFrame(scanQrFrame); 
      } 
    } catch (err) {} 
  }; 

  useEffect(() => { 
    if (userEmail && isScanning && !trackingCode && !isManualInput) { 
      const timer = setTimeout(() => { 
        stopAllScanners(); 
        scanMode === 'barcode' ? startBarcodeScanner() : startQrScanner(); 
      }, 200); 
      return () => { 
        clearTimeout(timer); 
        stopAllScanners(); 
      }; 
    } else stopAllScanners(); 
  }, [isScanning, trackingCode, isManualInput, scanMode, userEmail]); 

  const startRecording = async () => { 
    stopAllScanners(); 
    refs.videoChunks.current = []; 
    setVideoBlob(null); 
    try { 
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { max: 15 } }, 
        audio: false 
      }); 
      refs.stream.current = stream; 
      if (refs.videoPreview.current) { 
        refs.videoPreview.current.srcObject = stream; 
        refs.videoPreview.current.muted = true; 
        await refs.videoPreview.current.play(); 
      } 
      const mime = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || 'video/mp4'; 
      const mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 300000 }); 
      refs.mediaRecorder.current = mr; 
      mr.ondataavailable = e => e.data?.size > 0 && refs.videoChunks.current.push(e.data); 
      mr.onstop = () => { 
        setVideoBlob(new Blob(refs.videoChunks.current, { type: mime })); 
        refs.stream.current?.getTracks().forEach(t => t.stop()); 
      }; 
      mr.start(500); 
      setRecording(true); 
    } catch (err) { 
      alert("Không thể bật camera quay video: " + err); 
    } 
  }; 

  const stopRecording = () => { 
    if (refs.mediaRecorder.current && recording) { 
      refs.mediaRecorder.current.stop(); 
      setRecording(false); 
    } 
  }; 

  const resetFormForNextScan = () => { 
    stopAllScanners(); 
    setTrackingCode(''); 
    setIsManualInput(false); 
    setManualCode(DEFAULT_PREFIX); 
    setReason(REASON_OPTIONS[0]); 
    setDescription(''); 
    setVideoBlob(null); 
    setIsScanning(true); 
  }; 

  const handleAddToQueue = () => { 
    if (!trackingCode || !videoBlob || !accessToken) return; 
    setUploadQueue(prev => [...prev, { 
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`, 
      trackingCode, 
      reason, 
      description, 
      videoBlob, 
      status: 'pending' 
    }]); 
    resetFormForNextScan(); 
  }; 

  // 📁 HÀM 1: LẤY HOẶC TẠO THƯ MỤC THEO NGÀY TRONG FOLDER VIDEO
  const getOrCreateDailyVideoFolder = async (parentFolderId: string, dateStr: string, token: string) => {
    const q = `'${parentFolderId}' in parents and name = '${dateStr}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (searchRes.ok) {
      const data = await searchRes.json();
      if (data.files && data.files.length > 0) return data.files[0].id;
    }

    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: dateStr,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId]
      })
    });

    if (!createRes.ok) throw new Error("Không thể tạo thư mục ngày mới trong Folder Video!");
    const newFolderData = await createRes.json();
    return newFolderData.id;
  };

  // 📄 HÀM 2: LẤY HOẶC TẠO FILE GOOGLE SHEET BÁO CÁO THEO NGÀY
  const getOrCreateDailySpreadsheet = async (folderId: string, dateStr: string, token: string) => {
    const fileName = `SPX_Report_${dateStr}`;
    
    const q = `'${folderId}' in parents and name = '${fileName}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
    const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) return searchData.files[0].id;
    }

    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: fileName,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: [folderId]
      })
    });

    if (!createRes.ok) throw new Error("Không thể tạo file Sheet ngày mới!");
    const newFileData = await createRes.json();
    const newSheetId = newFileData.id;

    const headers = [
      ["Thời gian", "Trạng Thái", "Mã Vận Đơn", "Link Video Minh Chứng", "Lý Do Sự Cố", "Mô Tả Chi Tiết", "Email Nhân Viên", "Ngày Duyệt"]
    ];

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${newSheetId}/values/Sheet1!A1:H1?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: headers })
    });

    return newSheetId;
  };

  // 🚀 LOGIC UPLOAD
  useEffect(() => { 
    const processQueue = async () => { 
      if (refs.isProcessingQueue.current) return; 
      const next = uploadQueue.find(i => i.status === 'pending'); 
      if (!next?.videoBlob) return; 

      refs.isProcessingQueue.current = true; 
      setUploadQueue(prev => prev.map(i => i.id === next.id ? { ...i, status: 'uploading' } : i)); 

      try { 
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`; 

        // 1. TÌM/TẠO THƯ MỤC NGÀY TRONG FOLDER VIDEO
        const dailyVideoFolderId = await getOrCreateDailyVideoFolder(GOOGLE_VIDEO_FOLDER_ID, dateStr, accessToken);

        // 🎯 ĐẶT TÊN VIDEO CHỈ DÙNG MÃ VẬN ĐƠN
        const videoMetadata = {
          name: `${next.trackingCode}.mp4`,
          mimeType: next.videoBlob.type || 'video/mp4',
          parents: [dailyVideoFolderId]
        };

        const formData = new FormData();
        formData.append('metadata', new Blob([JSON.stringify(videoMetadata)], { type: 'application/json' }));
        formData.append('file', next.videoBlob);

        const driveRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
          body: formData,
        });

        if (!driveRes.ok) throw new Error("Lỗi tải video lên Folder Drive!");
        const driveData = await driveRes.json();
        const driveFileUrl = `https://drive.google.com/file/d/${driveData.id}/view`;

        // 2. TÌM/TẠO FILE SHEET THEO NGÀY TRONG FOLDER SHEET
        const dailySpreadsheetId = await getOrCreateDailySpreadsheet(GOOGLE_SHEET_FOLDER_ID, dateStr, accessToken);

        const timeStr = now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
        const rowValues = [
          timeStr,                
          "Pending",              
          next.trackingCode,      
          driveFileUrl,           
          next.reason,            
          next.description || "", 
          userEmail,              
          ""                      
        ];

        const sheetRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${dailySpreadsheetId}/values/Sheet1!A:H:append?valueInputOption=USER_ENTERED`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ values: [rowValues] })
        });

        if (!sheetRes.ok) throw new Error("Lỗi ghi dữ liệu vào Google Sheet!");

        setUploadQueue(prev => prev.map(i => i.id === next.id ? { ...i, status: 'success', videoBlob: undefined } : i)); 

      } catch (err: any) { 
        setUploadQueue(prev => prev.map(i => i.id === next.id ? { ...i, status: 'error', errorMessage: err.message || "Lỗi tải lên" } : i)); 
      } finally { 
        refs.isProcessingQueue.current = false; 
      } 
    }; 

    processQueue(); 
  }, [uploadQueue, accessToken, userEmail]); 

  const counts = { 
    pending: uploadQueue.filter(i => i.status === 'pending' || i.status === 'uploading').length, 
    error: uploadQueue.filter(i => i.status === 'error').length, 
    success: uploadQueue.filter(i => i.status === 'success').length 
  }; 

  const cardStyle = `p-3.5 rounded-2xl border backdrop-blur-xl transition-all shadow-sm ${ 
    isDark ? 'bg-neutral-900/40 border-white/10' : 'bg-white/80 border-black/5' 
  }`; 

  const inputStyle = `w-full border rounded-xl p-2.5 text-xs outline-none transition ${ 
    isDark ? 'bg-neutral-950 border-white/15 text-slate-200 focus:border-orange-500' : 'bg-slate-50 border-black/10 text-slate-800 focus:border-orange-500' 
  }`; 

  if (!userEmail || !accessToken) { 
    return ( 
      <div className={`min-h-screen flex items-center justify-center p-4 ${isDark ? 'bg-black text-white' : 'bg-slate-100 text-slate-800'}`}> 
        <div className={`w-full max-w-sm p-6 rounded-3xl border shadow-2xl text-center space-y-5 ${isDark ? 'bg-neutral-900/90 border-white/10' : 'bg-white border-black/5'}`}> 
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-tr from-orange-600 to-amber-500 flex items-center justify-center text-white shadow-xl shadow-orange-500/20"> 
            <PackageCheck size={36} /> 
          </div> 
          <div> 
            <h1 className="text-xl font-bold">Xác thực SPX Express</h1> 
            <p className="text-xs text-slate-400 mt-1">Đăng nhập tài khoản Google doanh nghiệp để upload dữ liệu</p> 
          </div> 
          <button onClick={() => loginWithGoogle()} className="w-full py-3.5 px-4 bg-white hover:bg-slate-50 text-slate-800 font-bold border border-slate-300 rounded-xl shadow-md flex items-center justify-center gap-3 text-xs transition-all" > 
            <svg className="w-4 h-4" viewBox="0 0 24 24"> 
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/> 
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/> 
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/> 
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/> 
            </svg> Đăng nhập với Google SPX 
          </button> 
        </div> 
      </div> 
    ); 
  } 

  return ( 
    <div className={`min-h-screen font-sans flex flex-col max-w-md mx-auto relative select-none ${isDark ? 'bg-black text-slate-100' : 'bg-slate-100 text-slate-800'}`}> 
      <header className={`sticky top-0 z-50 px-4 py-2.5 backdrop-blur-xl border-b flex justify-between items-center ${isDark ? 'bg-neutral-900/60 border-white/10' : 'bg-white/70 border-black/5 shadow-sm'}`}> 
        <div className="flex items-center gap-2.5"> 
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-orange-600 to-amber-500 flex items-center justify-center text-white shadow-md shadow-orange-500/20"> 
            <PackageCheck size={20} /> 
          </div> 
          <div> 
            <h1 className="font-bold text-[14px] leading-tight">SPX Express</h1> 
            <p className={`text-[10px] font-medium flex items-center gap-1 ${isDark ? 'text-amber-400' : 'text-orange-600'}`}> 
              <UserCheck size={11} /> {userEmail} 
            </p> 
          </div> 
        </div> 
        <div className="flex gap-1.5"> 
          <button onClick={handleLogout} title="Đăng xuất" className={`p-2 rounded-xl border ${isDark ? 'bg-white/10 border-white/15 text-slate-400' : 'bg-black/5 border-black/10 text-slate-600'}`}> 
            <LogOut size={16} /> 
          </button> 
          <button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} className={`p-2 rounded-xl border ${isDark ? 'bg-white/10 border-white/15 text-amber-400' : 'bg-black/5 border-black/10 text-orange-600'}`}> 
            {isDark ? <Sun size={16} /> : <Moon size={16} />} 
          </button> 
          <button onClick={resetFormForNextScan} className={`p-2 rounded-xl border ${isDark ? 'bg-white/10 border-white/15 text-slate-300' : 'bg-black/5 border-black/10 text-slate-600'}`}> 
            <RefreshCw size={16} /> 
          </button> 
        </div> 
      </header> 

      <main className="p-3.5 space-y-3 flex-1 pb-28"> 
        <section className={cardStyle}> 
          <div className="flex justify-between items-center mb-3"> 
            <div className="flex items-center gap-2"> 
              <span className="w-5 h-5 rounded-lg bg-orange-500/15 text-orange-500 font-bold text-[11px] flex items-center justify-center">1</span> 
              <h2 className="font-bold text-xs uppercase tracking-wider opacity-80">Mã Vận Đơn</h2> 
            </div> 
            <button onClick={() => { setIsManualInput(!isManualInput); !isManualInput ? stopAllScanners() : setIsScanning(true); }} className="text-xs text-orange-500 font-semibold flex items-center gap-1" > 
              <Edit3 size={12} /> {isManualInput ? "Dùng Camera" : "Nhập tay"} 
            </button> 
          </div> 
          {!isManualInput && !trackingCode && ( 
            <> 
              <div className={`flex p-1 rounded-xl mb-3 border ${isDark ? 'bg-black/40 border-white/5' : 'bg-slate-200/50 border-black/5'}`}> 
                {(['barcode', 'qrcode'] as ScanMode[]).map(mode => ( 
                  <button key={mode} onClick={() => setScanMode(mode)} className={`flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${ scanMode === mode ? (isDark ? 'bg-orange-500 text-white shadow-md' : 'bg-white text-orange-600 shadow-sm') : (isDark ? 'text-slate-400' : 'text-slate-600') }`} > 
                    {mode === 'barcode' ? <Barcode size={14} /> : <QrCode size={14} />} 
                    {mode === 'barcode' ? 'Mã vạch' : 'Mã QR'} 
                  </button> 
                ))} 
              </div> 
              <div className="relative rounded-xl overflow-hidden bg-black border border-white/10 aspect-[4/3] w-full shadow-inner"> 
                <div ref={refs.quaggaContainer} className={`absolute inset-0 [&>video]:w-full [&>video]:h-full [&>video]:object-cover [&>canvas]:hidden ${scanMode === 'barcode' ? 'block' : 'hidden'}`} /> 
                <div className={`absolute inset-0 ${scanMode === 'qrcode' ? 'block' : 'hidden'}`}> 
                  <video ref={refs.qrVideo} className="w-full h-full object-cover" /> 
                  <canvas ref={refs.qrCanvas} className="hidden" /> 
                </div> 
                <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-between py-3 z-10"> 
                  <span className="text-[10px] bg-black/60 backdrop-blur-md text-amber-400 px-3 py-1 rounded-full border border-white/10 flex items-center gap-1 font-medium"> 
                    {scanMode === 'barcode' ? <Zap size={11} className="fill-amber-400" /> : <QrCode size={11} />} 
                    {scanMode === 'barcode' ? 'Căn dải mã vạch vào khung' : 'Căn QR Code vào tâm'} 
                  </span> 
                  {scanMode === 'barcode' ? ( 
                    <div className="w-[85%] h-16 border-2 border-orange-500 rounded-lg flex items-center justify-center bg-orange-500/10"> 
                      <div className="w-full h-[2px] bg-orange-500 animate-pulse shadow-[0_0_10px_#f97316]"></div> 
                    </div> 
                  ) : ( 
                    <div className="w-44 h-44 border-2 border-dashed border-orange-500 rounded-xl flex items-center justify-center bg-orange-500/5"> 
                      <div className="w-full h-full border border-orange-500/30 rounded-xl animate-ping opacity-25"></div> 
                    </div> 
                  )} 
                  <span className="text-[10px] text-white/70 bg-black/40 px-2 py-0.5 rounded">Tự động quét</span> 
                </div> 
              </div> 
            </> 
          )} 
          {isManualInput && !trackingCode && ( 
            <div className="flex gap-2"> 
              <input type="text" value={manualCode} onChange={e => setManualCode(e.target.value.toUpperCase())} className={`${inputStyle} flex-1 font-mono uppercase`} /> 
              <button onClick={() => manualCode.trim() && setTrackingCode(manualCode.trim())} className="bg-orange-500 text-white px-4 rounded-xl text-xs font-bold">Lưu</button> 
            </div> 
          )} 
          {trackingCode && ( 
            <div className={`p-3 rounded-xl border flex justify-between items-center backdrop-blur-md ${isDark ? 'bg-emerald-950/20 border-emerald-500/30' : 'bg-emerald-50/80 border-emerald-500/20'}`}> 
              <div className="flex items-center gap-2.5"> 
                <div className="p-1.5 bg-emerald-500 text-white rounded-lg"><Check size={14} /></div> 
                <div> 
                  <span className={`text-[10px] block ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Mã đã ghi nhận</span> 
                  <span className="text-sm font-mono font-bold tracking-wide text-emerald-500">{trackingCode}</span> 
                </div> 
              </div> 
              <button onClick={() => { setTrackingCode(''); setIsScanning(true); }} className={`text-xs px-3 py-1.5 rounded-lg border font-medium ${isDark ? 'bg-white/10 border-white/10 text-slate-300' : 'bg-white border-black/10 text-slate-700 shadow-sm'}`}> Quét lại </button> 
            </div> 
          )} 
        </section> 

        <section className={cardStyle}> 
          <div className="flex items-center gap-2 mb-3"> 
            <span className="w-5 h-5 rounded-lg bg-orange-500/15 text-orange-500 font-bold text-[11px] flex items-center justify-center">2</span> 
            <h2 className="font-bold text-xs uppercase tracking-wider opacity-80">Chi Tiết Sự Cố</h2> 
          </div> 
          <div className="space-y-2.5"> 
            <select value={reason} onChange={e => setReason(e.target.value)} className={inputStyle}> 
              {REASON_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)} 
            </select> 
            <textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="Ghi chú thêm (không bắt buộc)..." className={`${inputStyle} resize-none`} /> 
          </div> 
        </section> 

        <section className={cardStyle}> 
          <div className="flex items-center gap-2 mb-3"> 
            <span className="w-5 h-5 rounded-lg bg-orange-500/15 text-orange-500 font-bold text-[11px] flex items-center justify-center">3</span> 
            <h2 className="font-bold text-xs uppercase tracking-wider opacity-80">Video Minh Chứng</h2> 
          </div> 
          {!videoBlob ? ( 
            <div className="space-y-2"> 
              <video ref={refs.videoPreview} className={`w-full aspect-[4/3] bg-black rounded-xl object-cover border border-white/10 ${recording ? 'block' : 'hidden'}`} playsInline autoPlay /> 
              <button onClick={recording ? stopRecording : startRecording} className={`w-full py-3 rounded-xl border font-semibold flex items-center justify-center gap-2 text-xs transition ${ recording ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/25 animate-pulse' : (isDark ? 'bg-white/5 border-white/10 text-slate-200' : 'bg-slate-100 border-black/10 text-slate-700') }`} > 
                {recording ? <><div className="w-2.5 h-2.5 bg-white rounded-full" /> Dừng Quay & Lưu Video</> : <><Video size={15} className="text-orange-500" /> Bắt Đầu Quay Video</>} 
              </button> 
            </div> 
          ) : ( 
            <div className={`p-3 rounded-xl border flex items-center justify-between ${isDark ? 'bg-emerald-950/20 border-emerald-500/30' : 'bg-emerald-50/80 border-emerald-500/20'}`}> 
              <div className="flex items-center gap-2 text-emerald-500 text-xs font-semibold"> 
                <Check size={14} className="p-0.5 bg-emerald-500 text-white rounded-full" /> Đã lưu video minh chứng 
              </div> 
              <button onClick={() => setVideoBlob(null)} className={`text-xs flex items-center gap-1 ${isDark ? 'text-slate-400 hover:text-rose-400' : 'text-slate-500 hover:text-rose-600'}`}> 
                <Trash2 size={12} /> Quay lại 
              </button> 
            </div> 
          )} 
        </section> 

        <button disabled={!trackingCode || !videoBlob} onClick={handleAddToQueue} className={`w-full py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 text-sm shadow-xl transition-all ${ !trackingCode || !videoBlob ? (isDark ? 'bg-neutral-800 text-neutral-500 border border-white/5' : 'bg-slate-200 text-slate-400 border border-black/5') : 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-orange-500/25' }`} > 
          Lưu & Quét Đơn Tiếp Theo 
        </button> 
      </main> 

      <footer className={`fixed bottom-0 left-0 right-0 max-w-md mx-auto z-50 p-3 border-t backdrop-blur-2xl ${isDark ? 'bg-neutral-900/90 border-white/10' : 'bg-white/90 border-black/10 shadow-2xl'}`}> 
        <div className="flex items-center justify-between gap-2"> 
          <button onClick={() => setShowQueueDetails(!showQueueDetails)} className="flex items-center gap-2 text-left"> 
            <div className={`p-2 rounded-xl relative ${counts.pending > 0 ? 'bg-amber-500/20 text-amber-500' : 'bg-emerald-500/20 text-emerald-500'}`}> 
              <Layers size={18} /> 
              {counts.pending > 0 && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-500 rounded-full animate-ping" />} 
            </div> 
            <div> 
              <div className="text-xs font-bold flex items-center gap-1.5"> 
                <span>Hàng chờ Upload</span> 
                {counts.pending > 0 && <span className="bg-amber-500 text-black text-[10px] font-extrabold px-1.5 py-0.2 rounded-full">{counts.pending}</span>} 
              </div> 
              <p className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}> 
                {counts.pending > 0 ? "Đang đồng bộ Drive & Sheet..." : counts.error > 0 ? `${counts.error} đơn bị lỗi` : "Tất cả đã đồng bộ"} 
              </p> 
            </div> 
          </button> 
          <div className="flex items-center gap-2"> 
            <div className="flex gap-1 text-[11px] font-semibold"> 
              {counts.success > 0 && <span className="text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-lg border border-emerald-500/20 flex items-center gap-1"><Check size={11} /> {counts.success}</span>} 
              {counts.error > 0 && <span className="text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded-lg border border-rose-500/20 flex items-center gap-1"><AlertCircle size={11} /> {counts.error}</span>} 
            </div> 
            <button onClick={() => setShowQueueDetails(!showQueueDetails)} className={`text-xs px-2.5 py-1.5 rounded-lg border ${isDark ? 'bg-white/10 border-white/10 text-slate-300' : 'bg-black/5 border-black/10 text-slate-700'}`}> 
              {showQueueDetails ? "Ẩn" : "Chi tiết"} 
            </button> 
          </div> 
        </div> 

        {showQueueDetails && ( 
          <div className={`mt-3 pt-3 border-t max-h-56 overflow-y-auto space-y-2 ${isDark ? 'border-white/10' : 'border-black/10'}`}> 
            {uploadQueue.length === 0 ? ( 
              <p className={`text-xs text-center py-2 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Chưa có đơn nào trong hàng chờ.</p> 
            ) : ( 
              uploadQueue.map(item => ( 
                <div key={item.id} className={`p-2.5 rounded-xl border flex justify-between items-center text-xs ${isDark ? 'bg-black/40 border-white/5' : 'bg-slate-100/80 border-black/5'}`}> 
                  <div className="space-y-0.5 max-w-[65%]"> 
                    <div className="font-mono font-bold text-orange-500 truncate">{item.trackingCode}</div> 
                    <div className={`text-[10px] truncate ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{item.reason}</div> 
                    {item.errorMessage && <div className="text-[10px] text-rose-500 font-medium truncate">{item.errorMessage}</div>} 
                  </div> 
                  <div> 
                    {item.status === 'pending' && <span className="text-[10px] text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">Đang chờ...</span>} 
                    {item.status === 'uploading' && <span className="text-[10px] text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded-full border border-sky-500/20 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Đang up...</span>} 
                    {item.status === 'success' && <span className="text-[10px] text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 flex items-center gap-0.5"><Check size={10} /> Xong</span>} 
                    {item.status === 'error' && ( 
                      <button onClick={() => setUploadQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: 'pending', errorMessage: undefined } : i))} className="text-[10px] text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/30 flex items-center gap-0.5"> 
                        <RefreshCw size={10} /> Thử lại 
                      </button> 
                    )} 
                  </div> 
                </div> 
              )) 
            )} 
          </div> 
        )} 
      </footer> 
    </div> 
  ); 
} 

export default function App() { 
  return ( 
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}> 
      <MainApp /> 
    </GoogleOAuthProvider> 
  ); 
}
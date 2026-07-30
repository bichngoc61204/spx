import { useState, useEffect, useRef } from 'react';
import Quagga from '@ericblade/quagga2';
import jsQR from 'jsqr';
import { Video, Upload, RefreshCw, Edit3, Check, Trash2, PackageCheck, Zap, QrCode, Barcode, Sun, Moon, AlertCircle, Loader2, Layers, UserCheck, LogOut } from 'lucide-react';
import './App.css';

// 🔴 WEBHOOK URL ĐÃ DEPLOY
const GOOGLE_SCRIPT_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbxZMZNYeRis36Bk8J8HSt26S5rfT8DxOsUXRdDM9HG6qW8mMxHYq0DRi5Bn48h5eVzQ/exec";

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
  userEmail: string;
  trackingCode: string;
  reason: string;
  description: string;
  videoBlob?: Blob;
  status: 'pending' | 'uploading' | 'success' | 'error';
  errorMessage?: string;
  createdAt: number;
}

export default function App() {
  // 🟢 ĐÃ SỬA: Tone mặc định là SÁNG (Light Mode)
  const [theme, setTheme] = useState<ThemeMode>('light');
  const [userEmail, setUserEmail] = useState<string>(() => localStorage.getItem('spx_user_email') || '');
  const [emailInput, setEmailInput] = useState('');
  const [emailError, setEmailError] = useState('');
  
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

  // Xử lý xác thực Email công ty
  const handleSaveEmail = (e: React.FormEvent) => {
    e.preventDefault();
    const formatted = emailInput.trim().toLowerCase();
    if (!formatted.endsWith('@spxexpress.com')) {
      setEmailError('Email phải có đuôi @spxexpress.com');
      return;
    }
    localStorage.setItem('spx_user_email', formatted);
    setUserEmail(formatted);
    setEmailError('');
  };

  const handleLogoutEmail = () => {
    localStorage.removeItem('spx_user_email');
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
    if (!trackingCode || !videoBlob || !userEmail) return;
    setUploadQueue(prev => [...prev, {
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      userEmail,
      trackingCode,
      reason,
      description,
      videoBlob,
      status: 'pending',
      createdAt: Date.now()
    }]);
    resetFormForNextScan();
  };

  // TIẾN TRÌNH UPLOAD TỰ ĐỘNG CHẠY NGẦM
  useEffect(() => {
    const processQueue = async () => {
      if (refs.isProcessingQueue.current) return;
      const next = uploadQueue.find(i => i.status === 'pending');
      if (!next?.videoBlob) return;

      refs.isProcessingQueue.current = true;
      setUploadQueue(prev => prev.map(i => i.id === next.id ? { ...i, status: 'uploading' } : i));

      try {
        const base64 = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res((r.result as string).split(',')[1]);
          r.onerror = rej;
          r.readAsDataURL(next.videoBlob!);
        });

        const payloadData = JSON.stringify({
          userEmail: next.userEmail,
          trackingCode: next.trackingCode,
          reason: next.reason,
          description: next.description,
          videoFileName: `${next.trackingCode}.mp4`,
          videoBase64: base64,
          mimeType: next.videoBlob.type || "video/mp4"
        });

        await fetch(GOOGLE_SCRIPT_WEBHOOK_URL, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain' },
          body: payloadData
        });

        setUploadQueue(prev => prev.map(i => i.id === next.id ? { ...i, status: 'success', videoBlob: undefined } : i));
      } catch (err: any) {
        setUploadQueue(prev => prev.map(i => i.id === next.id ? { ...i, status: 'error', errorMessage: err.message || "Lỗi tải lên" } : i));
      } finally {
        refs.isProcessingQueue.current = false;
      }
    };

    processQueue();
  }, [uploadQueue]);

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

  // Form xác thực Email Nhân viên
  if (!userEmail) {
    return (
      <div className={`min-h-screen flex items-center justify-center p-4 ${isDark ? 'bg-black text-white' : 'bg-slate-100 text-slate-800'}`}>
        <div className={`w-full max-w-sm p-6 rounded-3xl border shadow-2xl ${isDark ? 'bg-neutral-900/90 border-white/10' : 'bg-white border-black/5'}`}>
          <div className="flex flex-col items-center text-center space-y-3 mb-6">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-orange-600 to-amber-500 flex items-center justify-center text-white shadow-xl shadow-orange-500/20">
              <PackageCheck size={32} />
            </div>
            <div>
              <h1 className="text-xl font-bold">Xác thực Nhân viên</h1>
              <p className="text-xs text-slate-400 mt-1">Nhập Email SPX Express để ghi nhận log</p>
            </div>
          </div>
          <form onSubmit={handleSaveEmail} className="space-y-4">
            <div>
              <input 
                type="email" 
                placeholder="nam.nguyen@spxexpress.com" 
                value={emailInput} 
                onChange={e => setEmailInput(e.target.value)} 
                className={inputStyle} 
                required 
              />
              {emailError && <p className="text-[11px] text-rose-500 mt-1.5 font-medium">{emailError}</p>}
            </div>
            <button type="submit" className="w-full py-3 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-orange-500/20">
              Vào ứng dụng
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen font-sans flex flex-col max-w-md mx-auto relative select-none ${isDark ? 'bg-black text-slate-100' : 'bg-slate-100 text-slate-800'}`}>
      {/* HEADER */}
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
          <button onClick={handleLogoutEmail} title="Đổi tài khoản" className={`p-2 rounded-xl border ${isDark ? 'bg-white/10 border-white/15 text-slate-400' : 'bg-black/5 border-black/10 text-slate-600'}`}>
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

      {/* MAIN CONTENT */}
      <main className="p-3.5 space-y-3 flex-1 pb-28">
        {/* BƯỚC 1: QUÉT MÃ VẬN ĐƠN */}
        <section className={cardStyle}>
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-lg bg-orange-500/15 text-orange-500 font-bold text-[11px] flex items-center justify-center">1</span>
              <h2 className="font-bold text-xs uppercase tracking-wider opacity-80">Mã Vận Đơn</h2>
            </div>
            <button 
              onClick={() => {
                setIsManualInput(!isManualInput);
                !isManualInput ? stopAllScanners() : setIsScanning(true);
              }}
              className="text-xs text-orange-500 font-semibold flex items-center gap-1"
            >
              <Edit3 size={12} />
              {isManualInput ? "Dùng Camera" : "Nhập tay"}
            </button>
          </div>

          {!isManualInput && !trackingCode && (
            <>
              <div className={`flex p-1 rounded-xl mb-3 border ${isDark ? 'bg-black/40 border-white/5' : 'bg-slate-200/50 border-black/5'}`}>
                {(['barcode', 'qrcode'] as ScanMode[]).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setScanMode(mode)}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                      scanMode === mode 
                        ? (isDark ? 'bg-orange-500 text-white shadow-md' : 'bg-white text-orange-600 shadow-sm') 
                        : (isDark ? 'text-slate-400' : 'text-slate-600')
                    }`}
                  >
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
              <input 
                type="text" 
                value={manualCode} 
                onChange={e => setManualCode(e.target.value.toUpperCase())} 
                className={`${inputStyle} flex-1 font-mono uppercase`} 
              />
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
              <button 
                onClick={() => { setTrackingCode(''); setIsScanning(true); }}
                className={`text-xs px-3 py-1.5 rounded-lg border font-medium ${isDark ? 'bg-white/10 border-white/10 text-slate-300' : 'bg-white border-black/10 text-slate-700 shadow-sm'}`}
              >
                Quét lại
              </button>
            </div>
          )}
        </section>

        {/* BƯỚC 2: CHI TIẾT SỰ CỐ */}
        <section className={cardStyle}>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-5 h-5 rounded-lg bg-orange-500/15 text-orange-500 font-bold text-[11px] flex items-center justify-center">2</span>
            <h2 className="font-bold text-xs uppercase tracking-wider opacity-80">Chi Tiết Sự Cố</h2>
          </div>
          <div className="space-y-2.5">
            <select value={reason} onChange={e => setReason(e.target.value)} className={inputStyle}>
              {REASON_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
            <textarea 
              rows={2} 
              value={description} 
              onChange={e => setDescription(e.target.value)} 
              placeholder="Ghi chú thêm (không bắt buộc)..." 
              className={`${inputStyle} resize-none`} 
            />
          </div>
        </section>

        {/* BƯỚC 3: QUAY VIDEO MINH CHỨNG */}
        <section className={cardStyle}>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-5 h-5 rounded-lg bg-orange-500/15 text-orange-500 font-bold text-[11px] flex items-center justify-center">3</span>
            <h2 className="font-bold text-xs uppercase tracking-wider opacity-80">Video Minh Chứng</h2>
          </div>

          {!videoBlob ? (
            <div className="space-y-2">
              <video ref={refs.videoPreview} className={`w-full aspect-[4/3] bg-black rounded-xl object-cover border border-white/10 ${recording ? 'block' : 'hidden'}`} playsInline autoPlay />
              <button 
                onClick={recording ? stopRecording : startRecording} 
                className={`w-full py-3 rounded-xl border font-semibold flex items-center justify-center gap-2 text-xs transition ${
                  recording 
                    ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/25 animate-pulse' 
                    : (isDark ? 'bg-white/5 border-white/10 text-slate-200' : 'bg-slate-100 border-black/10 text-slate-700')
                }`}
              >
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

        {/* NÚT LƯU & QUÉT ĐƠN TIẾP THEO */}
        <button 
          disabled={!trackingCode || !videoBlob} 
          onClick={handleAddToQueue} 
          className={`w-full py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 text-sm shadow-xl transition-all ${
            !trackingCode || !videoBlob 
              ? (isDark ? 'bg-neutral-800 text-neutral-500 border border-white/5' : 'bg-slate-200 text-slate-400 border border-black/5') 
              : 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-orange-500/25'
          }`}
        >
          <Upload size={16} /> Lưu & Quét Đơn Tiếp Theo
        </button>
      </main>

      {/* FOOTER - THANH HÀNG CHỜ UPLOAD NGẦM */}
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
                {counts.pending > 0 ? "Đang tải lên ngầm..." : counts.error > 0 ? `${counts.error} đơn bị lỗi` : "Tất cả đã đồng bộ"}
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
                    <div className={`text-[10px] truncate ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{item.userEmail} - {item.reason}</div>
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
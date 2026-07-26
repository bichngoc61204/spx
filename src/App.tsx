import { useState, useEffect, useRef } from 'react';
import Quagga from '@ericblade/quagga2';
import jsQR from 'jsqr';
import { 
  CheckCircle2, Video, Upload, RefreshCw, Edit3, Check, 
  Trash2, PackageCheck, Sparkles, Zap, QrCode, Barcode, Sun, Moon 
} from 'lucide-react';
import './App.css';

const GOOGLE_SCRIPT_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzQquNH2KXJhk6AsXx8WKIOKAR-54frJXNR7X0_wbPAP9TCd-URwWwomusEmr1-ZLVcXg/exec"; 

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

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [trackingCode, setTrackingCode] = useState<string>('');
  const [isManualInput, setIsManualInput] = useState<boolean>(false);
  const [manualCode, setManualCode] = useState<string>(DEFAULT_PREFIX);
  const [isScanning, setIsScanning] = useState<boolean>(true);
  const [scanMode, setScanMode] = useState<ScanMode>('barcode'); 
  
  const [reason, setReason] = useState<string>(REASON_OPTIONS[0]);
  const [description, setDescription] = useState<string>('');
  
  const [recording, setRecording] = useState<boolean>(false);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadSuccess, setUploadSuccess] = useState<boolean>(false);

  // Refs cho Scanner
  const quaggaContainerRef = useRef<HTMLDivElement | null>(null);
  const qrVideoRef = useRef<HTMLVideoElement | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const qrStreamRef = useRef<MediaStream | null>(null);
  const animFrameIdRef = useRef<number | null>(null);

  // Toggle Dark/Light Mode
  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const playBeepSound = () => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch (e) {
      console.log("Audio không hỗ trợ");
    }
  };

  const handleScanSuccess = (code: string) => {
    playBeepSound();
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    setTrackingCode(code);
    setIsScanning(false);
    stopAllScanners();
  };

  useEffect(() => {
    let isMounted = true;

    if (isScanning && !trackingCode && !isManualInput) {
      const timer = setTimeout(() => {
        if (!isMounted) return;

        if (scanMode === 'barcode') {
          stopJsQrScanner();
          startQuaggaBarcodeScanner();
        } else {
          stopQuaggaBarcodeScanner();
          startJsQrScanner();
        }
      }, 200);

      return () => {
        isMounted = false;
        clearTimeout(timer);
        stopAllScanners();
      };
    } else {
      stopAllScanners();
    }
  }, [isScanning, trackingCode, isManualInput, scanMode]);

  const stopAllScanners = async () => {
    stopQuaggaBarcodeScanner();
    stopJsQrScanner();
  };

  // 1. ENGINE QUÉT MÃ VẠCH (Quagga2)
  const startQuaggaBarcodeScanner = () => {
    if (!quaggaContainerRef.current) return;

    Quagga.init(
      {
        inputStream: {
          type: "LiveStream",
          constraints: {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          target: quaggaContainerRef.current
        },
        locator: { patchSize: "medium", halfSample: true },
        numOfWorkers: navigator.hardwareConcurrency || 4,
        decoder: { readers: ["code_128_reader", "code_39_reader", "ean_reader"] },
        locate: true
      },
      (err) => {
        if (err) return;
        Quagga.start();
      }
    );

    Quagga.onDetected((result) => {
      if (result && result.codeResult && result.codeResult.code) {
        const decodedCode = result.codeResult.code.trim().toUpperCase();
        if (decodedCode.length >= 6) {
          handleScanSuccess(decodedCode);
        }
      }
    });
  };

  const stopQuaggaBarcodeScanner = () => {
    try {
      Quagga.offDetected(() => {});
      Quagga.stop();
    } catch (e) {}
  };

  // 2. ENGINE QUÉT QR CODE TỐC ĐỘ CAO
  const startJsQrScanner = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      
      qrStreamRef.current = stream;

      if (qrVideoRef.current) {
        qrVideoRef.current.srcObject = stream;
        qrVideoRef.current.setAttribute("playsinline", "true");
        await qrVideoRef.current.play();
        animFrameIdRef.current = requestAnimationFrame(scanQrFrame);
      }
    } catch (err) {
      console.error("Lỗi bật Camera QR:", err);
    }
  };

  const scanQrFrame = () => {
    const video = qrVideoRef.current;
    const canvas = qrCanvasRef.current;

    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        canvas.height = video.videoHeight;
        canvas.width = video.videoWidth;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "dontInvert",
        });

        if (code && code.data) {
          const cleaned = code.data.trim().toUpperCase();
          if (cleaned) {
            handleScanSuccess(cleaned);
            return;
          }
        }
      }
    }
    animFrameIdRef.current = requestAnimationFrame(scanQrFrame);
  };

  const stopJsQrScanner = () => {
    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
      animFrameIdRef.current = null;
    }
    if (qrStreamRef.current) {
      qrStreamRef.current.getTracks().forEach(track => track.stop());
      qrStreamRef.current = null;
    }
  };

  // 3. QUAY VIDEO MINH CHỨNG
  const startRecording = async () => {
    await stopAllScanners();
    videoChunksRef.current = [];
    setVideoBlob(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { max: 20 } },
        audio: false
      });

      streamRef.current = stream;

      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        videoPreviewRef.current.muted = true;
        await videoPreviewRef.current.play();
      }

      let selectedMimeType = 'video/webm;codecs=vp8';
      if (MediaRecorder.isTypeSupported('video/mp4')) selectedMimeType = 'video/mp4';
      else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) selectedMimeType = 'video/webm;codecs=vp8';
      else if (MediaRecorder.isTypeSupported('video/webm')) selectedMimeType = 'video/webm';

      const mediaRecorder = new MediaRecorder(stream, { mimeType: selectedMimeType, videoBitsPerSecond: 600000 });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) videoChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(videoChunksRef.current, { type: selectedMimeType || 'video/mp4' });
        setVideoBlob(blob);
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
      };

      mediaRecorder.start(500);
      setRecording(true);
    } catch (err) {
      alert("Không thể bật camera quay video: " + err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.substring(result.indexOf(',') + 1));
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const handleSubmit = async () => {
    if (!trackingCode || !videoBlob) return;
    setIsUploading(true);

    try {
      const base64Video = await blobToBase64(videoBlob);
      const payload = {
        trackingCode, reason, description,
        videoFileName: `${trackingCode}.mp4`,
        videoBase64: base64Video,
        mimeType: videoBlob.type || "video/mp4",
        status: "pending"
      };

      const response = await fetch(GOOGLE_SCRIPT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });

      const resData = await response.json();
      if (resData.result === 'success') setUploadSuccess(true);
      else alert("Lỗi upload từ server: " + resData.error);
    } catch (err) {
      alert("Lỗi kết nối khi tải lên.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleReset = () => {
    stopAllScanners();
    setTrackingCode('');
    setIsManualInput(false);
    setManualCode(DEFAULT_PREFIX);
    setReason(REASON_OPTIONS[0]);
    setDescription('');
    setVideoBlob(null);
    setUploadSuccess(false);
    setIsScanning(true);
  };

  // Biến style dùng chung cho Liquid Glass
  const isDark = theme === 'dark';

  return (
    <div className={`min-h-screen transition-colors duration-300 font-sans flex flex-col max-w-md mx-auto relative select-none ${
      isDark ? 'bg-black text-slate-100' : 'bg-slate-100 text-slate-800'
    }`}>

      {/* HEADER GLASS */}
      <header className={`sticky top-0 z-50 px-4 py-3 backdrop-blur-xl border-b transition-colors ${
        isDark 
          ? 'bg-neutral-900/60 border-white/10' 
          : 'bg-white/70 border-black/5 shadow-sm'
      }`}>
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-orange-600 to-amber-500 flex items-center justify-center text-white shadow-md shadow-orange-500/20 active:scale-95 transition">
              <PackageCheck size={20} />
            </div>
            <div>
              <h1 className="font-bold text-[15px] leading-tight tracking-tight">SPX Express</h1>
              <p className={`text-[10px] font-medium ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Ghi nhận đơn sự cố</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Toggle Dark/Light Mode */}
            <button 
              onClick={toggleTheme}
              className={`p-2 rounded-xl backdrop-blur-md border transition active:scale-90 ${
                isDark 
                  ? 'bg-white/10 border-white/15 text-amber-400' 
                  : 'bg-black/5 border-black/10 text-orange-600'
              }`}
            >
              {isDark ? <Sun size={17} /> : <Moon size={17} />}
            </button>

            {/* Reset Button */}
            <button 
              onClick={handleReset} 
              className={`p-2 rounded-xl backdrop-blur-md border transition active:scale-90 ${
                isDark 
                  ? 'bg-white/10 border-white/15 text-slate-300' 
                  : 'bg-black/5 border-black/10 text-slate-600'
              }`}
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </div>
      </header>

      {uploadSuccess ? (
        <div className="p-6 flex-1 flex flex-col justify-center items-center text-center space-y-6 animate-in fade-in zoom-in-95 duration-300">
          <div className="relative">
            <div className="absolute -inset-2 rounded-full bg-emerald-500/20 blur-2xl"></div>
            <div className={`relative p-5 rounded-full border ${
              isDark ? 'bg-neutral-900/80 border-emerald-500/40 text-emerald-400' : 'bg-white border-emerald-500/30 text-emerald-600 shadow-xl'
            }`}>
              <CheckCircle2 size={56} />
            </div>
          </div>
          
          <div className="space-y-1">
            <h2 className="text-xl font-bold tracking-tight">Tải Lên Thành Công!</h2>
            <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Dữ liệu đã được lưu trữ an toàn</p>
          </div>

          <div className={`w-full p-4 rounded-2xl border backdrop-blur-xl space-y-3 text-left ${
            isDark ? 'bg-neutral-900/50 border-white/10' : 'bg-white/80 border-black/5 shadow-sm'
          }`}>
            <div className="flex justify-between items-center text-xs">
              <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>Mã vận đơn:</span>
              <span className="font-mono font-bold text-orange-500 bg-orange-500/10 px-2 py-0.5 rounded-md border border-orange-500/20">{trackingCode}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>Trạng thái:</span>
              <span className="text-emerald-500 font-medium flex items-center gap-1"><Sparkles size={12} /> Đã đồng bộ Google Drive</span>
            </div>
          </div>

          <button 
            onClick={handleReset} 
            className="w-full py-3.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-semibold rounded-2xl shadow-lg shadow-orange-500/25 active:scale-[0.98] transition-all text-sm"
          >
            Quét Đơn Tiếp Theo
          </button>
        </div>
      ) : (
        <main className="p-3.5 space-y-3 flex-1 pb-10">

          {/* BƯỚC 1: MÃ VẬN ĐƠN */}
          <section className={`p-3.5 rounded-2xl border backdrop-blur-xl transition-all shadow-sm ${
            isDark ? 'bg-neutral-900/40 border-white/10' : 'bg-white/80 border-black/5'
          }`}>
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-lg bg-orange-500/15 text-orange-500 font-bold text-[11px] flex items-center justify-center">1</span>
                <h2 className="font-bold text-xs uppercase tracking-wider opacity-80">Mã Vận Đơn</h2>
              </div>
              <button
                onClick={() => {
                  const newMode = !isManualInput;
                  setIsManualInput(newMode);
                  if (newMode) stopAllScanners(); else setIsScanning(true);
                }}
                className="text-xs text-orange-500 font-semibold flex items-center gap-1 active:opacity-75 transition"
              >
                <Edit3 size={12} /> {isManualInput ? "Dùng Camera" : "Nhập tay"}
              </button>
            </div>

            {!isManualInput && !trackingCode && (
              <div className={`flex p-1 rounded-xl mb-3 border ${
                isDark ? 'bg-black/40 border-white/5' : 'bg-slate-200/50 border-black/5'
              }`}>
                <button
                  onClick={() => setScanMode('barcode')}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                    scanMode === 'barcode' 
                      ? (isDark ? 'bg-orange-500 text-white shadow-md' : 'bg-white text-orange-600 shadow-sm')
                      : (isDark ? 'text-slate-400' : 'text-slate-600')
                  }`}
                >
                  <Barcode size={14} /> Mã vạch
                </button>
                <button
                  onClick={() => setScanMode('qrcode')}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                    scanMode === 'qrcode' 
                      ? (isDark ? 'bg-orange-500 text-white shadow-md' : 'bg-white text-orange-600 shadow-sm')
                      : (isDark ? 'text-slate-400' : 'text-slate-600')
                  }`}
                >
                  <QrCode size={14} /> Mã QR
                </button>
              </div>
            )}

            {!isManualInput && !trackingCode && (
              <div className="relative rounded-xl overflow-hidden bg-black border border-white/10 aspect-[4/3] w-full shadow-inner">
                {/* 1. View Engine Mã Vạch Quagga */}
                <div ref={quaggaContainerRef} className={`absolute inset-0 [&>video]:w-full [&>video]:h-full [&>video]:object-cover [&>canvas]:hidden ${scanMode === 'barcode' ? 'block' : 'hidden'}`} />

                {/* 2. View Engine QR Code */}
                <div className={`absolute inset-0 ${scanMode === 'qrcode' ? 'block' : 'hidden'}`}>
                  <video ref={qrVideoRef} className="w-full h-full object-cover" />
                  <canvas ref={qrCanvasRef} className="hidden" />
                </div>

                {/* Overlays UI Camera */}
                {scanMode === 'barcode' ? (
                  <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-between py-3 z-10">
                    <span className="text-[10px] bg-black/60 backdrop-blur-md text-amber-400 px-3 py-1 rounded-full border border-white/10 flex items-center gap-1 font-medium">
                      <Zap size={11} className="fill-amber-400" /> Căn dải mã vạch vào khung
                    </span>
                    <div className="w-[85%] h-16 border-2 border-orange-500 rounded-lg flex items-center justify-center bg-orange-500/10">
                      <div className="w-full h-[2px] bg-orange-500 animate-pulse shadow-[0_0_10px_#f97316]"></div>
                    </div>
                    <span className="text-[10px] text-white/70 bg-black/40 px-2 py-0.5 rounded">Tự động quét</span>
                  </div>
                ) : (
                  <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-between py-3 z-10">
                    <span className="text-[10px] bg-black/60 backdrop-blur-md text-amber-400 px-3 py-1 rounded-full border border-white/10 flex items-center gap-1 font-medium">
                      <QrCode size={11} /> Căn QR Code vào tâm
                    </span>
                    <div className="w-44 h-44 border-2 border-dashed border-orange-500 rounded-xl flex items-center justify-center bg-orange-500/5">
                      <div className="w-full h-full border border-orange-500/30 rounded-xl animate-ping opacity-25"></div>
                    </div>
                    <span className="text-[10px] text-white/70 bg-black/40 px-2 py-0.5 rounded">Tự động quét siêu tốc</span>
                  </div>
                )}
              </div>
            )}

            {isManualInput && !trackingCode && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                  className={`flex-1 border rounded-xl px-3 py-2.5 font-mono text-sm uppercase outline-none transition ${
                    isDark 
                      ? 'bg-black/50 border-white/15 text-white focus:border-orange-500' 
                      : 'bg-slate-50 border-black/15 text-slate-900 focus:border-orange-500'
                  }`}
                />
                <button
                  onClick={() => manualCode.trim() && setTrackingCode(manualCode.trim())}
                  className="bg-orange-500 text-white px-4 rounded-xl text-xs font-bold active:scale-95 transition"
                >Lưu</button>
              </div>
            )}

            {trackingCode && (
              <div className={`p-3 rounded-xl border flex justify-between items-center backdrop-blur-md ${
                isDark ? 'bg-emerald-950/20 border-emerald-500/30' : 'bg-emerald-50/80 border-emerald-500/20'
              }`}>
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 bg-emerald-500 text-white rounded-lg"><Check size={14} /></div>
                  <div>
                    <span className={`text-[10px] block ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Mã đã ghi nhận</span>
                    <span className="text-sm font-mono font-bold tracking-wide text-emerald-500">{trackingCode}</span>
                  </div>
                </div>
                <button 
                  onClick={() => { setTrackingCode(''); setIsScanning(true); }} 
                  className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition ${
                    isDark ? 'bg-white/10 border-white/10 text-slate-300' : 'bg-white border-black/10 text-slate-700 shadow-sm'
                  }`}
                >Quét lại</button>
              </div>
            )}
          </section>

          {/* BƯỚC 2: CHI TIẾT SỰ CỐ */}
          <section className={`p-3.5 rounded-2xl border backdrop-blur-xl transition-all shadow-sm ${
            isDark ? 'bg-neutral-900/40 border-white/10' : 'bg-white/80 border-black/5'
          }`}>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-5 h-5 rounded-lg bg-orange-500/15 text-orange-500 font-bold text-[11px] flex items-center justify-center">2</span>
              <h2 className="font-bold text-xs uppercase tracking-wider opacity-80">Chi Tiết Sự Cố</h2>
            </div>

            <div className="space-y-2.5">
              <select 
                value={reason} 
                onChange={(e) => setReason(e.target.value)} 
                className={`w-full border rounded-xl px-3 py-2.5 text-xs font-medium outline-none transition ${
                  isDark 
                    ? 'bg-neutral-950 border-white/15 text-slate-200 focus:border-orange-500' 
                    : 'bg-slate-50 border-black/10 text-slate-800 focus:border-orange-500'
                }`}
              >
                {REASON_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
              </select>

              <textarea 
                rows={2} 
                value={description} 
                onChange={(e) => setDescription(e.target.value)} 
                placeholder="Ghi chú thêm (không bắt buộc)..." 
                className={`w-full border rounded-xl p-3 text-xs outline-none resize-none transition ${
                  isDark 
                    ? 'bg-neutral-950 border-white/15 text-slate-200 focus:border-orange-500' 
                    : 'bg-slate-50 border-black/10 text-slate-800 focus:border-orange-500'
                }`}
              ></textarea>
            </div>
          </section>

          {/* BƯỚC 3: VIDEO MINH CHỨNG */}
          <section className={`p-3.5 rounded-2xl border backdrop-blur-xl transition-all shadow-sm ${
            isDark ? 'bg-neutral-900/40 border-white/10' : 'bg-white/80 border-black/5'
          }`}>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-5 h-5 rounded-lg bg-orange-500/15 text-orange-500 font-bold text-[11px] flex items-center justify-center">3</span>
              <h2 className="font-bold text-xs uppercase tracking-wider opacity-80">Video Minh Chứng</h2>
            </div>

            {!videoBlob ? (
              <div className="space-y-2">
                <video ref={videoPreviewRef} className={`w-full aspect-[4/3] bg-black rounded-xl object-cover border border-white/10 ${recording ? 'block' : 'hidden'}`} playsInline autoPlay></video>
                
                {!recording ? (
                  <button 
                    onClick={startRecording} 
                    className={`w-full py-3 rounded-xl border font-semibold flex items-center justify-center gap-2 text-xs transition active:scale-[0.98] ${
                      isDark 
                        ? 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10' 
                        : 'bg-slate-100 border-black/10 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <Video size={15} className="text-orange-500" /> Bắt Đầu Quay Video
                  </button>
                ) : (
                  <button 
                    onClick={stopRecording} 
                    className="w-full py-3 bg-rose-500 text-white font-semibold rounded-xl flex items-center justify-center gap-2 text-xs shadow-lg shadow-rose-500/25 animate-pulse active:scale-[0.98]"
                  >
                    <div className="w-2.5 h-2.5 bg-white rounded-full"></div> Dừng Quay & Lưu Video
                  </button>
                )}
              </div>
            ) : (
              <div className={`p-3 rounded-xl border flex items-center justify-between backdrop-blur-md ${
                isDark ? 'bg-emerald-950/20 border-emerald-500/30' : 'bg-emerald-50/80 border-emerald-500/20'
              }`}>
                <div className="flex items-center gap-2 text-emerald-500 text-xs font-semibold">
                  <Check size={14} className="p-0.5 bg-emerald-500 text-white rounded-full" /> Đã lưu video minh chứng
                </div>
                <button 
                  onClick={() => setVideoBlob(null)} 
                  className={`text-xs flex items-center gap-1 p-1 rounded transition ${
                    isDark ? 'text-slate-400 hover:text-rose-400' : 'text-slate-500 hover:text-rose-600'
                  }`}
                >
                  <Trash2 size={12} /> Quay lại
                </button>
              </div>
            )}
          </section>

          {/* NÚT UPLOAD */}
          <button
            disabled={isUploading || !trackingCode || !videoBlob}
            onClick={handleSubmit}
            className={`w-full py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 text-sm shadow-xl transition-all ${
              isUploading || !trackingCode || !videoBlob 
                ? (isDark ? 'bg-neutral-800 text-neutral-500 border border-white/5' : 'bg-slate-200 text-slate-400 border border-black/5') 
                : 'bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white shadow-orange-500/25 active:scale-[0.98]'
            }`}
          >
            {isUploading ? (
              <><RefreshCw size={16} className="animate-spin" /> Đang gửi báo cáo...</>
            ) : (
              <><Upload size={16} /> Gửi Báo Cáo Sự Cố</>
            )}
          </button>
        </main>
      )}
    </div>
  );
}
import { useState, useEffect, useRef } from 'react';
import Quagga from '@ericblade/quagga2';
import jsQR from 'jsqr'; // Thuật toán giải mã QR tốc độ cao
import { CheckCircle2, Video, Upload, RefreshCw, Edit3, Check, Trash2, PackageCheck, Sparkles, Zap, QrCode, Barcode } from 'lucide-react';
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

export default function App() {
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

  // Âm thanh "Tít" bằng Web Audio API
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

  // 2. ENGINE QUÉT QR CODE TỐC ĐỘ CAO (Dùng jsQR + Canvas + Loop 60fps tương tự pyzbar)
  const startJsQrScanner = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      
      qrStreamRef.current = stream;

      if (qrVideoRef.current) {
        qrVideoRef.current.srcObject = stream;
        qrVideoRef.current.setAttribute("playsinline", "true"); // Bắt buộc cho iOS
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
        
        // Thuật toán quét QR
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "dontInvert", // Bỏ qua lật màu để tối ưu tốc độ tối đa
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
    // Lặp frame liên tục theo chuẩn màn hình (tốc độ ánh sáng)
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col max-w-md mx-auto shadow-2xl relative font-sans">
      
      {/* HEADER */}
      <header className="bg-slate-900/80 backdrop-blur-md border-b border-slate-800/80 px-4 py-3.5 sticky top-0 z-50 flex justify-between items-center">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-gradient-to-tr from-orange-600 to-amber-500 rounded-xl shadow-lg shadow-orange-500/20 text-white">
            <PackageCheck size={18} />
          </div>
          <div>
            <h1 className="font-bold text-[15px] tracking-tight text-slate-100">SPX Express</h1>
            <p className="text-[10px] text-slate-400 font-medium">Hệ thống ghi nhận đơn lỗi</p>
          </div>
        </div>
        <button onClick={handleReset} className="p-2 text-slate-400 hover:text-slate-100 bg-slate-800/60 rounded-xl transition active:scale-95">
          <RefreshCw size={16} />
        </button>
      </header>

      {uploadSuccess ? (
        <div className="p-6 flex-1 flex flex-col justify-center items-center text-center space-y-5 animate-in fade-in duration-300">
          <div className="relative">
            <div className="absolute -inset-1 rounded-full bg-emerald-500/20 blur-xl"></div>
            <div className="relative bg-slate-900 border border-emerald-500/30 p-5 rounded-full text-emerald-400">
              <CheckCircle2 size={50} />
            </div>
          </div>
          
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-slate-100">Tải Lên Thành Công!</h2>
            <p className="text-xs text-slate-400">Đơn hàng đã được ghi nhận vào hệ thống</p>
          </div>

          <div className="w-full bg-slate-900/90 border border-slate-800 p-4 rounded-2xl space-y-2.5 text-left">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">Mã vận đơn:</span>
              <span className="font-mono font-bold text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20">{trackingCode}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">Trạng thái:</span>
              <span className="text-emerald-400 font-medium flex items-center gap-1"><Sparkles size={12} /> Đã lưu Drive & Sheet</span>
            </div>
          </div>

          <button onClick={handleReset} className="w-full mt-4 py-3.5 bg-gradient-to-r from-orange-500 to-amber-600 text-white font-semibold rounded-xl shadow-lg active:scale-[0.98] transition">
            Quét Đơn Tiếp Theo
          </button>
        </div>
      ) : (
        <main className="p-3.5 space-y-3.5 flex-1 pb-10">

          {/* BƯỚC 1 */}
          <section className="bg-slate-900/80 backdrop-blur border border-slate-800/80 rounded-2xl p-3.5 shadow-xl space-y-3">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-md bg-orange-500/10 text-orange-400 border border-orange-500/20 flex items-center justify-center text-[11px] font-bold">1</span>
                <h2 className="font-semibold text-sm text-slate-200">Mã Vận Đơn</h2>
              </div>
              <button
                onClick={() => {
                  const newMode = !isManualInput;
                  setIsManualInput(newMode);
                  if (newMode) stopAllScanners(); else setIsScanning(true);
                }}
                className="text-xs text-amber-400/90 hover:text-amber-300 font-medium flex items-center gap-1 transition p-1"
              >
                <Edit3 size={12} /> {isManualInput ? "Dùng Camera Quét" : "Nhập tay"}
              </button>
            </div>

            {!isManualInput && !trackingCode && (
              <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-medium">
                <button
                  onClick={() => setScanMode('barcode')}
                  className={`flex-1 py-2.5 rounded-lg flex items-center justify-center gap-1.5 transition ${scanMode === 'barcode' ? 'bg-amber-500 text-slate-950 font-bold shadow-md' : 'text-slate-400'}`}
                >
                  <Barcode size={15} /> Mã vạch ngang
                </button>
                <button
                  onClick={() => setScanMode('qrcode')}
                  className={`flex-1 py-2.5 rounded-lg flex items-center justify-center gap-1.5 transition ${scanMode === 'qrcode' ? 'bg-amber-500 text-slate-950 font-bold shadow-md' : 'text-slate-400'}`}
                >
                  <QrCode size={15} /> Mã QR Code
                </button>
              </div>
            )}

            {!isManualInput && !trackingCode && (
              <div className="relative rounded-xl overflow-hidden bg-black border border-slate-800 aspect-[4/3] min-h-[260px] w-full">
                
                {/* 1. View Engine Mã Vạch Quagga */}
                <div ref={quaggaContainerRef} className={`absolute inset-0 [&>video]:w-full [&>video]:h-full [&>video]:object-cover [&>canvas]:hidden ${scanMode === 'barcode' ? 'block' : 'hidden'}`} />

                {/* 2. View Engine QR Code (Trực tiếp bằng jsQR Video + Canvas) */}
                <div className={`absolute inset-0 ${scanMode === 'qrcode' ? 'block' : 'hidden'}`}>
                  <video ref={qrVideoRef} className="w-full h-full object-cover" />
                  <canvas ref={qrCanvasRef} className="hidden" />
                </div>

                {/* Overlays UI */}
                {scanMode === 'barcode' ? (
                  <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-between py-4 z-10">
                    <span className="text-[11px] bg-slate-900/95 text-amber-400 font-medium px-3 py-1 rounded-full shadow-lg flex items-center gap-1">
                      <Zap size={12} className="fill-amber-400" /> Quét mã vạch
                    </span>
                    <div className="w-[85%] h-20 border-2 border-amber-400 rounded-lg flex items-center justify-center bg-amber-400/10 shadow-[0_0_15px_rgba(251,191,36,0.2)]">
                      <div className="w-full h-[2px] bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,1)]"></div>
                    </div>
                    <span className="text-[10px] text-slate-300 bg-slate-950/80 px-2 py-1 rounded">Căn dải mã vạch vào khung ngang</span>
                  </div>
                ) : (
                  <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-between py-4 z-10">
                    <span className="text-[11px] bg-slate-900/95 text-amber-400 font-medium px-3 py-1 rounded-full shadow-lg flex items-center gap-1">
                      <QrCode size={12} /> Quét QR Siêu Tốc
                    </span>
                    <div className="w-48 h-48 border-2 border-dashed border-amber-400 rounded-xl flex items-center justify-center bg-amber-400/5">
                      <div className="w-full h-full border border-amber-400/30 rounded-xl animate-ping opacity-20"></div>
                    </div>
                    <span className="text-[10px] text-slate-300 bg-slate-950/80 px-2 py-1 rounded">Đưa camera tới gần mã QR</span>
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
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-slate-100 font-mono text-sm uppercase outline-none focus:border-amber-500"
                />
                <button
                  onClick={() => manualCode.trim() && setTrackingCode(manualCode.trim())}
                  className="bg-slate-800 border border-slate-700 text-slate-200 px-4 rounded-xl text-sm font-medium"
                >Lưu</button>
              </div>
            )}

            {trackingCode && (
              <div className="bg-slate-950/60 border border-emerald-500/30 p-3 rounded-xl flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="p-1 bg-emerald-500/10 text-emerald-400 rounded-md"><Check size={14} /></div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">Mã đã ghi nhận</span>
                    <span className="text-sm font-mono font-bold text-slate-100">{trackingCode}</span>
                  </div>
                </div>
                <button onClick={() => { setTrackingCode(''); setIsScanning(true); }} className="text-xs bg-slate-800 text-slate-300 px-3 py-1.5 rounded-lg">Quét lại</button>
              </div>
            )}
          </section>

          {/* BƯỚC 2 */}
          <section className="bg-slate-900/80 backdrop-blur border border-slate-800/80 rounded-2xl p-3.5 shadow-xl space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center text-[11px] font-bold">2</span>
              <h2 className="font-semibold text-sm text-slate-200">Chi Tiết Sự Cố</h2>
            </div>
            <div className="space-y-2">
              <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none">
                {REASON_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
              </select>
              <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ghi chú bổ sung..." className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 outline-none resize-none"></textarea>
            </div>
          </section>

          {/* BƯỚC 3 */}
          <section className="bg-slate-900/80 backdrop-blur border border-slate-800/80 rounded-2xl p-3.5 shadow-xl space-y-3">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-md bg-orange-500/10 text-orange-400 border border-orange-500/20 flex items-center justify-center text-[11px] font-bold">3</span>
                <h2 className="font-semibold text-sm text-slate-200">Video Minh Chứng</h2>
              </div>
            </div>

            {!videoBlob ? (
              <div className="space-y-2.5">
                <video ref={videoPreviewRef} className={`w-full aspect-[4/3] bg-slate-950 rounded-xl object-cover border border-slate-800 ${recording ? 'block' : 'hidden'}`} playsInline autoPlay></video>
                {!recording ? (
                  <button onClick={startRecording} className="w-full py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-xl font-medium flex items-center justify-center gap-2 text-xs transition"><Video size={16} className="text-orange-400" /> Bắt Đầu Quay Video</button>
                ) : (
                  <button onClick={stopRecording} className="w-full py-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 font-medium rounded-xl flex items-center justify-center gap-2 text-xs animate-pulse"><div className="w-2.5 h-2.5 bg-rose-500 rounded-full"></div> Dừng Quay & Lưu</button>
                )}
              </div>
            ) : (
              <div className="bg-slate-950/60 border border-emerald-500/30 p-3 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
                  <Check size={14} className="p-0.5 bg-emerald-500/20 rounded-full" /> Đã quay video
                </div>
                <button onClick={() => setVideoBlob(null)} className="text-xs text-slate-400 hover:text-rose-400 flex items-center gap-1 p-1"><Trash2 size={12} /> Quay lại</button>
              </div>
            )}
          </section>

          {/* NÚT UPLOAD */}
          <button
            disabled={isUploading || !trackingCode || !videoBlob}
            onClick={handleSubmit}
            className={`w-full py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 text-sm shadow-xl transition-all ${isUploading || !trackingCode || !videoBlob ? 'bg-slate-800/50 text-slate-500' : 'bg-gradient-to-r from-orange-500 to-amber-600 text-white active:scale-[0.98]'}`}
          >
            {isUploading ? <><RefreshCw size={16} className="animate-spin" /> Đang tải...</> : <><Upload size={16} /> Gửi Báo Cáo</>}
          </button>
        </main>
      )}
    </div>
  );
}